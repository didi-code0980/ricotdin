'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, getCurrentRole } from '@/lib/supabase/auth'
import { formatBytes } from '@/lib/admin/usage'

// ── Types ─────────────────────────────────────────────────────────────────────

type MeetingStats = {
  total: number
  byStatus: Record<string, number>
  failureRate: number
  last7Days: number
  last30Days: number
}

type StorageStats = {
  totalBytes: number
  fileCount: number
}

type Orphan = string

// ── Page ──────────────────────────────────────────────────────────────────────

export default function UsagePage() {
  const router = useRouter()

  const [loading, setLoading]         = useState(true)
  const [forbidden, setForbidden]     = useState(false)
  const [meetings, setMeetings]       = useState<MeetingStats | null>(null)
  const [storage, setStorage]         = useState<StorageStats | null>(null)
  const [orphans, setOrphans]         = useState<Orphan[] | null>(null)
  const [orphansLoading, setOL]       = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      const role = await getCurrentRole()
      if (role !== 'admin') { setForbidden(true); setLoading(false); return }

      const token = await getAccessToken()
      if (!token) { router.replace('/login'); return }

      const res = await fetch('/api/admin/usage', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403) { setForbidden(true); setLoading(false); return }
      const data = (await res.json()) as { meetings?: MeetingStats; storage?: StorageStats; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to load usage.'); setLoading(false); return }
      setMeetings(data.meetings ?? null)
      setStorage(data.storage ?? null)
      setLoading(false)
    }
    void init()
  }, [router])

  async function loadOrphans() {
    setOL(true); setError(null)
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch('/api/admin/storage/orphans', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as { orphans?: string[]; error?: string }
    if (!res.ok) { setError(data.error ?? 'Failed to load orphans.'); setOL(false); return }
    setOrphans(data.orphans ?? [])
    setOL(false)
  }

  async function runCleanup() {
    if (!orphans || orphans.length === 0) return
    setCleanupBusy(true); setError(null); setSuccess(null)
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch('/api/admin/storage/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ paths: orphans }),
    })
    const data = (await res.json()) as { deleted?: number; errors?: string[]; error?: string }
    if (!res.ok) { setError(data.error ?? 'Cleanup failed.'); setCleanupBusy(false); return }
    setSuccess(`Deleted ${data.deleted ?? 0} orphan file(s).`)
    setOrphans([])
    setCleanupBusy(false)
  }

  if (loading) return <div style={S.page}><p style={S.muted}>Loading…</p></div>
  if (forbidden) return (
    <div style={S.page}>
      <div style={S.errBanner}>403 — You do not have permission to view this page.</div>
    </div>
  )

  return (
    <div style={S.page}>
      <div style={S.pageHeader}>
        <h1 style={S.h1}>Usage & Storage</h1>
        <span style={S.badge}>Admin only</span>
      </div>

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

      {/* Meeting stats */}
      {meetings && (
        <section style={S.section}>
          <h2 style={S.h2}>Meetings</h2>
          <div style={S.tileRow}>
            <Tile label="Total" value={String(meetings.total)} />
            <Tile label="Last 7 days" value={String(meetings.last7Days)} />
            <Tile label="Last 30 days" value={String(meetings.last30Days)} />
            <Tile label="Failure rate" value={`${(meetings.failureRate * 100).toFixed(1)}%`} accent={meetings.failureRate > 0.1} />
          </div>
          <h3 style={S.h3}>By status</h3>
          <div style={S.tileRow}>
            {Object.entries(meetings.byStatus).map(([status, count]) => (
              <Tile key={status} label={status} value={String(count)} />
            ))}
          </div>
        </section>
      )}

      {/* Storage stats */}
      {storage && (
        <section style={S.section}>
          <h2 style={S.h2}>Storage</h2>
          <div style={S.tileRow}>
            <Tile label="Files" value={String(storage.fileCount)} />
            <Tile label="Total size" value={formatBytes(storage.totalBytes)} />
          </div>
        </section>
      )}

      {/* Orphan management */}
      <section style={S.section}>
        <h2 style={S.h2}>Orphan Files</h2>
        <p style={S.subtitle}>
          Storage files that have no corresponding meeting row can be safely deleted.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button style={S.btn} onClick={() => { void loadOrphans() }} disabled={orphansLoading}>
            {orphansLoading ? 'Scanning…' : 'Scan for orphans'}
          </button>
          {orphans !== null && orphans.length > 0 && (
            <button
              style={{ ...S.btn, background: '#dc2626', color: '#fff', border: 'none' }}
              onClick={() => { void runCleanup() }}
              disabled={cleanupBusy}
            >
              {cleanupBusy ? 'Deleting…' : `Delete ${orphans.length} orphan(s)`}
            </button>
          )}
        </div>
        {orphans !== null && (
          orphans.length === 0 ? (
            <p style={{ ...S.muted, fontSize: 13 }}>No orphan files found.</p>
          ) : (
            <div style={S.orphanList}>
              {orphans.map((path) => (
                <div key={path} style={S.orphanItem}>{path}</div>
              ))}
            </div>
          )
        )}
      </section>
    </div>
  )
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ ...S.tile, ...(accent ? S.tileAccent : {}) }}>
      <div style={S.tileValue}>{value}</div>
      <div style={S.tileLabel}>{label}</div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  page:       { padding: '28px 32px', maxWidth: 900 },
  pageHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  h1:         { margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' },
  h2:         { margin: '0 0 14px', fontSize: 16, fontWeight: 600, color: '#1e293b' },
  h3:         { margin: '16px 0 10px', fontSize: 13, fontWeight: 600, color: '#475569' },
  badge: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 99,
  },
  subtitle:   { margin: '0 0 10px', fontSize: 13, color: '#64748b' },
  muted:      { color: '#888', fontSize: 14 },
  section:    { marginBottom: 32 },
  tileRow:    { display: 'flex', gap: 12, flexWrap: 'wrap' },
  tile: {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
    padding: '16px 20px', minWidth: 120, textAlign: 'center',
  },
  tileAccent: { borderColor: '#f87171', background: '#fff5f5' },
  tileValue:  { fontSize: 22, fontWeight: 700, color: '#0f172a' },
  tileLabel:  { fontSize: 11, color: '#64748b', marginTop: 4, textTransform: 'capitalize' },
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
  dismissBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'inherit', opacity: 0.6 },
  btn: {
    fontSize: 13, padding: '7px 14px', border: '1px solid #d0d0d0',
    borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#333', fontWeight: 500,
  },
  orphanList: {
    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
    maxHeight: 240, overflowY: 'auto', padding: '8px 12px',
  },
  orphanItem: { fontFamily: 'monospace', fontSize: 12, color: '#334155', padding: '3px 0' },
}
