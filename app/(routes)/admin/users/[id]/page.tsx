'use client'

import type { CSSProperties } from 'react'
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, User, Calendar, Clock, Database, Zap, FileText } from 'lucide-react'
import { getAccessToken } from '@/lib/supabase/auth'

// ── Types ──────────────────────────────────────────────────────────────────────

type UserDetail = {
  id: string
  email: string | null
  username: string | null
  role: 'user' | 'admin'
  disabled: boolean
  status: 'unverified' | 'active' | 'disabled'
  meeting_count: number
  created_at: string
  last_sign_in_at: string | null
}

type ActivityRow = {
  id: string
  created_at: string
  user_id: string
  event_type: string
  meeting_id: string | null
  meeting_title: string | null
  target_user_id: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  user_agent: string | null
}

type AiUsageRow = {
  provider: string
  model: string
  operation: string | null
  unit: string
  calls: number
  total_tokens: number | null
  total_input_tokens: number | null
  total_output_tokens: number | null
  total_audio_seconds: number | null
  rate_limited_count: number
  error_count: number
}

type Tab = 'logs' | 'usage'

// ── Page ───────────────────────────────────────────────────────────────────────

const LOG_PER_PAGE = 20

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()

  const [user, setUser]         = useState<UserDetail | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [tab, setTab]           = useState<Tab>('logs')

  // Activity log state
  const [logs, setLogs]         = useState<ActivityRow[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(1)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError]     = useState<string | null>(null)

  // AI usage state
  const [usageRows, setUsageRows]   = useState<AiUsageRow[]>([])
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError]     = useState<string | null>(null)

  // ── Fetch user detail ────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/admin/users/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = (await res.json()) as UserDetail & { error?: string }
      if (!res.ok) { setUserError(data.error ?? 'Failed to load user.'); return }
      setUser(data)
    }
    void load()
  }, [id])

  // ── Fetch audit logs ─────────────────────────────────────────────────────────

  const fetchLogs = useCallback(async (page: number) => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const token = await getAccessToken()
      if (!token) { setLogsLoading(false); return }
      const res = await fetch(
        `/api/admin/activity?userId=${id}&page=${page}&perPage=${LOG_PER_PAGE}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json()) as { rows?: ActivityRow[]; total?: number; error?: string }
      if (!res.ok) { setLogsError(data.error ?? 'Failed to load activity logs.'); return }
      setLogs(data.rows ?? [])
      setLogsTotal(data.total ?? 0)
    } catch {
      setLogsError('Network error — please try again.')
    } finally {
      setLogsLoading(false)
    }
  }, [id])

  // ── Fetch AI usage ───────────────────────────────────────────────────────────

  const fetchUsage = useCallback(async () => {
    setUsageLoading(true)
    setUsageError(null)
    const token = await getAccessToken()
    if (!token) { setUsageLoading(false); return }
    const res = await fetch(
      `/api/admin/ai-usage?userId=${id}&groupBy=operation`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const data = (await res.json()) as { rows?: AiUsageRow[]; error?: string }
    if (!res.ok) { setUsageError(data.error ?? 'Failed to load usage.'); setUsageLoading(false); return }
    setUsageRows(data.rows ?? [])
    setUsageLoading(false)
  }, [id])

  useEffect(() => { void fetchLogs(1) }, [fetchLogs])
  useEffect(() => { void fetchUsage() }, [fetchUsage])

  function handleLogsPage(p: number) {
    setLogsPage(p)
    void fetchLogs(p)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const tokenRows  = usageRows.filter((r) => r.unit === 'tokens')
  const audioRows  = usageRows.filter((r) => r.unit === 'audio_seconds')
  const totalCalls = usageRows.reduce((s, r) => s + r.calls, 0)
  const totalTokens = tokenRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0)
  const totalAudioSecs = audioRows.reduce((s, r) => s + (r.total_audio_seconds ?? 0), 0)
  const totalErrors = usageRows.reduce((s, r) => s + r.error_count + r.rate_limited_count, 0)
  const logsTotalPages = Math.max(1, Math.ceil(logsTotal / LOG_PER_PAGE))

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>
      {/* Back */}
      <Link href="/admin/users" style={S.back}>
        <ArrowLeft size={14} />
        All users
      </Link>

      {/* User card */}
      {userError ? (
        <div style={S.errBanner}>{userError}</div>
      ) : !user ? (
        <div style={S.muted}>Loading…</div>
      ) : (
        <div style={S.card}>
          <div style={S.cardAvatar}>
            <User size={22} color="#3b82f6" />
          </div>
          <div style={S.cardBody}>
            <div style={S.cardName}>
              {user.email ?? '—'}
              {user.username && <span style={S.cardUsername}>@{user.username}</span>}
              <span style={user.role === 'admin' ? S.roleAdmin : S.roleUser}>{user.role}</span>
              {user.status === 'disabled' && <span style={S.disabledBadge}>Disabled</span>}
              {user.status === 'unverified' && <span style={S.unverifiedBadge}>Unverified</span>}
            </div>
            <div style={S.cardMeta}>
              <span style={S.metaItem}><Calendar size={12} /> Joined {fmt(user.created_at)}</span>
              <span style={S.metaItem}><Clock size={12} /> Last sign-in {user.last_sign_in_at ? fmt(user.last_sign_in_at) : 'never'}</span>
              <span style={S.metaItem}><Database size={12} /> {user.meeting_count} meeting{user.meeting_count !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={S.tabs}>
        <button style={tab === 'logs'  ? { ...S.tab, ...S.tabActive } : S.tab} onClick={() => setTab('logs')}>
          <FileText size={14} /> Activity Logs
          <span style={S.tabCount}>{logsTotal}</span>
        </button>
        <button style={tab === 'usage' ? { ...S.tab, ...S.tabActive } : S.tab} onClick={() => setTab('usage')}>
          <Zap size={14} /> AI Usage
          <span style={S.tabCount}>{totalCalls}</span>
        </button>
      </div>

      {/* ── Audit logs tab ───────────────────────────────────────────────────── */}
      {tab === 'logs' && (
        <div>
          {logsError && <div style={S.errBanner}>{logsError}</div>}
          {logsLoading ? (
            <p style={S.muted}>Loading logs…</p>
          ) : !logsError && logs.length === 0 ? (
            <p style={S.muted}>No activity logs for this user.</p>
          ) : (
            <>
              <div style={S.tableWrap}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      {['Time', 'Event', 'Meeting', 'IP', 'Metadata'].map((h) => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...S.td, whiteSpace: 'nowrap', color: '#64748b', fontSize: 12 }}>
                          {fmtFull(row.created_at)}
                        </td>
                        <td style={S.td}>
                          <span style={S.actionBadge}>{row.event_type}</span>
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>
                          {row.meeting_title ?? (row.meeting_id ? (
                            <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>{row.meeting_id.slice(0, 8)}…</span>
                          ) : '—')}
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                          {row.ip ?? '—'}
                        </td>
                        <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', maxWidth: 260 }}>
                          {row.metadata
                            ? <pre style={S.metaPre}>{JSON.stringify(row.metadata, null, 2)}</pre>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {logsTotalPages > 1 && (
                <div style={S.pagination}>
                  <button style={S.pageBtn} disabled={logsPage <= 1} onClick={() => handleLogsPage(logsPage - 1)}>← Prev</button>
                  <span style={S.pageLabel}>Page {logsPage} of {logsTotalPages} ({logsTotal} entries)</span>
                  <button style={S.pageBtn} disabled={logsPage >= logsTotalPages} onClick={() => handleLogsPage(logsPage + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── AI usage tab ─────────────────────────────────────────────────────── */}
      {tab === 'usage' && (
        <div>
          {usageError && <div style={S.errBanner}>{usageError}</div>}
          {usageLoading ? (
            <p style={S.muted}>Loading usage…</p>
          ) : (
            <>
              {/* Summary tiles */}
              <div style={S.tiles}>
                <Tile label="Total calls" value={totalCalls.toLocaleString()} />
                <Tile label="Tokens used" value={totalTokens.toLocaleString()} />
                <Tile label="Audio transcribed" value={`${Math.round(totalAudioSecs / 60)} min`} />
                <Tile label="Errors / 429s" value={totalErrors.toLocaleString()} accent={totalErrors > 0} />
              </div>

              {/* Token-metered table */}
              {tokenRows.length > 0 && (
                <>
                  <h3 style={S.sectionTitle}>Token-metered (Gemini)</h3>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {['Provider', 'Model', 'Operation', 'Calls', 'Input tokens', 'Output tokens', 'Total tokens', '429s', 'Errors'].map((h) => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tokenRows.map((r, i) => (
                          <tr key={i}>
                            <td style={S.td}>{r.provider}</td>
                            <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.model}</td>
                            <td style={S.td}>{r.operation ?? '—'}</td>
                            <td style={{ ...S.td, textAlign: 'right' }}>{r.calls.toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right' }}>{(r.total_input_tokens ?? 0).toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right' }}>{(r.total_output_tokens ?? 0).toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{(r.total_tokens ?? 0).toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right', color: r.rate_limited_count > 0 ? '#b45309' : undefined }}>{r.rate_limited_count}</td>
                            <td style={{ ...S.td, textAlign: 'right', color: r.error_count > 0 ? '#991b1b' : undefined }}>{r.error_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Audio-metered table */}
              {audioRows.length > 0 && (
                <>
                  <h3 style={S.sectionTitle}>Audio-metered (Speechmatics)</h3>
                  <div style={S.tableWrap}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          {['Provider', 'Model', 'Operation', 'Calls', 'Audio seconds', 'Audio minutes', '429s', 'Errors'].map((h) => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {audioRows.map((r, i) => (
                          <tr key={i}>
                            <td style={S.td}>{r.provider}</td>
                            <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{r.model}</td>
                            <td style={S.td}>{r.operation ?? '—'}</td>
                            <td style={{ ...S.td, textAlign: 'right' }}>{r.calls.toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right' }}>{Math.round(r.total_audio_seconds ?? 0).toLocaleString()}</td>
                            <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{((r.total_audio_seconds ?? 0) / 60).toFixed(1)}</td>
                            <td style={{ ...S.td, textAlign: 'right', color: r.rate_limited_count > 0 ? '#b45309' : undefined }}>{r.rate_limited_count}</td>
                            <td style={{ ...S.td, textAlign: 'right', color: r.error_count > 0 ? '#991b1b' : undefined }}>{r.error_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {usageRows.length === 0 && (
                <p style={S.muted}>No AI usage recorded for this user yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={S.tile}>
      <div style={{ ...S.tileValue, color: accent ? '#dc2626' : '#0f172a' }}>{value}</div>
      <div style={S.tileLabel}>{label}</div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtFull(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  page: { padding: '24px 32px', maxWidth: 1100 },

  back: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    color: '#64748b', textDecoration: 'none', fontSize: 13, marginBottom: 20,
  },

  errBanner: {
    background: '#fff0f0', border: '1px solid #f55', borderRadius: 6,
    padding: '10px 14px', color: '#b00020', fontSize: 14, marginBottom: 16,
  },
  muted: { color: '#94a3b8', fontSize: 14 },

  // User card
  card: {
    display: 'flex', alignItems: 'flex-start', gap: 16,
    background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
    padding: '20px 24px', marginBottom: 24,
  },
  cardAvatar: {
    width: 44, height: 44, background: '#dbeafe', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 8 },
  cardUsername: { fontSize: 13, color: '#64748b', fontWeight: 400 },
  cardMeta: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  metaItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#64748b' },

  roleAdmin: { display: 'inline-block', fontSize: 11, fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', padding: '2px 7px', borderRadius: 99 },
  roleUser:  { display: 'inline-block', fontSize: 11, fontWeight: 600, background: '#f0f0f0', color: '#555', padding: '2px 7px', borderRadius: 99 },
  disabledBadge: { display: 'inline-block', fontSize: 11, fontWeight: 600, background: '#fee2e2', color: '#991b1b', padding: '2px 7px', borderRadius: 99 },
  unverifiedBadge: { display: 'inline-block', fontSize: 11, fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: 99 },

  // Tabs
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e2e8f0', paddingBottom: 0 },
  tab: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', fontSize: 13, fontWeight: 500,
    border: 'none', background: 'none', cursor: 'pointer', color: '#64748b',
    borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabActive: { color: '#1d4ed8', borderBottomColor: '#3b82f6' },
  tabCount: {
    background: '#f1f5f9', color: '#64748b', fontSize: 11, fontWeight: 700,
    padding: '1px 6px', borderRadius: 99,
  },

  // Tables
  tableWrap: { overflowX: 'auto', background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 20 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap',
    background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 12,
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' },

  actionBadge: {
    display: 'inline-block', fontSize: 11, fontWeight: 600,
    background: '#f1f5f9', color: '#334155', padding: '2px 7px', borderRadius: 4,
    fontFamily: 'monospace',
  },
  metaPre: {
    margin: 0, fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    maxHeight: 80, overflowY: 'auto', color: '#64748b',
  },

  // Pagination
  pagination: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 20, justifyContent: 'center' },
  pageBtn: { fontSize: 13, padding: '5px 14px', border: '1px solid #d0d0d0', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#333' },
  pageLabel: { fontSize: 13, color: '#555' },

  // Usage tiles
  tiles: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 },
  tile: {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
    padding: '14px 20px', minWidth: 140,
  },
  tileValue: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  tileLabel: { fontSize: 12, color: '#64748b' },

  sectionTitle: { margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#0f172a' },
}
