// Framework-agnostic audio capture helpers.
// All functions run in the browser only — do not import from server code.

import { getSupportedMimeType } from './support'

export interface CaptureStreams {
  micStream: MediaStream
  displayStream: MediaStream
}

export interface MixResult {
  mixedStream: MediaStream
  hasDisplayAudio: boolean
  audioContext: AudioContext
}

export interface RecorderKit {
  recorder: MediaRecorder
  getBlob: () => Blob
  mimeType: string
}

/**
 * Acquire mic + display streams.
 *
 * Design notes:
 * - Mic is requested first so the user sees a familiar permission prompt before
 *   the display picker appears.
 * - getDisplayMedia requires video:true to show the OS sharing picker; we keep
 *   the video track alive only long enough to listen for the 'ended' event
 *   (fired when the user clicks "Stop sharing" in the browser bar). The track
 *   is stopped in cleanup() inside useRecorder — not here — so the hook can
 *   attach the listener before the track disappears.
 * - If the user denies or cancels either permission, the other stream is
 *   cleaned up before rethrowing.
 */
export async function startCapture(): Promise<CaptureStreams> {
  // Fail fast on mic denial before the display picker appears
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  })

  let displayStream: MediaStream
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,   // required to show the OS sharing picker
      audio: true,   // request system/tab audio — user may or may not grant it
    })
  } catch (err) {
    micStream.getTracks().forEach((t) => t.stop())
    throw err
  }

  return { micStream, displayStream }
}

/**
 * Mix display audio and mic into a single audio-only stream using the Web
 * Audio API.
 *
 * If the display stream has no audio tracks (user didn't share audio),
 * hasDisplayAudio is false and the mix contains only mic audio — recording
 * continues so the UI can warn rather than silently failing.
 */
export function mixToMonoAudioStream(
  displayStream: MediaStream,
  micStream: MediaStream,
): MixResult {
  const audioContext = new AudioContext()
  const destination = audioContext.createMediaStreamDestination()

  const displayAudioTracks = displayStream.getAudioTracks()
  const hasDisplayAudio = displayAudioTracks.length > 0

  if (hasDisplayAudio) {
    // createMediaStreamSource expects a stream, not loose tracks
    const displayAudioOnly = new MediaStream(displayAudioTracks)
    const displaySource = audioContext.createMediaStreamSource(displayAudioOnly)
    displaySource.connect(destination)
  }

  // Mic is always connected
  const micSource = audioContext.createMediaStreamSource(micStream)
  micSource.connect(destination)

  return { mixedStream: destination.stream, hasDisplayAudio, audioContext }
}

/**
 * Wrap a mixed stream in a MediaRecorder that collects Blob chunks.
 *
 * Prefers 'audio/webm;codecs=opus'. Falls back through the list in support.ts.
 * The caller must call recorder.start() and listen for recorder.onstop.
 */
export function createRecorder(mixedStream: MediaStream): RecorderKit {
  const mimeType = getSupportedMimeType()
  const recorder = new MediaRecorder(
    mixedStream,
    mimeType ? { mimeType } : undefined,
  )
  const chunks: Blob[] = []

  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  // recorder.mimeType reflects what the browser will actually use
  const getBlob = (): Blob =>
    new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })

  return { recorder, getBlob, mimeType: recorder.mimeType }
}
