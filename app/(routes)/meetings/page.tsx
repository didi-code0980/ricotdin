'use client'

import type { KeyboardEvent } from 'react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { browserClient } from '@/lib/supabase/browser'
import { getAccessToken } from '@/lib/supabase/auth'
import type { Meeting, MeetingStatus } from '@/types/database'

type LoadState = 'loading' | 'ready' | 'error'

const POLL_INTERVAL_MS = 3_000
const IN_FLIGHT: MeetingStatus[] = ['pending', 'processing']

function sortMeetings(list: Meeting[]): Meeting[] {
  return [...list].sort((a, b) => {
    if (a.pinned_at && b.pinned_at) {
      return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime()
    }
    if (a.pinned_at) return -1
    if (b.pinned_at) return 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
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

function StatusBadge({ status }: { status: MeetingStatus }) {
  const cls: Record<MeetingStatus, string> = {
    pending:    'badge-pending',
    processing: 'badge-processing',
    done:       'badge-done',
    failed:     'badge-failed',
  }
  return <span className={cls[status]}>{status}</span>
}

export default function MeetingsPage() {
  const [loadState, setLoadState]     = useState<LoadState>('loading')
  const [meetings, setMeetings]       = useState<Meeting[]>([])
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionWarning, setActionWarning] = useState<string | null>(null)
  const [busyId, setBusyId]           = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editTitle, setEditTitle]     = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(silent = false) {
      try {
        const { data, error: dbError } = await browserClient
          .from('meetings')
          .select('*')
          .order('created_at', { ascending: false })

        if (cancelled) return
        if (dbError) throw new Error(dbError.message)
        const rows = sortMeetings((data as Meeting[]) ?? [])
        setMeetings(rows)
        if (!silent) setLoadState('ready')

        if (rows.some((m) => IN_FLIGHT.includes(m.status))) {
          pollRef.current = setTimeout(() => { void load(true) }, POLL_INTERVAL_MS)
        }
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load meetings.')
        setLoadState('error')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [])

  async function togglePin(m: Meeting) {
    const token = await getAccessToken()
    if (!token) return
    setActionError(null)
    setBusyId(m.id)

    const newPinnedAt = m.pinned_at ? null : new Date().toISOString()
    setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: newPinnedAt } : x)))

    try {
      const res = await fetch(`/api/meetings/${m.id}/pin`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { pinned_at?: string | null; error?: string }
      if (!res.ok) {
        setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: m.pinned_at } : x)))
        setActionError(data.error ?? 'Failed to update pin.')
      } else {
        setMeetings((prev) => sortMeetings(prev.map((x) =>
          x.id === m.id ? { ...x, pinned_at: data.pinned_at ?? null } : x,
        )))
      }
    } catch {
      setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: m.pinned_at } : x)))
      setActionError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  function startRename(m: Meeting) {
    setEditingId(m.id)
    setEditTitle(m.title)
    setActionError(null)
  }

  async function saveRename(meetingId: string) {
    const trimmed = editTitle.trim()
    if (!trimmed) { setActionError('Title must not be empty.'); return }

    const token = await getAccessToken()
    if (!token) return
    setActionError(null)
    setBusyId(meetingId)

    const prevTitle = meetings.find((m) => m.id === meetingId)?.title ?? ''
    setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, title: trimmed } : x))
    setEditingId(null)

    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: trimmed }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, title: prevTitle } : x))
        setActionError(data.error ?? 'Failed to rename meeting.')
      }
    } catch {
      setMeetings((prev) => prev.map((x) => x.id === meetingId ? { ...x, title: prevTitle } : x))
      setActionError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteMeeting(meetingId: string) {
    const token = await getAccessToken()
    if (!token) return
    setActionError(null)
    setActionWarning(null)
    setBusyId(meetingId)
    setConfirmDeleteId(null)

    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { ok?: boolean; warning?: string; error?: string }
      if (!res.ok) {
        setActionError(data.error ?? 'Failed to delete meeting.')
      } else {
        setMeetings((prev) => prev.filter((x) => x.id !== meetingId))
        if (data.warning) setActionWarning(data.warning)
      }
    } catch {
      setActionError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const confirmTarget = confirmDeleteId ? meetings.find((m) => m.id === confirmDeleteId) : null

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl font-bold text-b-fg leading-tight">
            Your <em className="italic text-b-terra">Meetings</em>
          </h1>
          <p className="mt-1 text-sm text-b-fg/50 font-sans">
            {meetings.length > 0 ? `${meetings.length} recording${meetings.length === 1 ? '' : 's'}` : 'No recordings yet'}
          </p>
        </div>
        <Link href="/record" className="btn-primary">
          + New recording
        </Link>
      </div>

      {/* Banners */}
      {actionError && (
        <div className="banner-error">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="opacity-60 hover:opacity-100 cursor-pointer bg-transparent border-0 text-sm">✕</button>
        </div>
      )}
      {actionWarning && (
        <div className="banner-warning">
          <span>{actionWarning}</span>
          <button onClick={() => setActionWarning(null)} className="opacity-60 hover:opacity-100 cursor-pointer bg-transparent border-0 text-sm">✕</button>
        </div>
      )}

      {/* Loading */}
      {loadState === 'loading' && (
        <div className="flex flex-col gap-3 mt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-3xl bg-b-clay animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {loadState === 'error' && (
        <div className="banner-error mt-2">{loadError}</div>
      )}

      {/* Empty state */}
      {loadState === 'ready' && meetings.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-b-clay flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🎙</span>
          </div>
          <p className="font-serif text-xl text-b-fg mb-2">No meetings yet</p>
          <p className="text-sm text-b-fg/50 font-sans mb-6">Record your first meeting to get started.</p>
          <Link href="/record" className="btn-primary">
            Record your first meeting
          </Link>
        </div>
      )}

      {/* Meeting cards */}
      {loadState === 'ready' && meetings.length > 0 && (
        <ul className="flex flex-col gap-3">
          {meetings.map((m) => (
            <li key={m.id}>
              <div className={[
                'bg-white rounded-3xl border transition-all duration-300 overflow-hidden',
                m.pinned_at
                  ? 'border-b-primary/50 shadow-b-md'
                  : 'border-b-border shadow-b-sm hover:shadow-b-md hover:-translate-y-0.5',
              ].join(' ')}>
                <div className="flex items-center gap-3 px-5 py-4">
                  {/* Pin toggle */}
                  <button
                    title={m.pinned_at ? 'Unpin' : 'Pin to top'}
                    disabled={busyId === m.id}
                    onClick={() => { void togglePin(m) }}
                    aria-label={m.pinned_at ? 'Unpin meeting' : 'Pin meeting to top'}
                    className={[
                      'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all duration-300 cursor-pointer border-0',
                      m.pinned_at
                        ? 'bg-b-primary/20 text-b-fg'
                        : 'bg-transparent text-b-fg/20 hover:text-b-fg/50 hover:bg-b-clay',
                    ].join(' ')}
                  >
                    📌
                  </button>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    {editingId === m.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-b-clay border border-b-primary text-b-fg text-sm font-semibold outline-none"
                          value={editTitle}
                          maxLength={200}
                          autoFocus
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') void saveRename(m.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <button
                          disabled={busyId === m.id}
                          onClick={() => { void saveRename(m.id) }}
                          className="px-3 py-1.5 rounded-full bg-b-fg text-white text-xs font-semibold uppercase tracking-widest cursor-pointer border-0 hover:opacity-80 transition-opacity flex-shrink-0"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 rounded-full border border-b-border text-b-fg/60 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay transition-colors flex-shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <Link href={`/meetings/${m.id}`} className="block group">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-sans font-semibold text-sm text-b-fg truncate group-hover:text-b-terra transition-colors duration-300">
                            {m.title}
                          </span>
                          <StatusBadge status={m.status} />
                        </div>
                        <div className="text-xs text-b-fg/40 font-sans">
                          {formatDate(m.created_at)}
                          {m.duration_seconds != null && (
                            <> · {formatDuration(m.duration_seconds)}</>
                          )}
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Actions */}
                  {editingId !== m.id && (
                    <div className="flex-shrink-0 flex items-center gap-1.5">
                      <button
                        disabled={busyId === m.id}
                        onClick={() => startRename(m)}
                        className="px-3 py-1.5 rounded-full border border-b-border text-b-fg/60 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay hover:text-b-fg transition-all duration-300"
                      >
                        Rename
                      </button>
                      <button
                        disabled={busyId === m.id}
                        onClick={() => setConfirmDeleteId(m.id)}
                        className="px-3 py-1.5 rounded-full border border-red-100 text-red-400 text-xs font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-red-50 hover:text-red-600 transition-all duration-300"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Delete confirmation dialog */}
      {confirmTarget && (
        <div
          className="fixed inset-0 bg-b-fg/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-white rounded-3xl border border-b-border shadow-b-xl p-8 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-serif text-xl font-bold text-b-fg mb-3">
              Delete this meeting?
            </h3>
            <p className="text-sm text-b-fg/60 font-sans leading-relaxed mb-6">
              <strong className="text-b-fg">&ldquo;{confirmTarget.title}&rdquo;</strong>
              <br />
              This permanently deletes the meeting, transcript, todos, and recording. This can&apos;t be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-5 py-2 rounded-full border border-b-border text-b-fg/60 text-sm font-semibold uppercase tracking-widest cursor-pointer bg-transparent hover:bg-b-clay transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={busyId === confirmTarget.id}
                onClick={() => { void deleteMeeting(confirmTarget.id) }}
                className="px-5 py-2 rounded-full bg-red-600 text-white text-sm font-semibold uppercase tracking-widest cursor-pointer border-0 hover:bg-red-700 transition-colors"
                style={{ opacity: busyId === confirmTarget.id ? 0.65 : 1 }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
