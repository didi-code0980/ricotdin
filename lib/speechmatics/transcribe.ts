// SERVER ONLY — uses SPEECHMATICS_API_KEY. Import only from /app/api or server /lib.
//
// Step A replacement: upload audio to the Speechmatics Batch API, poll until
// the job is complete, fetch the json-v2 transcript, and return TranscriptResult
// (same contract as the old Gemini transcribeAudio).
//
// Advantages over the Gemini approach:
//   • No audio length limit — Speechmatics handles hours-long files natively.
//   • ffmpeg splitting not required.
//   • Word-level timestamps with native speaker diarization.

import { readFile, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { log } from '@/lib/logger'
import { speechmaticsRequest } from './client'
import { isFfmpegAvailable, transcodeForGemini } from '@/lib/audio/transcode'
import { logUsage } from '@/lib/usage/logUsage'
import type { TranscriptResult } from '@/types/pipeline'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000      // check job status every 5 s
const POLL_TIMEOUT_MS = 30 * 60_000 // give up after 30 min

// Within a single speaker's turn, split into a new segment when there is a
// silence gap longer than this. Prevents one-speaker recordings from producing
// a single 20-minute segment that is unusable in the UI.
const PAUSE_SPLIT_THRESHOLD_S = 3.0

// Build the Speechmatics job config.
// speakerCount: when provided, fixes the diarizer to exactly that many speakers.
// Without it, max_speakers: 10 tells Speechmatics to look for up to 10 speakers
// rather than defaulting conservatively (which can collapse multi-speaker audio
// into a single label on mono recordings).
export function buildJobConfig(speakerCount?: number) {
  return {
    type: 'transcription',
    transcription_config: {
      language: 'en',
      diarization: 'speaker',
      operating_point: 'enhanced',
      enable_entities: true,
      punctuation_overrides: {
        permitted_marks: ['.', ',', '?', '!'],
      },
      // 0.7 is moderately above the API default of 0.5 — splits distinct voices
      // without over-fragmenting. When speakerCount is provided, max_speakers caps
      // detection to exactly that many labels.
      speaker_diarization_config: {
        speaker_sensitivity: 0.5,
        ...(speakerCount != null ? { max_speakers: speakerCount } : {}),
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Internal types (Speechmatics json-v2 response shape)
// ---------------------------------------------------------------------------

type JobResponse = { id: string }

type JobStatusResponse = {
  job: {
    id: string
    status: 'running' | 'done' | 'rejected' | 'deleted'
    errors?: unknown[]
  }
}

type SpeechmaticsResult = {
  type: string
  start_time?: number
  end_time?: number
  attaches_to?: 'previous' | null
  speaker?: string
  alternatives?: Array<{ content: string; confidence?: number; language?: string; speaker?: string }>
}

type SpeechmaticsTranscript = {
  metadata?: {
    transcription_config?: { language?: string }
  }
  results?: SpeechmaticsResult[]
  speakers?: Array<{ name: string; duration: string; confidence: number | null }>
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Convert a Speechmatics speaker label to the display format used across the app.
 *   "S1"       → "Speaker 1"
 *   "S12"      → "Speaker 12"
 *   "UU"       → "Speaker"   (unknown/unattributed)
 *   anything else → passed through unchanged
 */
export function formatSpeakerLabel(raw: string): string {
  if (/^S\d+$/.test(raw)) return `Speaker ${raw.slice(1)}`
  if (raw === 'UU') return 'Speaker'
  return raw
}

/**
 * Extract the BCP-47 language code from a Speechmatics json-v2 transcript.
 * Preference order:
 *   1. `language` on the first word's alternative (most accurate for auto-detect)
 *   2. `metadata.transcription_config.language`
 *   3. "unknown" fallback
 */
function extractLanguage(transcript: SpeechmaticsTranscript): string {
  for (const r of transcript.results ?? []) {
    if (r.type === 'word' && r.alternatives?.[0]?.language) {
      return r.alternatives[0].language
    }
  }
  return transcript.metadata?.transcription_config?.language ?? 'unknown'
}

/**
 * Map a Speechmatics json-v2 transcript to our internal TranscriptResult.
 *
 * Algorithm:
 *   - Walk results in order; accumulate words per speaker turn.
 *   - A new turn starts whenever the speaker label changes.
 *   - Punctuation with attaches_to="previous" is appended directly to the
 *     last word token (no space), matching natural written text.
 *   - Orphan punctuation before any word is silently dropped.
 *   - Per-turn confidence = average of all word-level confidence values
 *     (null if Speechmatics returns no confidence scores for a turn).
 */
export function parseTranscriptResponse(
  transcript: SpeechmaticsTranscript,
): TranscriptResult {
  const language = extractLanguage(transcript)
  const segments: TranscriptResult['segments'] = []

  // Mutable state for the segment currently being built
  let currentSpeaker: string | null = null
  let currentStart: number | null = null
  let currentEnd: number | null = null
  let currentWords: string[] = []
  let confSum = 0
  let confCount = 0

  function flushSegment() {
    if (currentSpeaker !== null && currentWords.length > 0) {
      const confidence = confCount > 0
        ? Math.round((confSum / confCount) * 100) / 100
        : null
      segments.push({
        speaker: formatSpeakerLabel(currentSpeaker),
        start_ms: Math.round((currentStart ?? 0) * 1000),
        end_ms: Math.round((currentEnd ?? 0) * 1000),
        text: currentWords.join(' '),
        confidence,
      })
    }
    currentSpeaker = null
    currentStart = null
    currentEnd = null
    currentWords = []
    confSum = 0
    confCount = 0
  }

  for (const result of transcript.results ?? []) {
    if (result.type === 'word') {
      const content = result.alternatives?.[0]?.content ?? ''
      // Speechmatics json-v2 places the speaker label inside alternatives[0].speaker,
      // not at the top-level of the result. Fall back to result.speaker for any
      // legacy/test payloads that use the top-level field.
      const speaker = result.alternatives?.[0]?.speaker ?? result.speaker ?? 'S1'
      const conf = result.alternatives?.[0]?.confidence
      const wordStart = result.start_time ?? 0

      if (speaker !== currentSpeaker) {
        flushSegment()
        currentSpeaker = speaker
        currentStart = wordStart
      } else if (currentEnd !== null && wordStart - currentEnd > PAUSE_SPLIT_THRESHOLD_S) {
        // Long silence within the same speaker turn — start a new sub-segment.
        flushSegment()
        currentSpeaker = speaker
        currentStart = wordStart
      }

      currentEnd = result.end_time ?? currentEnd ?? 0
      currentWords.push(content)
      if (conf != null) {
        confSum += conf
        confCount++
      }
    } else if (result.type === 'punctuation' && result.attaches_to === 'previous') {
      const content = result.alternatives?.[0]?.content ?? ''
      // Attach directly to the last word — no space before comma/period/etc.
      if (currentWords.length > 0) {
        currentWords[currentWords.length - 1] += content
      }
      // Orphan punctuation (nothing flushed yet) is silently dropped.
    }
    // All other result types (e.g. "speaker_change" markers) are ignored.
  }

  flushSegment() // flush the final turn

  return { language, segments }
}

// ---------------------------------------------------------------------------
// API calls (I/O — not unit-tested directly)
// ---------------------------------------------------------------------------

function mimeTypeFromPath(path: string): string {
  const ext = extname(path).toLowerCase()
  const map: Record<string, string> = {
    '.webm': 'audio/webm',
    '.mp4': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
  }
  return map[ext] ?? 'application/octet-stream'
}

async function submitJob(audioPath: string, speakerCount?: number): Promise<string> {
  const audioBuffer = await readFile(audioPath)
  const mimeType = mimeTypeFromPath(audioPath)
  const ext = extname(audioPath) || '.webm'

  const jobConfig = buildJobConfig(speakerCount)
  log(`[speechmatics] submitting config: ${JSON.stringify(jobConfig)}`)
  log(`[speechmatics] audio: path=${audioPath}, size=${audioBuffer.length} bytes, mime=${mimeType}`)

  const formData = new FormData()
  formData.append('data_file', new Blob([audioBuffer], { type: mimeType }), `audio${ext}`)
  formData.append('config', JSON.stringify(jobConfig))

  const response = await speechmaticsRequest<JobResponse>('POST', '/v2/jobs', formData)
  log(`[speechmatics] job created: id=${response.id}`)
  return response.id
}

async function pollUntilDone(jobId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))

    const { job } = await speechmaticsRequest<JobStatusResponse>('GET', `/v2/jobs/${jobId}`)
    log(`[speechmatics] job ${jobId}: status=${job.status}`)

    if (job.status === 'done') return
    if (job.status === 'rejected') {
      throw new Error(
        `Speechmatics job ${jobId} was rejected: ${JSON.stringify(job.errors ?? [])}`,
      )
    }
    if (job.status === 'deleted') {
      throw new Error(`Speechmatics job ${jobId} was unexpectedly deleted during processing`)
    }
  }

  throw new Error(
    `Speechmatics job ${jobId} did not complete within ${POLL_TIMEOUT_MS / 60_000} minutes`,
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SpeechmaticsContext {
  meetingId?: string | null
  userId?: string | null
  /** Hint the diarizer with the known speaker count. Optional. */
  speakerCount?: number
}

/**
 * Transcribe the audio file at `audioPath` using the Speechmatics Batch API.
 * Handles files of any duration — no chunking required.
 *
 * If ffmpeg is available, the audio is transcoded to MP3 first. This avoids
 * Speechmatics rejecting Chrome's streaming WebM files, which lack proper
 * duration headers in the container.
 *
 * @param audioPath  Absolute path to the audio file on disk (any format).
 * @param ctx        Optional attribution context for usage logging.
 * @returns          TranscriptResult with segments in milliseconds — same
 *                   contract as the old Gemini `transcribeAudio`.
 */
export async function transcribeWithSpeechmatics(
  audioPath: string,
  ctx?: SpeechmaticsContext,
): Promise<TranscriptResult> {
  log(`[speechmatics] submitting job for ${audioPath}`)

  // Transcode to MP3 when ffmpeg is available so Speechmatics receives a
  // universally-accepted format with proper headers, regardless of what the
  // browser recorded.  Falls back to the original file if ffmpeg is absent.
  let jobAudioPath = audioPath
  let tmpTranscodeDir: string | null = null

  const ffmpegAvailable = await isFfmpegAvailable()
  if (ffmpegAvailable && !audioPath.endsWith('.mp3')) {
    tmpTranscodeDir = join(tmpdir(), `sm-transcode-${randomUUID()}`)
    try {
      jobAudioPath = await transcodeForGemini(audioPath, tmpTranscodeDir)
      log(`[speechmatics] transcoded to mp3: ${jobAudioPath}`)
    } catch (e) {
      log(`[speechmatics] ffmpeg transcode failed, submitting original — ${e}`)
      jobAudioPath = audioPath
      tmpTranscodeDir = null
    }
  }

  try {
    const jobId = await submitJob(jobAudioPath, ctx?.speakerCount)
    log(`[speechmatics] job submitted: id=${jobId}`)

    await pollUntilDone(jobId)
    log(`[speechmatics] job done, fetching transcript`)

    const raw = await speechmaticsRequest<SpeechmaticsTranscript>(
      'GET',
      `/v2/jobs/${jobId}/transcript?format=json-v2`,
    )

    // Compute audio duration from the last word's end_time (seconds).
    // This is the most reliable measure of what Speechmatics actually processed.
    const audioSeconds = (raw.results ?? []).reduce(
      (max, r) => (r.end_time != null && r.end_time > max ? r.end_time : max),
      0,
    )
    logUsage({
      provider: 'speechmatics', model: 'standard', operation: 'transcribe',
      unit: 'audio_seconds', quantity: audioSeconds,
      audio_seconds: audioSeconds,
      meeting_id: ctx?.meetingId, user_id: ctx?.userId,
    })

    // ── Debug: raw API response ───────────────────────────────────────────────
    log(`[speechmatics] raw.metadata: ${JSON.stringify(raw.metadata)}`)
    log(`[speechmatics] raw.speakers: ${JSON.stringify(raw.speakers)}`)
    log(`[speechmatics] raw.results count: ${raw.results?.length ?? 0}`)

    // Log first 5 word results to see what speaker labels are actually assigned
    const sampleWords = (raw.results ?? []).filter(r => r.type === 'word').slice(0, 5)
    log(`[speechmatics] sample words (first 5): ${JSON.stringify(sampleWords)}`)

    // Unique speaker labels present across all word results.
    // Speaker is in alternatives[0].speaker in json-v2 format.
    const allSpeakers = [...new Set(
      (raw.results ?? []).filter(r => r.type === 'word')
        .map(r => r.alternatives?.[0]?.speaker ?? r.speaker ?? '(none)')
    )]
    log(`[speechmatics] unique speaker labels in results: ${JSON.stringify(allSpeakers)}`)
    // ─────────────────────────────────────────────────────────────────────────

    const result = parseTranscriptResponse(raw)
    log(
      `[speechmatics] parsed: language=${result.language}, segments=${result.segments.length}`,
    )

    if (result.segments.length === 0) {
      console.warn(
        '[speechmatics] 0 segments returned — audio may be silent or in an unsupported codec',
      )
    }

    return result
  } finally {
    if (tmpTranscodeDir) {
      rm(tmpTranscodeDir, { recursive: true }).catch((e: unknown) => {
        console.warn('[speechmatics] failed to delete transcode temp dir:', e)
      })
    }
  }
}
