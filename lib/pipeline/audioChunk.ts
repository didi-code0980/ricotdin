// Long-audio chunking via ffmpeg.
//
// Meetings longer than LONG_AUDIO_THRESHOLD_SECS are split into ~25-minute
// segments before transcription to stay within Gemini's per-request audio limit.
// Short recordings take the simple single-file path — no ffmpeg needed.
//
// If ffmpeg is not installed on the server and the recording is too long, a
// clear PipelineError is thrown rather than silently failing.

import { spawn } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { transcribeAudio } from '@/lib/gemini/transcribe'
import { PipelineError } from '@/lib/gemini/errors'
import type { TranscriptResult } from '@/types/pipeline'

// Trigger chunking when duration exceeds 28 min (conservative, under the
// ~30 min Gemini per-request audio limit).
const LONG_AUDIO_THRESHOLD_SECS = 28 * 60

// Each chunk is ~25 minutes so there's headroom for variances in keyframe
// placement when copying streams with -c copy.
const CHUNK_DURATION_SECS = 25 * 60

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'pipe' })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(
          new Error(`${cmd} exited with code ${code}. stderr: ${stderr.slice(-500)}`),
        )
      }
    })
    proc.on('error', (err) => {
      reject(err)
    })
  })
}

async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await runCommand('ffmpeg', ['-version'])
    return true
  } catch {
    return false
  }
}

async function splitAudio(
  audioPath: string,
  chunkDir: string,
  ext: string,
): Promise<string[]> {
  const pattern = join(chunkDir, `chunk_%03d${ext}`)
  await runCommand('ffmpeg', [
    '-i', audioPath,
    '-f', 'segment',
    '-segment_time', String(CHUNK_DURATION_SECS),
    '-c', 'copy',
    '-reset_timestamps', '1',
    '-y',
    pattern,
  ])

  const files = await readdir(chunkDir)
  const chunkFiles = files
    .filter((f) => /^chunk_\d+\.[a-z0-9]+$/.test(f))
    .sort()
    .map((f) => join(chunkDir, f))

  if (chunkFiles.length === 0) {
    throw new PipelineError(
      'ffmpeg produced no output chunk files — check audio format compatibility',
    )
  }
  return chunkFiles
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transcribe the audio at `audioPath`.
 *
 * • Short recordings (≤ 28 min): single Gemini call via transcribeAudio().
 * • Long recordings (> 28 min): split with ffmpeg, transcribe each chunk,
 *   stitch segments back together with corrected time offsets.
 *
 * @param audioPath       Absolute path to the audio file on disk.
 * @param mimeType        MIME type of the audio.
 * @param durationSeconds Known duration in seconds (from meetings.duration_seconds).
 *                        Pass 0 to skip the long-audio check (single-file path).
 * @param tmpDir          Directory where chunk files may be written (caller cleans up).
 */
export async function transcribeWithChunking(
  audioPath: string,
  mimeType: string,
  durationSeconds: number,
  tmpDir: string,
): Promise<TranscriptResult> {
  // Short-circuit: use the simple single-file path for recordings under the limit
  if (durationSeconds <= LONG_AUDIO_THRESHOLD_SECS) {
    console.log(`[audioChunk] duration ${Math.round(durationSeconds / 60)}m — single-file path`)
    return transcribeAudio(audioPath, mimeType)
  }

  console.log(
    `[audioChunk] duration ${Math.round(durationSeconds / 60)}m — long audio, checking ffmpeg`,
  )

  if (!(await isFfmpegAvailable())) {
    throw new PipelineError(
      `Recording is ${Math.round(durationSeconds / 60)} minutes, which exceeds the ` +
        `30-minute per-request limit for Gemini audio. ` +
        `Install ffmpeg on the server to enable automatic splitting of long recordings. ` +
        `(ffmpeg was not found in PATH)`,
    )
  }

  // tmpDir is created and owned by the caller (processMeeting). We write
  // chunk files into it and leave cleanup to the caller's finally block.
  await mkdir(tmpDir, { recursive: true })
  const ext = extname(audioPath) || '.webm'

  console.log(`[audioChunk] splitting into ~${CHUNK_DURATION_SECS / 60}-min chunks`)
  const chunkFiles = await splitAudio(audioPath, tmpDir, ext)
  console.log(`[audioChunk] ${chunkFiles.length} chunk(s) produced`)

  const allSegments: TranscriptResult['segments'] = []
  let language = 'unknown'
  let offsetMs = 0

  for (let i = 0; i < chunkFiles.length; i++) {
    console.log(`[audioChunk] transcribing chunk ${i + 1}/${chunkFiles.length}`)
    const chunkResult = await transcribeAudio(chunkFiles[i], mimeType)

    if (i === 0) language = chunkResult.language

    for (const seg of chunkResult.segments) {
      allSegments.push({
        ...seg,
        start_ms: seg.start_ms + offsetMs,
        end_ms: seg.end_ms + offsetMs,
      })
    }

    // Timestamps within each chunk are relative to that chunk's start.
    // Offset the next chunk by one configured chunk duration. This is an
    // approximation (ffmpeg -c copy aligns to keyframes), but Gemini
    // timestamps are already approximate so this is good enough for MVP.
    offsetMs += CHUNK_DURATION_SECS * 1_000
  }

  return { language, segments: allSegments }
}
