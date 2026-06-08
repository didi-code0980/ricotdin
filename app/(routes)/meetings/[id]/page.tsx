'use client'

// PLACEHOLDER — Phase 4 will build the full meeting detail UI.
// For now: shows the meeting's status and basic metadata.

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'
import { ensureAnonymousSession } from '@/lib/supabase/auth'
import type { Meeting } from '@/types/database'

export default function MeetingDetailPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : ''
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      try {
        await ensureAnonymousSession()
        const { data, error: dbError } = await browserClient
          .from('meetings')
          .select('*')
          .eq('id', id)
          .single()

        if (cancelled) return
        if (dbError) throw new Error(dbError.message)
        setMeeting(data as Meeting)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load meeting.')
      }
    }

    void load()
    return () => { cancelled = true }
  }, [id])

  return (
    <main style={S.main}>
      <Link href="/meetings" style={S.back}>
        ← All meetings
      </Link>

      {error && <div style={S.err}>✗ {error}</div>}

      {!meeting && !error && <p style={S.muted}>Loading…</p>}

      {meeting && (
        <div>
          <h1 style={{ marginBottom: 8 }}>{meeting.title}</h1>
          <p style={S.muted}>
            {new Date(meeting.created_at).toLocaleString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
            {meeting.duration_seconds != null && (
              <> &middot; {Math.floor(meeting.duration_seconds / 60)}m {meeting.duration_seconds % 60}s</>
            )}
          </p>

          <div style={S.statusBox}>
            <strong>Status:</strong>{' '}
            <span style={{ textTransform: 'capitalize' }}>{meeting.status}</span>
            {meeting.status === 'pending' && (
              <span style={S.hint}>
                {' '}— transcript and notes will appear here after processing (Phase 3).
              </span>
            )}
            {meeting.status === 'failed' && meeting.error_message && (
              <div style={S.err}>{meeting.error_message}</div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

const S: Record<string, CSSProperties> = {
  main: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 720,
    margin: '0 auto',
    padding: '2rem 1rem',
  },
  back: {
    display: 'inline-block',
    color: '#0066cc',
    textDecoration: 'none',
    fontSize: 14,
    marginBottom: '1.5rem',
  },
  muted: { color: '#888', fontSize: 14 },
  err: {
    background: '#fff0f0',
    border: '1px solid #f55',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#b00020',
    fontSize: 14,
    marginTop: 8,
  },
  statusBox: {
    marginTop: 16,
    padding: '12px 16px',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    fontSize: 14,
  },
  hint: { color: '#666' },
}
