'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRecorder } from '@/lib/audio/useRecorder'
import { checkRecordingSupport } from '@/lib/audio/support'
import { useUpload } from '@/lib/upload/useUpload'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function RecorderUI() {
  const {
    state,
    elapsedSeconds,
    blob,
    objectUrl,
    mimeType,
    trackInfo,
    error,
    supported,
    start,
    stop,
    reset,
  } = useRecorder()

  const [missingCapabilities, setMissingCapabilities] = useState<string[]>([])
  useEffect(() => { setMissingCapabilities(checkRecordingSupport().missingCapabilities) }, [])
  const { state: uploadState, meetingId, error: uploadError, upload, reset: resetUpload } = useUpload()
  // Capture startedAt when recording begins so we pass the right timestamp
  const startedAtRef = useRef<string | null>(null)

  // ── Unsupported browser ────────────────────────────────────────────────
  if (!supported) {
    return (
      <div style={S.card}>
        <h2 style={{ marginTop: 0, color: '#b00020' }}>Browser not supported</h2>
        <p>This browser is missing required capabilities:</p>
        <ul style={{ paddingLeft: '1.2em' }}>
          {missingCapabilities.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p style={{ marginBottom: 0 }}>
          Use <strong>Chrome 74+</strong> or <strong>Edge 79+</strong>.
          Firefox and Safari do not reliably expose system/tab audio through
          the screen-capture API.
        </p>
      </div>
    )
  }

  const ext = mimeType?.split('/')[1]?.split(';')[0] ?? 'webm'

  return (
    <div style={S.card}>
      <h2 style={{ marginTop: 0 }}>Recorder</h2>

      {/* ── Pre-start instructions ────────────────────────────────────── */}
      {state === 'idle' && (
        <div style={S.info}>
          <strong>Audio-only recording</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: '1.4em', lineHeight: 1.7 }}>
            <li>
              Captures your <strong>microphone</strong> mixed with{' '}
              <strong>tab or window audio</strong>. Video is{' '}
              <strong>never recorded or saved</strong> — it only triggers the
              browser&apos;s sharing dialog.
            </li>
            <li>
              In the dialog: choose <em>This Tab</em> (recommended on Chrome),
              then tick{' '}
              <strong>&ldquo;Share tab audio&rdquo;</strong> /
              &ldquo;Share audio&rdquo; before clicking Share. Without that
              checkbox only your mic is recorded.
            </li>
          </ul>
        </div>
      )}

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <div style={S.row}>
        {state === 'idle' && (
          <button
            style={S.btnGreen}
            onClick={() => {
              startedAtRef.current = new Date().toISOString()
              void start()
            }}
          >
            ● Start
          </button>
        )}

        {state === 'recording' && (
          <>
            <span style={S.timer}>⏺ {formatTime(elapsedSeconds)}</span>
            <button style={S.btnRed} onClick={stop}>
              ■ Stop
            </button>
          </>
        )}

        {(state === 'stopped' || state === 'error') && (
          <button
            style={S.btnGrey}
            onClick={() => {
              reset()
              resetUpload()
              startedAtRef.current = null
            }}
          >
            ↺ Reset
          </button>
        )}
      </div>

      {/* ── No-system-audio warning ───────────────────────────────────── */}
      {state === 'recording' && trackInfo && !trackInfo.hasDisplayAudio && (
        <div style={S.warn}>
          ⚠ <strong>No system / display audio detected.</strong> Only your
          microphone is being recorded. To capture the other participants,
          stop recording and share again — in the browser&apos;s sharing
          picker, tick <em>&quot;Share tab audio&quot;</em> or{' '}
          <em>&quot;Share system audio&quot;</em>.
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && <div style={S.err}>✗ {error}</div>}

      {/* ── Playback + download ───────────────────────────────────────── */}
      {state === 'stopped' && objectUrl && (
        <div style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={objectUrl} style={{ width: '100%' }} />
          <div style={{ ...S.row, marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
            <a
              href={objectUrl}
              download={`recording.${ext}`}
              style={S.link}
            >
              ↓ Download (.{ext})
            </a>
            {blob && (
              <span style={S.meta}>
                {(blob.size / 1024).toFixed(1)} KB &middot; {mimeType}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Save recording ───────────────────────────────────────────── */}
      {state === 'stopped' && blob && (
        <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
          {uploadState === 'idle' && (
            <button
              style={S.btnBlue}
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
            <p style={{ color: '#555', fontSize: 14, margin: 0 }}>
              Uploading… please wait
            </p>
          )}

          {uploadState === 'error' && (
            <div style={S.err}>
              ✗ {uploadError}
              <button
                style={{ ...S.btnGrey, marginLeft: 12, fontSize: 13, padding: '5px 14px' }}
                onClick={resetUpload}
              >
                Retry
              </button>
            </div>
          )}

          {uploadState === 'done' && meetingId && (
            <div style={S.success}>
              ✓ Saved!{' '}
              <Link href="/meetings" style={S.link}>
                View all meetings →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Debug area ───────────────────────────────────────────────── */}
      <details style={{ marginTop: 24 }} open={state === 'error'}>
        <summary style={{ cursor: 'pointer', color: '#888', fontSize: 13 }}>
          Debug info (also in browser console as [Recorder] …)
        </summary>
        <pre style={S.debug}>
          {JSON.stringify(
            {
              state,
              elapsedSeconds,
              trackInfo,
              mimeType,
              blobKB: blob ? +(blob.size / 1024).toFixed(1) : null,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  card: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 560,
    margin: '0 auto',
    padding: '1.5rem',
    border: '1px solid #ddd',
    borderRadius: 8,
    boxShadow: '0 1px 4px rgba(0,0,0,.07)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  timer: {
    fontFamily: 'monospace',
    fontSize: 22,
    color: '#c00',
    minWidth: 72,
  },
  btnGreen: {
    padding: '9px 22px',
    background: '#1a7f37',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
  },
  btnRed: {
    padding: '9px 22px',
    background: '#c00',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
  },
  btnGrey: {
    padding: '9px 22px',
    background: '#555',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 15,
  },
  info: {
    background: '#f0f7ff',
    border: '1px solid #b8d4f5',
    borderRadius: 6,
    padding: '10px 14px',
    marginBottom: 14,
    fontSize: 14,
    lineHeight: 1.5,
    color: '#1a3a5c',
  },
  warn: {
    background: '#fff8e1',
    border: '1px solid #e6b800',
    borderRadius: 6,
    padding: '10px 14px',
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 1.5,
  },
  err: {
    background: '#fff0f0',
    border: '1px solid #f55',
    borderRadius: 6,
    padding: '10px 14px',
    marginBottom: 12,
    color: '#b00020',
    fontSize: 14,
  },
  btnBlue: {
    padding: '9px 22px',
    background: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 600,
  },
  success: {
    background: '#f0fff4',
    border: '1px solid #2da44e',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#1a7f37',
    fontSize: 14,
  },
  link: {
    color: '#0066cc',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
  },
  meta: {
    color: '#666',
    fontSize: 13,
  },
  debug: {
    background: '#f5f5f5',
    padding: 12,
    borderRadius: 4,
    fontSize: 12,
    overflow: 'auto',
    marginTop: 8,
    lineHeight: 1.6,
  },
}
