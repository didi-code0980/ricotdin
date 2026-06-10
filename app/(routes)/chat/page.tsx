'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ChatPanel from '@/components/ChatPanel'
import type { Citation } from '@/types/database'

export default function ChatPage() {
  const router = useRouter()

  function handleCitationClick(citation: Citation) {
    // Navigate to the meeting and let the user seek manually using the timestamp
    // shown on the citation chip — full deep-linking is Phase 6 scope.
    void router.push(`/meetings/${citation.meeting_id}`)
  }

  return (
    <main style={S.main}>
      <div style={S.header}>
        <Link href="/meetings" style={S.back}>← Meetings</Link>
        <h1 style={S.h1}>Ask about your meetings</h1>
        <p style={S.sub}>
          AI-powered Q&amp;A across all your processed meeting transcripts.
          Click a timestamp chip to jump to that meeting.
        </p>
      </div>

      <div style={S.card}>
        <ChatPanel
          meetingId={null}
          onCitationClick={handleCitationClick}
        />
      </div>
    </main>
  )
}

const S: Record<string, CSSProperties> = {
  main: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 760,
    margin: '0 auto',
    padding: '2rem 1rem',
  },
  header: {
    marginBottom: 20,
  },
  back: {
    display: 'inline-block',
    color: '#0066cc',
    textDecoration: 'none',
    fontSize: 14,
    marginBottom: '1rem',
  },
  h1: {
    margin: '0 0 8px',
    fontSize: 22,
    fontWeight: 700,
    color: '#111',
  },
  sub: {
    margin: 0,
    fontSize: 14,
    color: '#666',
    lineHeight: 1.5,
  },
  card: {
    border: '1px solid #e5e5e5',
    borderRadius: 10,
    padding: '16px 20px',
    background: '#fff',
  },
}
