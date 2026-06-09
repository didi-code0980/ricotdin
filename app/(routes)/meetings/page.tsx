'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { browserClient } from '@/lib/supabase/browser'
import { ensureAnonymousSession } from '@/lib/supabase/auth'
import type { Meeting, MeetingStatus } from '@/types/database'

type LoadState = 'loading' | 'ready' | 'error'

// Poll while any meeting is in an in-flight state
const POLL_INTERVAL_MS = 3_000
const IN_FLIGHT: MeetingStatus[] = ['pending', 'processing']

export default function MeetingsPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(silent = false) {
      try {
        if (!silent) await ensureAnonymousSession()
        const { data, error: dbError } = await browserClient
          .from('meetings')
          .select('*')
          .order('created_at', { ascending: false })

        if (cancelled) return
        if (dbError) throw new Error(dbError.message)
        const rows = (data as Meeting[]) ?? []
        setMeetings(rows)
        setLoadState('ready')

        // Schedule next poll if any meeting is still in-flight
        const hasInFlight = rows.some((m) => IN_FLIGHT.includes(m.status))
        if (hasInFlight) {
          pollRef.current = setTimeout(() => { void load(true) }, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load meetings.')
        setLoadState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [])

  return (
    <main style={S.main}>
      <div style={S.header}>
        <h1 style={{ margin: 0 }}>Meetings</h1>
        <Link href="/record" style={S.btnNew}>
          + New recording
        </Link>
      </div>

      {loadState === 'loading' && (
        <p style={S.muted}>Loading…</p>
      )}

      {loadState === 'error' && (
        <div style={S.err}>✗ {error}</div>
      )}

      {loadState === 'ready' && meetings.length === 0 && (
        <div style={S.empty}>
          <p>No meetings yet.</p>
          <Link href="/record" style={S.btnNew}>
            Record your first meeting →
          </Link>
        </div>
      )}

      {loadState === 'ready' && meetings.length > 0 && (
        <ul style={S.list}>
          {meetings.map((m) => (
            <li key={m.id} style={S.item}>
              <Link href={`/meetings/${m.id}`} style={S.itemLink}>
                <div style={S.itemTop}>
                  <span style={S.title}>{m.title}</span>
                  <StatusBadge status={m.status} />
                </div>
                <div style={S.meta}>
                  {formatDate(m.created_at)}
                  {m.duration_seconds != null && (
                    <> &middot; {formatDuration(m.duration_seconds)}</>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function StatusBadge({ status }: { status: Meeting['status'] }) {
  const colors: Record<Meeting['status'], string> = {
    pending: '#b45309',
    processing: '#1d4ed8',
    done: '#166534',
    failed: '#991b1b',
  }
  const bg: Record<Meeting['status'], string> = {
    pending: '#fef3c7',
    processing: '#dbeafe',
    done: '#dcfce7',
    failed: '#fee2e2',
  }
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 99,
        background: bg[status],
        color: colors[status],
      }}
    >
      {status}
    </span>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  main: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 720,
    margin: '0 auto',
    padding: '2rem 1rem',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.5rem',
  },
  btnNew: {
    padding: '8px 18px',
    background: '#1a7f37',
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 600,
  },
  muted: { color: '#888', fontSize: 14 },
  err: {
    background: '#fff0f0',
    border: '1px solid #f55',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#b00020',
    fontSize: 14,
  },
  empty: {
    textAlign: 'center',
    color: '#888',
    padding: '3rem 0',
    fontSize: 15,
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  item: {
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  itemLink: {
    display: 'block',
    padding: '14px 16px',
    textDecoration: 'none',
    color: 'inherit',
    background: '#fff',
  },
  itemTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontWeight: 600,
    fontSize: 15,
    color: '#111',
  },
  meta: {
    fontSize: 13,
    color: '#666',
  },
}
