'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRecorder } from '@/lib/audio/useRecorder'
import { checkRecordingSupport } from '@/lib/audio/support'
import { useUpload } from '@/lib/upload/useUpload'
import FileUploadSection from '@/components/FileUploadSection'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function RecorderUI() {
  const {
    state, elapsedSeconds, blob, objectUrl, mimeType, trackInfo, error,
    supported, start, stop, reset,
  } = useRecorder()

  const [missingCapabilities, setMissingCapabilities] = useState<string[]>([])
  useEffect(() => { setMissingCapabilities(checkRecordingSupport().missingCapabilities) }, [])

  const { state: uploadState, meetingId, error: uploadError, upload, reset: resetUpload } = useUpload()
  const startedAtRef = useRef<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  // ── Unsupported browser ────────────────────────────────────────────────

  if (!supported) {
    return (
      <div className="card-botanical">
        <h2 className="font-serif text-xl font-bold text-red-600 mb-3">Browser not supported</h2>
        <p className="text-sm text-b-fg/70 font-sans mb-3">This browser is missing required capabilities:</p>
        <ul className="list-disc pl-5 text-sm text-b-fg/70 font-sans mb-4 space-y-1">
          {missingCapabilities.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <p className="text-sm text-b-fg/60 font-sans">
          Use <strong className="text-b-fg">Chrome 74+</strong> or <strong className="text-b-fg">Edge 79+</strong>.
          Firefox and Safari do not reliably expose system/tab audio.
        </p>
      </div>
    )
  }

  const ext = mimeType?.split('/')[1]?.split(';')[0] ?? 'webm'

  return (
    <div className="card-botanical flex flex-col gap-5">
      {/* Pre-start instructions */}
      {state === 'idle' && (
        <div className="bg-b-clay border border-b-border rounded-2xl px-4 py-4 text-sm text-b-fg/70 font-sans leading-relaxed">
          <p className="font-semibold text-b-fg mb-2">Audio-only recording</p>
          <ul className="list-disc pl-4 space-y-1.5 text-b-fg/60">
            <li>
              Captures your <strong className="text-b-fg">microphone</strong> mixed with{' '}
              <strong className="text-b-fg">tab or window audio</strong>. Video is{' '}
              <strong className="text-b-fg">never recorded or saved</strong> — it only triggers the browser&apos;s sharing dialog.
            </li>
            <li>
              In the dialog: choose <em>This Tab</em> (recommended on Chrome), then tick{' '}
              <strong className="text-b-fg">&ldquo;Share tab audio&rdquo;</strong> before clicking Share.
              Without that checkbox only your mic is recorded.
            </li>
          </ul>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4">
        {state === 'idle' && !showUpload && (
          <button
            className="btn-primary"
            onClick={() => {
              startedAtRef.current = new Date().toISOString()
              void start()
            }}
          >
            <span className="text-red-400">●</span> Start recording
          </button>
        )}

        {state === 'idle' && !showUpload && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowUpload(true)}
          >
            ↑ Upload a file
          </button>
        )}

        {state === 'recording' && (
          <>
            <span className="font-mono text-2xl font-bold text-b-terra tracking-widest">
              ⏺ {formatTime(elapsedSeconds)}
            </span>
            <button
              onClick={stop}
              className="px-6 py-2.5 rounded-full bg-b-terra text-white text-sm font-semibold uppercase tracking-widest border-0 cursor-pointer hover:opacity-90 transition-opacity"
            >
              ■ Stop
            </button>
          </>
        )}

        {(state === 'stopped' || state === 'error') && (
          <button
            onClick={() => { reset(); resetUpload(); startedAtRef.current = null }}
            className="btn-secondary"
          >
            ↺ Reset
          </button>
        )}
      </div>

      {/* File upload section — shown when user picks "Upload a file" in idle state */}
      {state === 'idle' && showUpload && (
        <FileUploadSection onCancel={() => setShowUpload(false)} />
      )}

      {/* No system audio warning */}
      {state === 'recording' && trackInfo && !trackInfo.hasDisplayAudio && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-700 font-sans">
          <strong>No system audio detected.</strong> Only your microphone is recording.
          Stop and share again — tick <em>&ldquo;Share tab audio&rdquo;</em> in the picker.
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 font-sans">
          {error}
        </div>
      )}

      {/* Playback + download */}
      {state === 'stopped' && objectUrl && (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={objectUrl} className="w-full rounded-xl" />
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href={objectUrl}
              download={`recording.${ext}`}
              className="text-sm text-b-primary font-sans hover:underline"
            >
              ↓ Download (.{ext})
            </a>
            {blob && (
              <span className="text-xs text-b-fg/40 font-sans">
                {(blob.size / 1024).toFixed(1)} KB · {mimeType}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Save recording */}
      {state === 'stopped' && blob && (
        <div className="border-t border-b-border pt-5">
          {uploadState === 'idle' && (
            <button
              className="btn-primary"
              onClick={() => {
                void upload(blob, {
                  durationSeconds: elapsedSeconds,
                  startedAt: startedAtRef.current ?? new Date().toISOString(),
                  mimeType: mimeType ?? undefined,
                })
              }}
            >
              ↑ Save recording
            </button>
          )}

          {uploadState === 'uploading' && (
            <p className="text-sm text-b-fg/50 font-sans animate-pulse">Uploading… please wait</p>
          )}

          {uploadState === 'error' && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-600 font-sans">{uploadError}</span>
              <button onClick={resetUpload} className="btn-secondary text-xs px-4 py-1.5">
                Retry
              </button>
            </div>
          )}

          {uploadState === 'done' && meetingId && (
            <div className="bg-b-clay border border-b-primary/30 rounded-2xl px-4 py-3 text-sm text-b-fg font-sans">
              ✓ Saved!{' '}
              <Link href="/meetings" className="text-b-terra font-semibold hover:underline">
                View all meetings →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Debug info */}
      <details className="mt-2" open={state === 'error'}>
        <summary className="cursor-pointer text-xs text-b-fg/30 font-sans hover:text-b-fg/50">
          Debug info
        </summary>
        <pre className="mt-2 bg-b-clay rounded-xl p-3 text-xs overflow-auto leading-relaxed text-b-fg/60 font-mono">
          {JSON.stringify({ state, elapsedSeconds, trackInfo, mimeType, blobKB: blob ? +(blob.size / 1024).toFixed(1) : null }, null, 2)}
        </pre>
      </details>
    </div>
  )
}
