// Long-audio transcoding and chunking for Gemini.
//
// Gemini's audio understanding does NOT support WebM. All audio is transcoded
// to mp3 (mono, 16kHz, 64kbps) via ffmpeg before upload — either as a single
// file (short recordings) or as segmented mp3 chunks in one ffmpeg pass (long
// recordings). Both paths decode the source exactly once; no double-decode.
//
// The tmpDir passed by processMeeting owns all intermediate files; the caller's
// finally block cleans the whole directory after processing.

import { transcribeAudio } from '@/lib/gemini/transcribe'
import { isFfmpegAvailable, transcodeForGemini, transcodeAndChunk } from '@/lib/audio/transcode'
import { PipelineError } from '@/lib/gemini/errors'
import type { TranscriptResult } from '@/types/pipeline'

// Trigger chunking when duration exceeds 28 min (conservative, under the
// ~30 min Gemini per-request audio limit).
const LONG_AUDIO_THRESHOLD_SECS = 28 * 60

// Each chunk is ~25 minutes — headroom for encoding variances.
const CHUNK_DURATION_SECS = 25 * 60

/**
 * Transcribe the audio at `audioPath` (any format, typically .webm from the browser).
 *
 * • Short recordings (≤ 28 min): transcode webm→mp3, single Gemini call.
 * • Long recordings (> 28 min): transcode + split in one ffmpeg pass, transcribe
 *   each mp3 chunk, stitch segments back together with corrected time offsets.
 *
 * @param audioPath       Absolute path to the source audio file (e.g. .webm).
 * @param durationSeconds Known duration in seconds (0 = unknown → short path).
 * @param tmpDir          Directory for all intermediate files (caller cleans up).
 */
export async function transcribeWithChunking(
  audioPath: string,
  durationSeconds: number,
  tmpDir: string,
): Promise<TranscriptResult> {
  if (durationSeconds <= LONG_AUDIO_THRESHOLD_SECS) {
    console.log(
      `[audioChunk] duration ${Math.round(durationSeconds / 60)}m — transcoding webm→mp3`,
    )
    const mp3Path = await transcodeForGemini(audioPath, tmpDir)
    return transcribeAudio(mp3Path, 'audio/mp3')
  }

  console.log(
    `[audioChunk] duration ${Math.round(durationSeconds / 60)}m — long audio, checking ffmpeg`,
  )

  if (!(await isFfmpegAvailable())) {
    throw new PipelineError(
      `Recording is ${Math.round(durationSeconds / 60)} minutes, which exceeds the ` +
        `30-minute per-request limit for Gemini audio. ` +
        `Install ffmpeg to enable automatic splitting and transcoding of long recordings. ` +
        `(ffmpeg was not found in PATH)`,
    )
  }

  console.log(
    `[audioChunk] transcoding + splitting into ~${CHUNK_DURATION_SECS / 60}-min mp3 chunks`,
  )
  const chunkFiles = await transcodeAndChunk(audioPath, tmpDir, CHUNK_DURATION_SECS)
  console.log(`[audioChunk] ${chunkFiles.length} chunk(s) produced`)

  const allSegments: TranscriptResult['segments'] = []
  let language = 'unknown'
  let offsetMs = 0

  for (let i = 0; i < chunkFiles.length; i++) {
    console.log(`[audioChunk] transcribing chunk ${i + 1}/${chunkFiles.length}`)
    const chunkResult = await transcribeAudio(chunkFiles[i], 'audio/mp3')

    if (i === 0) language = chunkResult.language

    for (const seg of chunkResult.segments) {
      allSegments.push({
        ...seg,
        start_ms: seg.start_ms + offsetMs,
        end_ms: seg.end_ms + offsetMs,
      })
    }

    // Timestamps within each chunk are relative to its start. Offset the next
    // chunk by one configured chunk duration. This is an approximation but
    // Gemini timestamps are already approximate, so it's fine for MVP.
    offsetMs += CHUNK_DURATION_SECS * 1_000
  }

  return { language, segments: allSegments }
}
