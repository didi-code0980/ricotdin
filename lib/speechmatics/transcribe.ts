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

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { log } from '@/lib/logger'
import { speechmaticsRequest } from './client'
import type { TranscriptResult } from '@/types/pipeline'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5_000      // check job status every 5 s
const POLL_TIMEOUT_MS = 30 * 60_000 // give up after 30 min

// Sent as the `config` field in the multipart job submission.
const JOB_CONFIG = {
  type: 'transcription',
  transcription_config: {
    language: 'auto',     // Speechmatics auto-detects and returns the BCP-47 code
    diarization: 'speaker',
  },
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
  alternatives?: Array<{ content: string; confidence?: number; language?: string }>
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

  function flushSegment() {
    if (currentSpeaker !== null && currentWords.length > 0) {
      segments.push({
        speaker: formatSpeakerLabel(currentSpeaker),
        start_ms: Math.round((currentStart ?? 0) * 1000),
        end_ms: Math.round((currentEnd ?? 0) * 1000),
        text: currentWords.join(' '),
      })
    }
    currentSpeaker = null
    currentStart = null
    currentEnd = null
    currentWords = []
  }

  for (const result of transcript.results ?? []) {
    if (result.type === 'word') {
      const content = result.alternatives?.[0]?.content ?? ''
      const speaker = result.speaker ?? 'S1'

      if (speaker !== currentSpeaker) {
        flushSegment()
        currentSpeaker = speaker
        currentStart = result.start_time ?? 0
      }

      currentEnd = result.end_time ?? currentEnd ?? 0
      currentWords.push(content)
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

async function submitJob(audioPath: string): Promise<string> {
  const audioBuffer = await readFile(audioPath)
  const mimeType = mimeTypeFromPath(audioPath)

  const formData = new FormData()
  formData.append('data_file', new Blob([audioBuffer], { type: mimeType }), 'audio')
  formData.append('config', JSON.stringify(JOB_CONFIG))

  const response = await speechmaticsRequest<JobResponse>('POST', '/v2/jobs', formData)
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

/**
 * Transcribe the audio file at `audioPath` using the Speechmatics Batch API.
 * Handles files of any duration — no chunking or ffmpeg required.
 *
 * @param audioPath  Absolute path to the audio file on disk (any format).
 * @returns          TranscriptResult with segments in milliseconds — same
 *                   contract as the old Gemini `transcribeAudio`.
 */
export async function transcribeWithSpeechmatics(
  audioPath: string,
): Promise<TranscriptResult> {
  log(`[speechmatics] submitting job for ${audioPath}`)

  const jobId = await submitJob(audioPath)
  log(`[speechmatics] job submitted: id=${jobId}`)

  await pollUntilDone(jobId)
  log(`[speechmatics] job done, fetching transcript`)

  const raw = await speechmaticsRequest<SpeechmaticsTranscript>(
    'GET',
    `/v2/jobs/${jobId}/transcript?format=json-v2`,
  )

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
}
