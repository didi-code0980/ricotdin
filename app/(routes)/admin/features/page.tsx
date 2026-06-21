'use client'

import { useEffect, useState, useCallback } from 'react'
import { browserClient } from '@/lib/supabase/browser'
import { Layers } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type FeatureStatus = 'done' | 'partial' | 'not_started'

interface Feature {
  id: string
  key: string
  module_prefix: string
  module_name: string
  title: string
  user_story: string | null
  description: string | null
  content: string | null
  status: FeatureStatus
  priority: 'high' | 'medium' | 'low' | null
  note_tags: string[]
  depends_on: string[]
  blocks: string[]
  key_files: string[]
  updated_at: string
  updated_by: string | null
  change_note: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: FeatureStatus) {
  const map: Record<FeatureStatus, { label: string; style: React.CSSProperties }> = {
    done:        { label: 'Done',        style: { background: '#dcfce7', color: '#16a34a' } },
    partial:     { label: 'Partial',     style: { background: '#fef9c3', color: '#ca8a04' } },
    not_started: { label: 'Not started', style: { background: '#f1f5f9', color: '#64748b' } },
  }
  const { label, style } = map[status] ?? map.not_started
  return (
    <span style={{ ...S.badge, ...style }}>{label}</span>
  )
}

function priorityChip(p: string | null) {
  if (!p) return null
  const colors: Record<string, React.CSSProperties> = {
    high:   { background: '#fee2e2', color: '#dc2626' },
    medium: { background: '#ffedd5', color: '#ea580c' },
    low:    { background: '#f0fdf4', color: '#16a34a' },
  }
  return (
    <span style={{ ...S.chip, ...(colors[p] ?? {}) }}>{p}</span>
  )
}

function tagChip(tag: string) {
  const colors: Record<string, React.CSSProperties> = {
    Blocker:   { background: '#fee2e2', color: '#dc2626' },
    Mandatory: { background: '#fce7f3', color: '#db2777' },
    SaaS:      { background: '#ede9fe', color: '#7c3aed' },
  }
  return (
    <span key={tag} style={{ ...S.chip, ...(colors[tag] ?? { background: '#e2e8f0', color: '#475569' }) }}>
      {tag}
    </span>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Module section header ─────────────────────────────────────────────────────

function ModuleHeader({ prefix, name, count }: { prefix: string; name: string; count: number }) {
  return (
    <div style={S.moduleHeader}>
      <span style={S.modulePrefix}>{prefix}</span>
      <span style={S.moduleName}>{name}</span>
      <span style={S.moduleCount}>{count}</span>
    </div>
  )
}

// ── Edit panel ────────────────────────────────────────────────────────────────

function EditPanel({
  feature,
  token,
  onSaved,
  onClose,
}: {
  feature: Feature
  token: string
  onSaved: (updated: Feature) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({
    status: feature.status,
    title: feature.title,
    description: feature.description ?? '',
    content: feature.content ?? '',
    priority: feature.priority ?? '',
    note_tags: feature.note_tags.join(', '),
    depends_on: feature.depends_on.join(', '),
    key_files: feature.key_files.join(', '),
    change_note: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    setSuccess(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSuccess(false)

    const body: Record<string, unknown> = {
      status: form.status,
      title: form.title.trim(),
      description: form.description.trim() || null,
      content: form.content || null,
      priority: (form.priority || null) as 'high' | 'medium' | 'low' | null,
      note_tags: form.note_tags.split(',').map((s) => s.trim()).filter(Boolean),
      depends_on: form.depends_on.split(',').map((s) => s.trim()).filter(Boolean),
      key_files: form.key_files.split(',').map((s) => s.trim()).filter(Boolean),
    }
    if (form.change_note.trim()) body.change_note = form.change_note.trim()

    const res = await fetch(`/api/admin/features/${feature.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(json.error ?? 'Save failed.')
      return
    }
    setSuccess(true)
    setForm((f) => ({ ...f, change_note: '' }))
    onSaved(json.feature as Feature)
  }

  return (
    <div style={S.panel}>
      {/* Header */}
      <div style={S.panelHeader}>
        <div>
          <div style={S.panelKey}>{feature.key}</div>
          <div style={S.panelTitle}>{feature.title}</div>
          {feature.updated_by && (
            <div style={S.panelMeta}>
              Last edited {fmt(feature.updated_at)} by {feature.updated_by}
            </div>
          )}
        </div>
        <button onClick={onClose} style={S.closeBtn} aria-label="Close">✕</button>
      </div>

      <div style={S.panelBody}>
        {/* Status + Priority row */}
        <div style={S.row2}>
          <label style={S.label}>
            Status
            <select
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
              style={S.select}
            >
              <option value="done">Done</option>
              <option value="partial">Partial</option>
              <option value="not_started">Not started</option>
            </select>
          </label>
          <label style={S.label}>
            Priority
            <select
              value={form.priority}
              onChange={(e) => set('priority', e.target.value)}
              style={S.select}
            >
              <option value="">—</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>

        {/* Title */}
        <label style={S.label}>
          Title
          <input
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            style={S.input}
          />
        </label>

        {/* Description */}
        <label style={S.label}>
          Description (short summary)
          <input
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            style={S.input}
            placeholder="One-line description…"
          />
        </label>

        {/* Note tags */}
        <label style={S.label}>
          Note tags (comma-separated)
          <input
            value={form.note_tags}
            onChange={(e) => set('note_tags', e.target.value)}
            style={S.input}
            placeholder="Blocker, Mandatory, SaaS"
          />
        </label>

        {/* Depends on */}
        <label style={S.label}>
          Depends on (feature codes, comma-separated)
          <input
            value={form.depends_on}
            onChange={(e) => set('depends_on', e.target.value)}
            style={S.input}
            placeholder="PRP-01, AUT-04"
          />
        </label>

        {/* Key files */}
        <label style={S.label}>
          Key files (comma-separated paths)
          <input
            value={form.key_files}
            onChange={(e) => set('key_files', e.target.value)}
            style={S.input}
          />
        </label>

        {/* Content */}
        <label style={S.label}>
          Content (markdown)
          <textarea
            value={form.content}
            onChange={(e) => set('content', e.target.value)}
            style={S.textarea}
            rows={16}
          />
        </label>

        {/* Change note */}
        <label style={S.label}>
          Change note (optional)
          <input
            value={form.change_note}
            onChange={(e) => set('change_note', e.target.value)}
            style={S.input}
            placeholder="Why this change was made…"
          />
        </label>

        {error && <div style={S.errorBanner}>{error}</div>}
        {success && <div style={S.successBanner}>Saved successfully.</div>}

        <button onClick={save} disabled={saving} style={S.saveBtn}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FeaturesPage() {
  const [features, setFeatures] = useState<Feature[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<FeatureStatus | ''>('')
  const [selected, setSelected] = useState<Feature | null>(null)
  const [token, setToken] = useState('')

  useEffect(() => {
    browserClient.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (session?.access_token) setToken(session.access_token)
      })
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ perPage: '200' })
      const res = await fetch(`/api/admin/features?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setFeatures(json.features)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  // Client-side filter
  const filtered = features.filter((f) => {
    if (statusFilter && f.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (
        f.key.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        (f.description ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  // Group by module_prefix preserving sort order
  const modules: Array<{ prefix: string; name: string; items: Feature[] }> = []
  for (const f of filtered) {
    const last = modules[modules.length - 1]
    if (last && last.prefix === f.module_prefix) {
      last.items.push(f)
    } else {
      modules.push({ prefix: f.module_prefix, name: f.module_name, items: [f] })
    }
  }

  function handleSaved(updated: Feature) {
    setFeatures((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
    setSelected(updated)
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.headerIcon}><Layers size={20} color="#93c5fd" /></div>
          <div>
            <h1 style={S.h1}>Feature Registry</h1>
            <p style={S.sub}>
              {features.length} features across {[...new Set(features.map((f) => f.module_prefix))].length} modules.
              Seeded from <code style={S.code}>ai-instruction/features/</code> — DB is the source of truth.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={S.filters}>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelected(null) }}
          placeholder="Search key, title, description…"
          style={S.searchInput}
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as FeatureStatus | ''); setSelected(null) }}
          style={S.filterSelect}
        >
          <option value="">All statuses</option>
          <option value="done">Done</option>
          <option value="partial">Partial</option>
          <option value="not_started">Not started</option>
        </select>
        <span style={S.countLabel}>{filtered.length} shown</span>
      </div>

      {/* Body */}
      <div style={S.body}>
        {/* List */}
        <div style={selected ? S.listNarrow : S.listFull}>
          {loading && <p style={S.muted}>Loading…</p>}
          {error && <p style={S.errorText}>{error}</p>}
          {!loading && !error && modules.length === 0 && (
            <p style={S.muted}>No features match.</p>
          )}
          {modules.map(({ prefix, name, items }) => (
            <div key={prefix} style={S.moduleSection}>
              <ModuleHeader prefix={prefix} name={name} count={items.length} />
              <div style={S.featureList}>
                {items.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setSelected(selected?.id === f.id ? null : f)}
                    style={{
                      ...S.featureRow,
                      ...(selected?.id === f.id ? S.featureRowActive : {}),
                    }}
                  >
                    <span style={S.featureKey}>{f.key}</span>
                    <span style={S.featureTitle}>{f.title}</span>
                    <span style={S.featureBadges}>
                      {statusBadge(f.status)}
                      {priorityChip(f.priority)}
                      {f.note_tags.map((t) => tagChip(t))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Edit panel */}
        {selected && token && (
          <EditPanel
            feature={selected}
            token={token}
            onSaved={handleSaved}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: {
    padding: '32px 36px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: 1400,
    margin: '0 auto',
  },

  // Header
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  headerLeft: { display: 'flex', alignItems: 'flex-start', gap: 14 },
  headerIcon: {
    width: 42, height: 42, background: '#1e3a5f', borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2,
  },
  h1: { margin: 0, fontSize: 22, fontWeight: 700, color: '#0f172a' },
  sub: { margin: '4px 0 0', fontSize: 13, color: '#64748b' },
  code: { fontFamily: 'monospace', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, fontSize: 12 },

  // Filters
  filters: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 },
  searchInput: {
    flex: 1, maxWidth: 340, padding: '7px 12px', border: '1px solid #e2e8f0',
    borderRadius: 7, fontSize: 13, outline: 'none', background: '#fff',
  },
  filterSelect: {
    padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 7,
    fontSize: 13, background: '#fff', color: '#374151',
  },
  countLabel: { fontSize: 12, color: '#94a3b8', marginLeft: 4 },

  // Body (list + panel side-by-side)
  body: { display: 'flex', gap: 20, alignItems: 'flex-start' },
  listFull: { flex: 1 },
  listNarrow: { width: 480, flexShrink: 0 },

  // Module section
  moduleSection: { marginBottom: 20 },
  moduleHeader: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', background: '#f8fafc',
    border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 4,
  },
  modulePrefix: {
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
    background: '#1e293b', color: '#93c5fd', padding: '2px 7px', borderRadius: 4,
  },
  moduleName: { fontSize: 13, fontWeight: 600, color: '#334155', flex: 1 },
  moduleCount: { fontSize: 11, color: '#94a3b8', fontWeight: 500 },

  // Feature list
  featureList: { display: 'flex', flexDirection: 'column', gap: 2 },
  featureRow: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7,
    textAlign: 'left', cursor: 'pointer', width: '100%',
    transition: 'background 0.1s, border-color 0.1s',
  },
  featureRowActive: { background: '#eff6ff', borderColor: '#93c5fd' },
  featureKey: {
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
    color: '#475569', minWidth: 56,
  },
  featureTitle: { flex: 1, fontSize: 13, color: '#0f172a', textAlign: 'left' },
  featureBadges: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },

  // Badges + chips
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 99,
    fontSize: 11, fontWeight: 600,
  },
  chip: {
    display: 'inline-block', padding: '1px 6px', borderRadius: 99,
    fontSize: 10, fontWeight: 600,
  },

  // Edit panel
  panel: {
    flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
    display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid #e2e8f0',
  },
  panelKey: { fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 2 },
  panelTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a' },
  panelMeta: { fontSize: 11, color: '#94a3b8', marginTop: 3 },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
    color: '#94a3b8', padding: 4, lineHeight: 1,
  },
  panelBody: { flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 },

  // Form
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#374151' },
  input: {
    padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 13, outline: 'none', background: '#fff', color: '#0f172a',
  },
  select: {
    padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 13, background: '#fff', color: '#0f172a',
  },
  textarea: {
    padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 12, fontFamily: 'monospace', resize: 'vertical',
    lineHeight: 1.5, color: '#0f172a', background: '#fafafa',
  },
  saveBtn: {
    padding: '9px 24px', background: '#1e3a5f', color: '#f1f5f9',
    border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', alignSelf: 'flex-end',
  },

  // Feedback
  errorBanner: {
    padding: '10px 14px', background: '#fee2e2', color: '#dc2626',
    borderRadius: 7, fontSize: 13,
  },
  successBanner: {
    padding: '10px 14px', background: '#dcfce7', color: '#16a34a',
    borderRadius: 7, fontSize: 13,
  },
  errorText: { color: '#dc2626', fontSize: 13 },
  muted: { color: '#94a3b8', fontSize: 13 },
}
