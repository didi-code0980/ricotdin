'use client'

// RecorderUI is imported synchronously so it goes into this page's bundle —
// no second network request, no dynamic chunk that a reverse proxy can silently drop.
// Client-only rendering is gated by `mounted` (useEffect fires only in the browser).
// The SSR guards in support.ts + useEffect pattern in useRecorder prevent any
// window/navigator access on the server.
import { useEffect, useState } from 'react'
import RecorderUI from '@/components/RecorderUI'

export default function RecordPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '2rem 1rem',
        minHeight: '100vh',
        background: '#fafafa',
      }}
    >
      <h1 style={{ textAlign: 'center', marginBottom: 4 }}>
        Phase 1 — Recording Test
      </h1>
      <p
        style={{
          textAlign: 'center',
          color: '#666',
          fontSize: 14,
          margin: '0 auto 2rem',
          maxWidth: 480,
        }}
      >
        Chrome / Edge only · captures mic + tab / system audio and mixes them
        into a single file · check the browser console for{' '}
        <code>[Recorder]</code> logs
      </p>
      {mounted ? (
        <RecorderUI />
      ) : (
        <p
          style={{
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            color: '#888',
          }}
        >
          Loading recorder…
        </p>
      )}
    </main>
  )
}
