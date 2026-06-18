// POST /api/meetings/:id/uploaded
// Called by the client after a successful direct upload to Supabase Storage.
//
// For audio files (source='uploaded'):
//   Validates the uploaded file (size + ffprobe audio-stream check) and kicks
//   off the processing pipeline if everything is OK.
//
// For video files (source='video'):
//   Validates that the video has an audio track, then runs server-side ffmpeg
//   audio extraction, stores only the resulting mp3, updates the meeting row to
//   point at the mp3, deletes the original video from Storage, and fires the
//   pipeline. The pipeline never sees the video file.

import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { processMeeting } from '@/lib/pipeline/processMeeting'
import { validateAudioStream, validateVideoAudioStream } from '@/lib/audio/ffprobe'
import { extractAudioFromVideo } from '@/lib/audio/transcode'
import { MAX_UPLOAD_BYTES } from '@/lib/upload/constants'
import type { Database } from '@/types/database'

const BUCKET = 'recordings'

async function requireUser(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
  }

  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error || !user) {
    throw NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
  }
  return user.id
}

/** Delete the meeting row and its Storage object, then return a 422 response. */
async function rejectUpload(
  serverClient: ReturnType<typeof createServerClient>,
  meetingId: string,
  storagePath: string,
  reason: string,
): Promise<NextResponse> {
  await serverClient.storage.from(BUCKET).remove([storagePath]).catch((e: unknown) => {
    console.warn('[uploaded] storage cleanup failed:', e)
  })
  const { error: deleteErr } = await serverClient.from('meetings').delete().eq('id', meetingId)
  if (deleteErr) console.warn('[uploaded] meeting row cleanup failed:', deleteErr.message)
  return NextResponse.json({ error: reason }, { status: 422 })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string
  try {
    userId = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  const { id: meetingId } = await params

  const serverClient = createServerClient()

  // Verify the meeting belongs to this user
  const { data: meeting, error: fetchError } = await serverClient
    .from('meetings')
    .select('id, audio_path, user_id, source')
    .eq('id', meetingId)
    .single()

  if (fetchError || !meeting) {
    return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  }

  if (meeting.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // ── Confirm file exists + check size ─────────────────────────────────────
  if (meeting.audio_path) {
    const dir = meeting.audio_path.split('/').slice(0, -1).join('/')
    const filename = meeting.audio_path.split('/').at(-1)

    const { data: files, error: listError } = await serverClient.storage
      .from(BUCKET)
      .list(dir, { search: filename, limit: 1 })

    if (listError) {
      console.warn('[uploaded] storage list error (non-fatal):', listError.message)
    } else if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'File not found in storage — upload may have failed.' },
        { status: 422 },
      )
    } else {
      const sizeBytes = (files[0].metadata as Record<string, unknown> | null)?.['size']
      if (typeof sizeBytes === 'number' && sizeBytes > MAX_UPLOAD_BYTES) {
        const mb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0)
        return rejectUpload(
          serverClient,
          meetingId,
          meeting.audio_path,
          `File exceeds the ${mb} MB upload limit.`,
        )
      }
    }
  }

  // NOTE: uploads accelerate the storage cap — see CST-02 (Storage offload / R2)

  // ── Branch: video files need audio extraction ─────────────────────────────
  if (meeting.source === 'video' && meeting.audio_path) {
    const videoPath = meeting.audio_path
    const finalAudioPath = `${meeting.user_id}/${meetingId}.mp3`
    const tmpAudioPath = join(tmpdir(), `${meetingId}-audio.mp3`)
    let audioUploaded = false

    try {
      // Longer TTL — ffmpeg will download the full video through this URL
      const { data: readUrl, error: urlErr } = await serverClient.storage
        .from(BUCKET)
        .createSignedUrl(videoPath, 600) // 10-minute window for extraction

      if (urlErr || !readUrl?.signedUrl) {
        throw new Error(`Could not generate signed read URL: ${urlErr?.message ?? 'unknown'}`)
      }

      // Validate that the video has an audio track (video streams are expected)
      await validateVideoAudioStream(readUrl.signedUrl)

      // Extract audio — ffmpeg downloads the video via the signed URL
      await extractAudioFromVideo(readUrl.signedUrl, tmpAudioPath)

      // Upload extracted mp3 to Storage
      const audioBuffer = await readFile(tmpAudioPath)
      const { error: uploadErr } = await serverClient.storage
        .from(BUCKET)
        .upload(finalAudioPath, audioBuffer, { contentType: 'audio/mpeg', upsert: false })

      if (uploadErr) throw new Error(`Audio upload failed: ${uploadErr.message}`)
      audioUploaded = true

      // Update meeting row to point at the extracted audio
      const { error: updateErr } = await serverClient
        .from('meetings')
        .update({ audio_path: finalAudioPath })
        .eq('id', meetingId)

      if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`)

      // Delete the original video — the mp3 is the authoritative file now
      await serverClient.storage
        .from(BUCKET)
        .remove([videoPath])
        .catch((e: unknown) => {
          console.warn('[uploaded] video cleanup after extraction failed (non-fatal):', e)
        })

    } catch (err) {
      // Clean up temp file
      await unlink(tmpAudioPath).catch(() => {})
      // If the mp3 was already written to Storage but the row update failed, remove it
      if (audioUploaded) {
        await serverClient.storage
          .from(BUCKET)
          .remove([finalAudioPath])
          .catch((e: unknown) => {
            console.warn('[uploaded] partial audio cleanup failed:', e)
          })
      }
      const reason = err instanceof Error ? err.message : 'Video audio extraction failed.'
      return rejectUpload(serverClient, meetingId, videoPath, reason)
    }

    // Temp file no longer needed
    await unlink(tmpAudioPath).catch(() => {})

    // Pipeline reads audio_path from DB — it now sees the mp3 path
    void processMeeting(meetingId).catch((err: unknown) => {
      console.error('[uploaded] processMeeting fire-and-forget error:', err)
    })

    return NextResponse.json({ ok: true, meetingId })
  }

  // ── Audio-only: ffprobe validation ───────────────────────────────────────
  // Generate a short-lived signed URL so ffprobe can read stream headers
  // without downloading the full file. Skipped gracefully if ffprobe is absent.
  if (meeting.audio_path) {
    const { data: readUrl, error: urlErr } = await serverClient.storage
      .from(BUCKET)
      .createSignedUrl(meeting.audio_path, 120) // 2-minute TTL

    if (urlErr || !readUrl?.signedUrl) {
      console.warn('[uploaded] could not generate signed read URL for ffprobe:', urlErr?.message)
    } else {
      try {
        await validateAudioStream(readUrl.signedUrl)
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'File is not a valid audio file.'
        return rejectUpload(serverClient, meetingId, meeting.audio_path, reason)
      }
    }
  }

  // Auto-trigger the processing pipeline (fire and forget).
  void processMeeting(meetingId).catch((err: unknown) => {
    console.error('[uploaded] processMeeting fire-and-forget error:', err)
  })

  return NextResponse.json({ ok: true, meetingId })
}
