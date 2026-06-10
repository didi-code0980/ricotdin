'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, getCurrentRole } from '@/lib/supabase/auth'

type UserRow = {
  id: string
  email: string | null
  username: string | null
  role: 'user' | 'admin'
  created_at: string
  banned: boolean
}

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // id of user being mutated

  useEffect(() => {
    async function init() {
      // Client-side role check (fast feedback). Server route enforces it independently.
      const role = await getCurrentRole()
      if (role !== 'admin') {
        setForbidden(true)
        setLoading(false)
        return
      }
      await fetchUsers()
      setLoading(false)
    }
    void init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchUsers() {
    const token = await getAccessToken()
    if (!token) { router.replace('/login'); return }

    const res = await fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 403) { setForbidden(true); return }

    const data = (await res.json()) as { users?: UserRow[]; error?: string }
    if (!res.ok) { setError(data.error ?? 'Failed to load users.'); return }
    setUsers(data.users ?? [])
  }

  async function changeRole(userId: string, newRole: 'user' | 'admin') {
    const token = await getAccessToken()
    if (!token) return
    setBusy(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to change role.'); return }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u))
    } finally {
      setBusy(null)
    }
  }

  async function toggleBan(userId: string, currentlyBanned: boolean) {
    const token = await getAccessToken()
    if (!token) return
    setBusy(userId)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ banned: !currentlyBanned }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to update ban.'); return }
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, banned: !currentlyBanned } : u))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <main style={S.main}><p style={S.muted}>Loading…</p></main>

  if (forbidden) {
    return (
      <main style={S.main}>
        <div style={S.err}>403 — You do not have permission to view this page.</div>
        <Link href="/meetings" style={{ color: '#0066cc', fontSize: 14 }}>← Back to meetings</Link>
      </main>
    )
  }

  return (
    <main style={S.main}>
      <div style={S.header}>
        <div>
          <Link href="/meetings" style={S.back}>← Meetings</Link>
          <h1 style={S.h1}>Admin — Users</h1>
        </div>
        <span style={S.badge}>Admin only</span>
      </div>

      {error && <div style={S.err}>{error}</div>}

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Email', 'Username', 'Role', 'Joined', 'Status', 'Actions'].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={u.banned ? S.bannedRow : undefined}>
                <td style={S.td}>{u.email ?? '—'}</td>
                <td style={S.td}>{u.username ?? '—'}</td>
                <td style={S.td}>
                  <span style={u.role === 'admin' ? S.adminBadge : S.userBadge}>
                    {u.role}
                  </span>
                </td>
                <td style={S.td}>{formatDate(u.created_at)}</td>
                <td style={S.td}>
                  {u.banned
                    ? <span style={S.bannedBadge}>Banned</span>
                    : <span style={S.activeBadge}>Active</span>}
                </td>
                <td style={S.td}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {u.role === 'user' ? (
                      <button
                        style={S.actionBtn}
                        disabled={busy === u.id}
                        onClick={() => { void changeRole(u.id, 'admin') }}
                      >
                        Make admin
                      </button>
                    ) : (
                      <button
                        style={S.actionBtn}
                        disabled={busy === u.id}
                        onClick={() => { void changeRole(u.id, 'user') }}
                      >
                        Make user
                      </button>
                    )}
                    <button
                      style={{ ...S.actionBtn, color: u.banned ? '#166534' : '#991b1b' }}
                      disabled={busy === u.id}
                      onClick={() => { void toggleBan(u.id, u.banned) }}
                    >
                      {u.banned ? 'Unban' : 'Ban'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p style={S.muted}>No users found.</p>}
      </div>
    </main>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

const S: Record<string, CSSProperties> = {
  main: { fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: '2rem 1rem' },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' },
  back: { display: 'block', color: '#0066cc', textDecoration: 'none', fontSize: 13, marginBottom: 6 },
  h1: { margin: 0, fontSize: 20, fontWeight: 700 },
  badge: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
    background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 99, marginTop: 4,
  },
  muted: { color: '#888', fontSize: 14 },
  err: {
    background: '#fff0f0', border: '1px solid #f55', borderRadius: 6,
    padding: '10px 14px', color: '#b00020', fontSize: 14, marginBottom: 16,
  },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left', padding: '8px 12px', fontWeight: 600,
    background: '#f8f8f8', borderBottom: '2px solid #eee', color: '#333',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'middle' },
  bannedRow: { opacity: 0.6 },
  adminBadge: {
    fontSize: 11, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8',
    padding: '2px 7px', borderRadius: 99,
  },
  userBadge: {
    fontSize: 11, fontWeight: 600, background: '#f0f0f0', color: '#555',
    padding: '2px 7px', borderRadius: 99,
  },
  activeBadge: { fontSize: 12, color: '#166534' },
  bannedBadge: { fontSize: 12, color: '#991b1b' },
  actionBtn: {
    fontSize: 12, padding: '4px 10px', border: '1px solid #d0d0d0',
    borderRadius: 5, background: '#fff', cursor: 'pointer', color: '#333',
  },
}
