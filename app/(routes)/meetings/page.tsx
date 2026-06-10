'use client'

import type { CSSProperties, KeyboardEvent } from 'react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { browserClient } from '@/lib/supabase/browser'
import { getAccessToken } from '@/lib/supabase/auth'
import type { Meeting, MeetingStatus } from '@/types/database'

type LoadState = 'loading' | 'ready' | 'error'

const POLL_INTERVAL_MS = 3_000
const IN_FLIGHT: MeetingStatus[] = ['pending', 'processing']

// Sort: pinned first (most-recently-pinned on top), then unpinned newest-first.
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

export default function MeetingsPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionWarning, setActionWarning] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Rename state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  // Delete confirmation state
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

        const hasInFlight = rows.some((m) => IN_FLIGHT.includes(m.status))
        if (hasInFlight) {
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

    // Optimistic update
    const newPinnedAt = m.pinned_at ? null : new Date().toISOString()
    setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: newPinnedAt } : x)))

    try {
      const res = await fetch(`/api/meetings/${m.id}/pin`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { pinned_at?: string | null; error?: string }
      if (!res.ok) {
        // Revert
        setMeetings((prev) => sortMeetings(prev.map((x) => x.id === m.id ? { ...x, pinned_at: m.pinned_at } : x)))
        setActionError(data.error ?? 'Failed to update pin.')
      } else {
        // Sync server's timestamp (it may differ slightly from our optimistic value)
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
    // Optimistic update
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
    <main style={S.main}>
      <div style={S.header}>
        <h1 style={{ margin: 0 }}>Meetings</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link href="/chat" style={S.btnSecondary}>Chat</Link>
          <Link href="/record" style={S.btnNew}>+ New recording</Link>
        </div>
      </div>

      {actionError && (
        <div style={S.errBanner}>
          ✗ {actionError}
          <button style={S.dismissBtn} onClick={() => setActionError(null)}>✕</button>
        </div>
      )}
      {actionWarning && (
        <div style={S.warnBanner}>
          ⚠ {actionWarning}
          <button style={S.dismissBtn} onClick={() => setActionWarning(null)}>✕</button>
        </div>
      )}

      {loadState === 'loading' && <p style={S.muted}>Loading…</p>}
      {loadState === 'error' && <div style={S.errBanner}>✗ {loadError}</div>}

      {loadState === 'ready' && meetings.length === 0 && (
        <div style={S.empty}>
          <p>No meetings yet.</p>
          <Link href="/record" style={S.btnNew}>Record your first meeting →</Link>
        </div>
      )}

      {loadState === 'ready' && meetings.length > 0 && (
        <ul style={S.list}>
          {meetings.map((m) => (
            <li key={m.id} style={{ ...S.item, ...(m.pinned_at ? S.pinnedItem : {}) }}>
              <div style={S.itemRow}>
                {/* Pin toggle */}
                <button
                  style={{ ...S.pinBtn, ...(m.pinned_at ? S.pinBtnActive : {}) }}
                  title={m.pinned_at ? 'Unpin' : 'Pin to top'}
                  disabled={busyId === m.id}
                  onClick={() => { void togglePin(m) }}
                  aria-label={m.pinned_at ? 'Unpin meeting' : 'Pin meeting to top'}
                >
                  📌
                </button>

                {/* Main content — link or inline rename */}
                <div style={S.itemContent}>
                  {editingId === m.id ? (
                    <div style={S.renameRow}>
                      <input
                        style={S.renameInput}
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
                        style={S.saveBtn}
                        disabled={busyId === m.id}
                        onClick={() => { void saveRename(m.id) }}
                      >
                        Save
                      </button>
                      <button style={S.cancelBtn} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
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
                  )}
                </div>

                {/* Actions (hidden while rename input is open) */}
                {editingId !== m.id && (
                  <div style={S.actions}>
                    <button
                      style={S.actionBtn}
                      disabled={busyId === m.id}
                      onClick={() => startRename(m)}
                    >
                      Rename
                    </button>
                    <button
                      style={{ ...S.actionBtn, color: '#991b1b' }}
                      disabled={busyId === m.id}
                      onClick={() => setConfirmDeleteId(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Delete confirmation dialog */}
      {confirmTarget && (
        <div style={S.overlay} onClick={() => setConfirmDeleteId(null)}>
          <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={S.dialogTitle}>Delete meeting?</h3>
            <p style={S.dialogBody}>
              <strong>&ldquo;{confirmTarget.title}&rdquo;</strong>
              <br />
              This permanently deletes the meeting, its transcript, todos, and
              recording. This can&apos;t be undone.
            </p>
            <div style={S.dialogActions}>
              <button style={S.cancelBtn} onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                style={S.deleteBtn}
                disabled={busyId === confirmTarget.id}
                onClick={() => { void deleteMeeting(confirmTarget.id) }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
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
        flexShrink: 0,
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
  btnSecondary: {
    padding: '8px 18px',
    background: '#fff',
    color: '#0066cc',
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
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
  errBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#fff0f0',
    border: '1px solid #f55',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#b00020',
    fontSize: 14,
    marginBottom: 12,
  },
  warnBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#fffbeb',
    border: '1px solid #f59e0b',
    borderRadius: 6,
    padding: '10px 14px',
    color: '#92400e',
    fontSize: 14,
    marginBottom: 12,
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    color: 'inherit',
    opacity: 0.6,
    padding: '0 2px',
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
    background: '#fff',
  },
  pinnedItem: {
    borderLeftColor: '#1a7f37',
    borderLeftWidth: 3,
    background: '#f9fdf9',
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '10px 12px',
  },
  pinBtn: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '4px 6px',
    borderRadius: 6,
    opacity: 0.25,
    transition: 'opacity 0.15s',
    lineHeight: 1,
  },
  pinBtnActive: {
    opacity: 1,
  },
  itemContent: {
    flex: 1,
    minWidth: 0,
  },
  itemLink: {
    display: 'block',
    textDecoration: 'none',
    color: 'inherit',
  },
  itemTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 3,
  },
  title: {
    fontWeight: 600,
    fontSize: 15,
    color: '#111',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 13,
    color: '#666',
  },
  actions: {
    flexShrink: 0,
    display: 'flex',
    gap: 4,
    marginLeft: 8,
  },
  actionBtn: {
    fontSize: 12,
    padding: '4px 10px',
    border: '1px solid #d0d0d0',
    borderRadius: 5,
    background: '#fff',
    cursor: 'pointer',
    color: '#333',
  },
  renameRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  renameInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    padding: '4px 8px',
    border: '1.5px solid #1a7f37',
    borderRadius: 5,
    outline: 'none',
    minWidth: 0,
  },
  saveBtn: {
    fontSize: 12,
    padding: '4px 12px',
    background: '#1a7f37',
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    cursor: 'pointer',
    fontWeight: 600,
    flexShrink: 0,
  },
  cancelBtn: {
    fontSize: 12,
    padding: '4px 10px',
    background: '#fff',
    color: '#555',
    border: '1px solid #d0d0d0',
    borderRadius: 5,
    cursor: 'pointer',
    flexShrink: 0,
  },
  // Delete confirmation modal
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  dialog: {
    background: '#fff',
    borderRadius: 10,
    padding: '24px 28px',
    maxWidth: 420,
    width: '90%',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  },
  dialogTitle: {
    margin: '0 0 12px',
    fontSize: 17,
    fontWeight: 700,
    color: '#111',
  },
  dialogBody: {
    margin: '0 0 20px',
    fontSize: 14,
    color: '#444',
    lineHeight: 1.6,
  },
  dialogActions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
  },
  deleteBtn: {
    fontSize: 13,
    padding: '7px 16px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
  },
}
