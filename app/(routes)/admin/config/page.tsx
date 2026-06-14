'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, getCurrentRole } from '@/lib/supabase/auth'
import { configValueType, parseConfigInput } from '@/lib/admin/config'
import type { ConfigValue } from '@/lib/admin/config'

// ── Types ─────────────────────────────────────────────────────────────────────

type ConfigRow = {
  key: string
  value: ConfigValue
  description: string
  updated_at: string
  updated_by: string | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const router = useRouter()

  const [loading, setLoading]     = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [config, setConfig]       = useState<ConfigRow[]>([])
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState<string | null>(null)
  const [busyKey, setBusyKey]     = useState<string | null>(null)
  const [editing, setEditing]     = useState<Record<string, string>>({})

  useEffect(() => {
    async function init() {
      const role = await getCurrentRole()
      if (role !== 'admin') { setForbidden(true); setLoading(false); return }

      const token = await getAccessToken()
      if (!token) { router.replace('/login'); return }

      const res = await fetch('/api/admin/config', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 403) { setForbidden(true); setLoading(false); return }
      const data = (await res.json()) as { config?: ConfigRow[]; error?: string }
      if (!res.ok) { setError(data.error ?? 'Failed to load config.'); setLoading(false); return }
      setConfig(data.config ?? [])
      setLoading(false)
    }
    void init()
  }, [router])

  function startEdit(row: ConfigRow) {
    const displayVal = row.value === null ? 'null' : String(row.value)
    setEditing((prev) => ({ ...prev, [row.key]: displayVal }))
  }

  function cancelEdit(key: string) {
    setEditing((prev) => { const n = { ...prev }; delete n[key]; return n })
  }

  async function saveEdit(row: ConfigRow) {
    const raw = editing[row.key]
    if (raw === undefined) return

    const type = configValueType(row.value)
    const newValue = parseConfigInput(raw, type)

    setBusyKey(row.key); setError(null); setSuccess(null)
    const token = await getAccessToken()
    if (!token) return

    const res = await fetch(`/api/admin/config/${encodeURIComponent(row.key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ value: newValue }),
    })
    const data = (await res.json()) as { config?: ConfigRow; error?: string }
    if (!res.ok) {
      setError(data.error ?? 'Failed to update config.')
    } else {
      const updated = data.config!
      setConfig((prev) => prev.map((c) => c.key === row.key ? { ...c, value: updated.value, updated_at: updated.updated_at } : c))
      cancelEdit(row.key)
      setSuccess(`"${row.key}" updated.`)
    }
    setBusyKey(null)
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
        <h1 style={S.h1}>Config & Feature Flags</h1>
        <span style={S.badge}>Admin only</span>
      </div>
      <p style={S.subtitle}>
        These values control runtime behaviour. Changes take effect immediately on the
        next relevant operation — no restart needed.
      </p>

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

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {['Key', 'Type', 'Value', 'Description', 'Last updated', ''].map((h) => (
                <th key={h} style={S.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {config.map((row) => {
              const isEditing = row.key in editing
              const type = configValueType(row.value)
              return (
                <tr key={row.key}>
                  <td style={S.td}><code style={S.mono}>{row.key}</code></td>
                  <td style={S.td}><span style={S.typeBadge}>{type}</span></td>
                  <td style={S.td}>
                    {isEditing ? (
                      <input
                        style={S.editInput}
                        value={editing[row.key]}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [row.key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(row)
                          if (e.key === 'Escape') cancelEdit(row.key)
                        }}
                        autoFocus
                      />
                    ) : (
                      <span style={S.valueDisplay}>
                        {row.value === null ? <em style={S.nullVal}>null</em> : String(row.value)}
                      </span>
                    )}
                  </td>
                  <td style={S.td}><span style={S.desc}>{row.description}</span></td>
                  <td style={S.td}><span style={S.time}>{formatDate(row.updated_at)}</span></td>
                  <td style={S.td}>
                    <div style={S.actions}>
                      {isEditing ? (
                        <>
                          <button
                            style={S.saveBtn}
                            disabled={busyKey === row.key}
                            onClick={() => { void saveEdit(row) }}
                          >
                            {busyKey === row.key ? '…' : 'Save'}
                          </button>
                          <button style={S.cancelBtn} onClick={() => cancelEdit(row.key)}>Cancel</button>
                        </>
                      ) : (
                        <button style={S.editBtn} onClick={() => startEdit(row)}>Edit</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {config.length === 0 && (
          <p style={{ ...S.muted, padding: '16px 12px' }}>
            No config entries found. Apply migration 006 in the Supabase dashboard.
          </p>
        )}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const S: Record<string, CSSProperties> = {
  page:       { padding: '28px 32px', maxWidth: 1050 },
  pageHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  h1:         { margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' },
  badge: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 99,
  },
  subtitle:   { margin: '0 0 18px', fontSize: 13, color: '#64748b' },
  muted:      { color: '#888', fontSize: 14 },
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
  tableWrap:  { overflowX: 'auto', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0' },
  table:      { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '9px 14px', fontWeight: 600, whiteSpace: 'nowrap',
    background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 11,
  },
  td:         { padding: '10px 14px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  mono:       { fontFamily: 'monospace', fontSize: 12, color: '#1e293b' },
  typeBadge: {
    fontSize: 11, fontWeight: 600, background: '#f1f5f9', color: '#475569',
    padding: '1px 7px', borderRadius: 99, border: '1px solid #e2e8f0',
  },
  valueDisplay: { fontFamily: 'monospace', fontSize: 13, color: '#0f172a' },
  nullVal:    { color: '#94a3b8', fontStyle: 'normal' },
  desc:       { fontSize: 12, color: '#64748b' },
  time:       { fontSize: 11, color: '#94a3b8' },
  actions:    { display: 'flex', gap: 6 },
  editBtn: {
    fontSize: 11, padding: '3px 10px', border: '1px solid #d0d0d0',
    borderRadius: 5, background: '#fff', cursor: 'pointer', color: '#334155',
  },
  saveBtn: {
    fontSize: 11, padding: '3px 10px', border: 'none',
    borderRadius: 5, background: '#3b82f6', cursor: 'pointer', color: '#fff', fontWeight: 600,
  },
  cancelBtn: {
    fontSize: 11, padding: '3px 10px', border: '1px solid #d0d0d0',
    borderRadius: 5, background: '#fff', cursor: 'pointer', color: '#666',
  },
  editInput: {
    fontFamily: 'monospace', fontSize: 13, padding: '3px 8px',
    border: '1px solid #3b82f6', borderRadius: 5, outline: 'none', width: 160,
  },
}
