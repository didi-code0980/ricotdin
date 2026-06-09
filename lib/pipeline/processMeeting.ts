// SERVER ONLY — uses service role key and Gemini API key. Never import from
// client components or expose to the browser.
//
// Pipeline orchestrator: takes a meetingId, runs the two Gemini steps, writes
// all results to Postgres, and sets status='done'. Any error sets
// status='failed' and writes meetings.error_message.
//
// NOTE: a non-awaited call to processMeeting() is safe on a long-lived Next.js
// server (npm start). If the server restarts mid-job, the meeting is left in
// status='processing'; trigger a re-run manually via POST /api/meetings/:id/process.

import { writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'

import { createServerClient } from '@/lib/supabase/server'
import { analyzeTranscript } from '@/lib/gemini/analyze'
import { embedChunks } from '@/lib/gemini/embed'
import { chunkSegments } from './chunk'
import { transcribeWithChunking } from './audioChunk'
import { assertAnalysisHasContent } from './guards'

const BUCKET = 'recordings'

/**
 * Process a meeting end-to-end:
 *   pending/failed → processing → (transcription + analysis + embeddings) → done
 *
 * Atomic guard: uses a conditional UPDATE to claim the job. If the meeting is
 * already processing or done, this function returns without doing anything —
 * safe to call multiple times or from concurrent requests.
 */
export async function processMeeting(meetingId: string): Promise<void> {
  const db = createServerClient()

  // ── Atomic claim ─────────────────────────────────────────────────────────
  // Only run if the meeting is in a processable state. Using .in() so that
  // manual re-runs can restart failed meetings.
  const { data: claimed } = await db
    .from('meetings')
    .update({ status: 'processing', error_message: null })
    .in('status', ['pending', 'failed'])
    .eq('id', meetingId)
    .select('id, audio_path, duration_seconds')
    .maybeSingle()

  if (!claimed) {
    console.log(`[pipeline] ${meetingId}: not claimable (already processing/done or missing)`)
    return
  }

  console.log(`[pipeline] ${meetingId}: starting processing`)
  let tmpAudioPath: string | null = null
  let chunkDir: string | null = null

  try {
    // ── Download audio from Supabase Storage ──────────────────────────────
    const audioPath = claimed.audio_path
    if (!audioPath) {
      throw new Error('Meeting has no audio_path — cannot process')
    }

    console.log(`[pipeline] ${meetingId}: downloading audio from storage`)
    const { data: audioBlob, error: dlError } = await db.storage
      .from(BUCKET)
      .download(audioPath)

    if (dlError || !audioBlob) {
      throw new Error(`Storage download failed: ${dlError?.message ?? 'no data'}`)
    }

    // Write to a temp file so the ffmpeg transcode can read it from disk.
    // The extension is preserved so ffmpeg can auto-detect the input format.
    const ext = extname(audioPath) || '.webm'
    tmpAudioPath = join(tmpdir(), `meeting-${randomUUID()}${ext}`)
    const audioBuffer = Buffer.from(await audioBlob.arrayBuffer())
    await writeFile(tmpAudioPath, audioBuffer)
    console.log(`[pipeline] ${meetingId}: audio written to ${tmpAudioPath} (${audioBuffer.length} bytes)`)

    // ── Step A: Transcription ─────────────────────────────────────────────
    // transcribeWithChunking handles:
    //   - optional webm→mp3 transcode when ffmpeg is available (smaller upload)
    //   - long-audio splitting when duration > 28 min (requires ffmpeg)
    // chunkDir holds all ffmpeg output and is cleaned up in the finally block.
    const durationSecs = claimed.duration_seconds ?? 0
    chunkDir = join(tmpdir(), `meeting-${meetingId}-chunks`)
    const transcript = await transcribeWithChunking(tmpAudioPath, durationSecs, chunkDir)
    console.log(
      `[pipeline] ${meetingId}: transcript done — ` +
        `${transcript.segments.length} segments, language=${transcript.language}`,
    )

    // Empty transcript: audio was silent, too short, or the codec was
    // unrecognised. Mark the meeting done with a clear note so the user sees
    // a readable state instead of a failure. No segments/todos/embeddings to insert.
    if (transcript.segments.length === 0) {
      await db
        .from('meetings')
        .update({
          status: 'done',
          summary: 'No speech detected in this recording.',
          notes: '',
          language: transcript.language,
        })
        .eq('id', meetingId)
      console.log(`[pipeline] ${meetingId}: done (empty transcript — no speech detected)`)
      return
    }

    // Insert transcript_segments and build segment-index → row-id map
    const segmentRows = transcript.segments.map((s, idx) => ({
      meeting_id: meetingId,
      segment_index: idx,
      speaker: s.speaker,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      text: s.text,
    }))

    const { data: insertedSegments, error: segErr } = await db
      .from('transcript_segments')
      .insert(segmentRows)
      .select('id, segment_index')

    if (segErr) throw new Error(`transcript_segments insert: ${segErr.message}`)

    // Map segment index → DB id for citation FK resolution
    const segmentIdByIndex = new Map<number, string>(
      (insertedSegments ?? []).map((r) => [r.segment_index, r.id]),
    )

    // Update language from transcript
    await db
      .from('meetings')
      .update({ language: transcript.language })
      .eq('id', meetingId)

    // ── Step B: Analysis ──────────────────────────────────────────────────
    const analysis = await analyzeTranscript(transcript)
    console.log(
      `[pipeline] ${meetingId}: analysis done — ` +
        `${analysis.todos.length} todos, ${analysis.calendar_suggestions.length} calendar suggestions`,
    )

    // Guard: reject if Gemini returned neither summary nor notes. This catches
    // API failures that produce a structurally valid but semantically empty result.
    assertAnalysisHasContent(analysis)

    // Update summary + notes on the meetings row
    await db
      .from('meetings')
      .update({ summary: analysis.summary, notes: analysis.notes_markdown })
      .eq('id', meetingId)

    // Insert todos (resolve source_segment_index → source_segment_id)
    if (analysis.todos.length > 0) {
      const todoRows = analysis.todos.map((t) => ({
        meeting_id: meetingId,
        content: t.content,
        assignee: t.assignee,
        due_date: t.due_date,
        status: 'open' as const,
        source_segment_id:
          t.source_segment_index != null
            ? (segmentIdByIndex.get(t.source_segment_index) ?? null)
            : null,
      }))
      const { error: todoErr } = await db.from('todos').insert(todoRows)
      if (todoErr) throw new Error(`todos insert: ${todoErr.message}`)
    }

    // Insert calendar_suggestions
    if (analysis.calendar_suggestions.length > 0) {
      const calRows = analysis.calendar_suggestions.map((c) => ({
        meeting_id: meetingId,
        title: c.title,
        proposed_at: c.proposed_at,
        raw_mention: c.raw_mention,
        source_segment_id:
          c.source_segment_index != null
            ? (segmentIdByIndex.get(c.source_segment_index) ?? null)
            : null,
        dismissed: false,
      }))
      const { error: calErr } = await db.from('calendar_suggestions').insert(calRows)
      if (calErr) throw new Error(`calendar_suggestions insert: ${calErr.message}`)
    }

    // ── RAG: chunk + embed + insert transcript_chunks ─────────────────────
    const chunks = chunkSegments(transcript.segments)
    console.log(`[pipeline] ${meetingId}: ${chunks.length} RAG chunks, embedding…`)

    if (chunks.length > 0) {
      const vectors = await embedChunks(chunks.map((c) => c.content))

      const chunkRows = chunks.map((c, idx) => ({
        meeting_id: meetingId,
        chunk_index: c.chunk_index,
        content: c.content,
        embedding: vectors[idx],
        start_ms: c.start_ms,
        end_ms: c.end_ms,
        token_count: c.token_count,
      }))

      const { error: chunkErr } = await db.from('transcript_chunks').insert(chunkRows)
      if (chunkErr) throw new Error(`transcript_chunks insert: ${chunkErr.message}`)
    }

    // ── Mark done ─────────────────────────────────────────────────────────
    await db.from('meetings').update({ status: 'done' }).eq('id', meetingId)
    console.log(`[pipeline] ${meetingId}: done ✓`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[pipeline] ${meetingId}: FAILED —`, message)
    await db
      .from('meetings')
      .update({ status: 'failed', error_message: message.slice(0, 500) })
      .eq('id', meetingId)
    throw err
  } finally {
    // Clean up temp files regardless of success/failure.
    // tmpAudioPath: the downloaded source file (e.g. .webm)
    // chunkDir: all ffmpeg output (transcoded mp3 + any chunk files)
    if (tmpAudioPath) {
      unlink(tmpAudioPath).catch((e: unknown) => {
        console.warn('[pipeline] failed to delete temp audio file:', e)
      })
    }
    if (chunkDir) {
      rm(chunkDir, { recursive: true, force: true }).catch((e: unknown) => {
        console.warn('[pipeline] failed to delete chunk dir:', e)
      })
    }
  }
}
