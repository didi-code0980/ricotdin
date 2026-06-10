'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'
import { getAccessToken, getCurrentRole } from '@/lib/supabase/auth'

// ── Types ─────────────────────────────────────────────────────────────────────

type AdminUser = {
  id: string
  email: string | null
  username: string | null
  role: 'user' | 'admin'
  disabled: boolean
  meeting_count: number
  created_at: string
  last_sign_in_at: string | null
}

type Confirm =
  | { type: 'delete'; user: AdminUser }
  | { type: 'reset-password'; user: AdminUser }

// ── Page ──────────────────────────────────────────────────────────────────────

const PER_PAGE = 20

export default function AdminPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const [confirm, setConfirm] = useState<Confirm | null>(null)

  async function fetchUsers() {
    const token = await getAccessToken()
    if (!token) { router.replace('/login'); return }

    const res = await fetch('/api/admin/users?perPage=1000', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 403) { setForbidden(true); return }

    const data = (await res.json()) as { users?: AdminUser[]; error?: string }
    if (!res.ok) { setError(data.error ?? 'Failed to load users.'); return }
    setUsers(data.users ?? [])
  }

  useEffect(() => {
    async function init() {
      const role = await getCurrentRole()
      if (role !== 'admin') {
        setForbidden(true)
        setLoading(false)
        return
      }
      // Get current user ID to highlight own row
      const { data: { session } } = await browserClient.auth.getSession()
      setCurrentUserId(session?.user.id ?? null)

      await fetchUsers()
      setLoading(false)
    }
    void init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side search + pagination
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return users
    return users.filter(
      (u) => u.email?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q),
    )
  }, [users, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  function handleSearch(value: string) {
    setSearch(value)
    setPage(1) // reset to first page on new search
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async function changeRole(user: AdminUser, newRole: 'user' | 'admin') {
    const token = await getAccessToken()
    if (!token) return
    setError(null); setSuccess(null); setBusyId(user.id)

    const prevRole = user.role
    // Optimistic update
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: newRole } : u))

    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: prevRole } : u))
        setError(data.error ?? 'Failed to change role.')
      } else {
        setSuccess(`${user.email ?? user.username} is now ${newRole === 'admin' ? 'an admin' : 'a regular user'}.`)
      }
    } catch {
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, role: prevRole } : u))
      setError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleStatus(user: AdminUser) {
    const token = await getAccessToken()
    if (!token) return
    setError(null); setSuccess(null); setBusyId(user.id)

    const prevDisabled = user.disabled
    const newDisabled = !user.disabled
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, disabled: newDisabled } : u))

    try {
      const res = await fetch(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ disabled: newDisabled }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, disabled: prevDisabled } : u))
        setError(data.error ?? 'Failed to update account status.')
      } else {
        setSuccess(
          `${user.email ?? user.username} has been ${newDisabled ? 'disabled' : 're-enabled'}.`,
        )
      }
    } catch {
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, disabled: prevDisabled } : u))
      setError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function sendPasswordReset(user: AdminUser) {
    const token = await getAccessToken()
    if (!token) return
    setConfirm(null)
    setError(null); setSuccess(null); setBusyId(user.id)

    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to send password reset.')
      } else {
        setSuccess(`Password reset email sent to ${user.email}.`)
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteUser(user: AdminUser) {
    const token = await getAccessToken()
    if (!token) return
    setConfirm(null)
    setError(null); setSuccess(null); setBusyId(user.id)

    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as { error?: string; storageWarnings?: string[] }
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete user.')
      } else {
        setUsers((prev) => prev.filter((u) => u.id !== user.id))
        const warn = data.storageWarnings?.join(' ')
        setSuccess(
          `${user.email ?? user.username} has been deleted.${warn ? ` Warning: ${warn}` : ''}`,
        )
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <main style={S.main}><p style={S.muted}>Loading…</p></main>

  if (forbidden) {
    return (
      <main style={S.main}>
        <div style={S.errBanner}>403 — You do not have permission to view this page.</div>
        <Link href="/meetings" style={{ color: '#0066cc', fontSize: 14 }}>← Back to meetings</Link>
      </main>
    )
  }

  return (
    <main style={S.main}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <Link href="/meetings" style={S.back}>← Meetings</Link>
          <h1 style={S.h1}>Admin — User Management</h1>
        </div>
        <span style={S.adminBadge}>Admin only</span>
      </div>

      {/* Banners */}
      {error && (
        <div style={S.errBanner}>
          ✗ {error}
          <button style={S.dismissBtn} onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {success && (
        <div style={S.successBanner}>
          ✓ {success}
          <button style={S.dismissBtn} onClick={() => setSuccess(null)}>✕</button>
        </div>
      )}

      {/* Search + count */}
      <div style={S.toolbar}>
        <input
          style={S.searchInput}
          type="search"
          placeholder="Search by email or username…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <span style={S.countLabel}>
          {filtered.length} {filtered.length === 1 ? 'user' : 'users'}
          {search ? ` matching "${search}"` : ' total'}
        </span>
      </div>

      {/* Table */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Email / Username', 'Role', 'Status', 'Meetings', 'Last sign-in', 'Joined', 'Actions'].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((u) => {
              const isMe = u.id === currentUserId
              return (
                <tr key={u.id} style={u.disabled ? S.disabledRow : undefined}>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {u.email ?? '—'}
                          {isMe && <span style={S.youBadge}>You</span>}
                        </div>
                        {u.username && (
                          <div style={{ fontSize: 12, color: '#888' }}>@{u.username}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={S.td}>
                    <span style={u.role === 'admin' ? S.roleAdmin : S.roleUser}>{u.role}</span>
                  </td>
                  <td style={S.td}>
                    {u.disabled
                      ? <span style={S.statusDisabled}>Disabled</span>
                      : <span style={S.statusActive}>Active</span>}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', paddingRight: 20 }}>
                    {u.meeting_count}
                  </td>
                  <td style={S.td}>{u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '—'}</td>
                  <td style={S.td}>{formatDate(u.created_at)}</td>
                  <td style={S.td}>
                    <div style={S.actionsCell}>
                      {/* Role toggle */}
                      {u.role === 'user' ? (
                        <button
                          style={S.btn}
                          disabled={busyId === u.id}
                          onClick={() => { void changeRole(u, 'admin') }}
                          title="Promote to admin"
                        >
                          Make admin
                        </button>
                      ) : (
                        <button
                          style={S.btn}
                          disabled={busyId === u.id || isMe}
                          title={isMe ? 'Cannot demote yourself' : 'Demote to user'}
                          onClick={() => { void changeRole(u, 'user') }}
                        >
                          Make user
                        </button>
                      )}

                      {/* Enable / Disable */}
                      <button
                        style={{ ...S.btn, color: u.disabled ? '#166534' : '#92400e' }}
                        disabled={busyId === u.id || isMe}
                        title={isMe ? 'Cannot disable yourself' : u.disabled ? 'Re-enable account' : 'Disable account'}
                        onClick={() => { void toggleStatus(u) }}
                      >
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>

                      {/* Password reset */}
                      <button
                        style={S.btn}
                        disabled={busyId === u.id || !u.email}
                        title={!u.email ? 'No email address' : 'Send password reset email'}
                        onClick={() => setConfirm({ type: 'reset-password', user: u })}
                      >
                        Reset pwd
                      </button>

                      {/* Delete */}
                      <button
                        style={{ ...S.btn, color: '#991b1b' }}
                        disabled={busyId === u.id || isMe}
                        title={isMe ? 'Cannot delete yourself' : 'Delete user permanently'}
                        onClick={() => setConfirm({ type: 'delete', user: u })}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {paginated.length === 0 && (
          <p style={{ ...S.muted, padding: '16px 12px' }}>
            {search ? 'No users match your search.' : 'No users found.'}
          </p>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={S.pagination}>
          <button
            style={S.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Prev
          </button>
          <span style={S.pageLabel}>Page {page} of {totalPages}</span>
          <button
            style={S.pageBtn}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {/* Confirmation dialogs */}
      {confirm && (
        <div style={S.overlay} onClick={() => setConfirm(null)}>
          <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
            {confirm.type === 'delete' ? (
              <>
                <h3 style={S.dialogTitle}>Delete user?</h3>
                <p style={S.dialogBody}>
                  <strong>{confirm.user.email ?? confirm.user.username}</strong>
                  <br />
                  This permanently deletes the account and all their meetings, transcripts,
                  todos, and recordings. This can&apos;t be undone.
                </p>
                <div style={S.dialogActions}>
                  <button style={S.btn} onClick={() => setConfirm(null)}>Cancel</button>
                  <button
                    style={S.deleteBtn}
                    disabled={busyId === confirm.user.id}
                    onClick={() => { void deleteUser(confirm.user) }}
                  >
                    Delete permanently
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={S.dialogTitle}>Send password reset?</h3>
                <p style={S.dialogBody}>
                  A password-recovery email will be sent to{' '}
                  <strong>{confirm.user.email}</strong>.
                  The user will choose a new password via the link in that email.
                </p>
                <div style={S.dialogActions}>
                  <button style={S.btn} onClick={() => setConfirm(null)}>Cancel</button>
                  <button
                    style={S.primaryBtn}
                    disabled={busyId === confirm.user.id}
                    onClick={() => { void sendPasswordReset(confirm.user) }}
                  >
                    Send reset email
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  main: { fontFamily: 'system-ui, sans-serif', maxWidth: 1100, margin: '0 auto', padding: '2rem 1rem' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' },
  back: { display: 'block', color: '#0066cc', textDecoration: 'none', fontSize: 13, marginBottom: 6 },
  h1: { margin: 0, fontSize: 20, fontWeight: 700 },
  adminBadge: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
    background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 99, marginTop: 4,
  },
  muted: { color: '#888', fontSize: 14 },
  errBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#fff0f0', border: '1px solid #f55', borderRadius: 6,
    padding: '10px 14px', color: '#b00020', fontSize: 14, marginBottom: 12,
  },
  successBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#f0fff4', border: '1px solid #1a7f37', borderRadius: 6,
    padding: '10px 14px', color: '#166534', fontSize: 14, marginBottom: 12,
  },
  dismissBtn: {
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
    color: 'inherit', opacity: 0.6, padding: '0 2px',
  },
  toolbar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 },
  searchInput: {
    flex: 1, maxWidth: 320, fontSize: 13, padding: '6px 10px',
    border: '1px solid #d0d0d0', borderRadius: 6, outline: 'none',
  },
  countLabel: { fontSize: 13, color: '#888' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap',
    background: '#f8f8f8', borderBottom: '2px solid #eee', color: '#333',
  },
  td: { padding: '9px 10px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' },
  disabledRow: { opacity: 0.55 },
  youBadge: {
    display: 'inline-block', marginLeft: 6, fontSize: 10, fontWeight: 700,
    background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: 99,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  roleAdmin: {
    display: 'inline-block', fontSize: 11, fontWeight: 700,
    background: '#dbeafe', color: '#1d4ed8', padding: '2px 7px', borderRadius: 99,
  },
  roleUser: {
    display: 'inline-block', fontSize: 11, fontWeight: 600,
    background: '#f0f0f0', color: '#555', padding: '2px 7px', borderRadius: 99,
  },
  statusActive: { fontSize: 12, color: '#166534' },
  statusDisabled: { fontSize: 12, color: '#991b1b' },
  actionsCell: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  btn: {
    fontSize: 11, padding: '3px 8px', border: '1px solid #d0d0d0',
    borderRadius: 5, background: '#fff', cursor: 'pointer', color: '#333',
    whiteSpace: 'nowrap',
  },
  pagination: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, justifyContent: 'center' },
  pageBtn: {
    fontSize: 13, padding: '5px 14px', border: '1px solid #d0d0d0',
    borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#333',
  },
  pageLabel: { fontSize: 13, color: '#555' },
  // Dialog
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  dialog: {
    background: '#fff', borderRadius: 10, padding: '24px 28px',
    maxWidth: 430, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  },
  dialogTitle: { margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: '#111' },
  dialogBody: { margin: '0 0 20px', fontSize: 14, color: '#444', lineHeight: 1.6 },
  dialogActions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  deleteBtn: {
    fontSize: 13, padding: '7px 16px', background: '#dc2626', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
  },
  primaryBtn: {
    fontSize: 13, padding: '7px 16px', background: '#1a7f37', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
  },
}
