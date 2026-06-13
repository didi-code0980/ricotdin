'use client'

import { useEffect, useState } from 'react'
import RecorderUI from '@/components/RecorderUI'

export default function RecordPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-4xl font-bold text-b-fg leading-tight mb-2">
          New <em className="italic text-b-terra">Recording</em>
        </h1>
        <p className="text-sm text-b-fg/50 font-sans leading-relaxed max-w-md mx-auto">
          Chrome &amp; Edge only · captures mic + tab audio · video is{' '}
          <span className="font-semibold text-b-fg/60">never recorded or saved</span>
        </p>
      </div>

      {mounted ? (
        <RecorderUI />
      ) : (
        <div className="card-botanical text-center py-10 text-sm text-b-fg/40 font-sans animate-pulse">
          Loading recorder…
        </div>
      )}
    </div>
  )
}
