'use client'

// dynamic({ ssr: false }) ensures RecorderUI and all its browser-API calls
// (window.MediaRecorder, AudioContext, etc.) are only evaluated in the browser.
// This avoids hydration mismatches; 'use client' here is required for ssr:false.
import dynamic from 'next/dynamic'

const RecorderUI = dynamic(() => import('@/components/RecorderUI'), {
  ssr: false,
  loading: () => (
    <p
      style={{
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
        color: '#888',
      }}
    >
      Loading recorder…
    </p>
  ),
})

export default function RecordPage() {
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
      <RecorderUI />
    </main>
  )
}
