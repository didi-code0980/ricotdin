'use client'

import type { CSSProperties } from 'react'
import { useRecorder } from '@/lib/audio/useRecorder'
import { checkRecordingSupport } from '@/lib/audio/support'

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

  const { missingCapabilities } = checkRecordingSupport()

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

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <div style={S.row}>
        {state === 'idle' && (
          <button style={S.btnGreen} onClick={() => void start()}>
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
          <button style={S.btnGrey} onClick={reset}>
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
