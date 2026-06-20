'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentRole, getAccessToken } from '@/lib/supabase/auth'

// ── Types ─────────────────────────────────────────────────────────────────────

type KeyStatus = 'active' | 'disabled'

type MaskedKey = {
  id: string
  created_at: string
  provider: string
  label: string
  last4: string
  status: KeyStatus
  disabled_reason: string | null
  last_used_at: string | null
}

const PROVIDERS = ['gemini', 'speechmatics'] as const
type Provider = typeof PROVIDERS[number]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function maskDisplay(last4: string): string {
  return `••••${last4}`
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KeysPage() {
  const [loading, setLoading]         = useState(true)
  const [forbidden, setForbidden]     = useState(false)
  const [keys, setKeys]               = useState<MaskedKey[]>([])
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState<string | null>(null)
  const [busyId, setBusyId]           = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MaskedKey | null>(null)
  const [confirmDisable, setConfirmDisable] = useState<MaskedKey | null>(null)

  // Add-key form state
  const [formProvider, setFormProvider] = useState<Provider>('gemini')
  const [formLabel, setFormLabel]       = useState('')
  const [formKey, setFormKey]           = useState('')
  const [formBusy, setFormBusy]         = useState(false)
  const [formError, setFormError]       = useState<string | null>(null)
  const [justAdded, setJustAdded]       = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const fetchKeys = useCallback(async (token: string, signal: AbortSignal) => {
    const res = await fetch('/api/admin/keys', {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
    if (!res.ok || signal.aborted) return
    const data = await res.json() as { keys: MaskedKey[] }
    setKeys(data.keys)
  }, [])

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current
    const token = await getAccessToken()
    if (!token || signal.aborted) return
    try {
      await fetchKeys(token, signal)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError('Failed to load keys.')
      }
    }
  }, [fetchKeys])

  useEffect(() => {
    async function init() {
      const role = await getCurrentRole()
      if (role !== 'admin') { setForbidden(true); setLoading(false); return }
      await refresh()
      setLoading(false)
    }
    void init()
    return () => abortRef.current?.abort()
  }, [refresh])

  // ── Add key ────────────────────────────────────────────────────────────────

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormBusy(true)
    setJustAdded(null)
    setSuccess(null)

    try {
      const token = await getAccessToken()
      if (!token) { setFormError('Not authenticated.'); return }

      const res = await fetch('/api/admin/keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ provider: formProvider, label: formLabel.trim(), key: formKey.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(data.error ?? 'Failed to add key.'); return }

      // Success: clear the form and show a one-time confirmation.
      // The key can never be viewed again after this point.
      setFormLabel('')
      setFormKey('')
      setJustAdded(
        `Key "${data.key.label}" (••••${data.key.last4}) saved. ` +
        'It cannot be viewed again — store it securely.',
      )
      await refresh()
    } catch {
      setFormError('Network error.')
    } finally {
      setFormBusy(false)
    }
  }

  // ── Toggle status ──────────────────────────────────────────────────────────

  async function handleToggleStatus(key: MaskedKey) {
    if (key.status === 'active') {
      setConfirmDisable(key)
      return
    }
    await doToggle(key.id, 'active')
  }

  async function doToggle(keyId: string, newStatus: 'active' | 'disabled') {
    setBusyId(keyId)
    setError(null)
    setSuccess(null)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/admin/keys/${keyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to update key.'); return }
      setKeys(prev => prev.map(k => k.id === keyId ? { ...k, ...data.key } : k))
      setSuccess(`Key ${newStatus === 'active' ? 'enabled' : 'disabled'}.`)
    } catch {
      setError('Network error.')
    } finally {
      setBusyId(null)
      setConfirmDisable(null)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function handleDelete(keyId: string) {
    setBusyId(keyId)
    setError(null)
    setSuccess(null)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/admin/keys/${keyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to delete key.'); return }
      setKeys(prev => prev.filter(k => k.id !== keyId))
      setSuccess('Key deleted.')
    } catch {
      setError('Network error.')
    } finally {
      setBusyId(null)
      setConfirmDelete(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: 32, color: '#888' }}>Loading…</div>
  }
  if (forbidden) {
    return <div style={{ padding: 32, color: '#dc2626' }}>Access denied — admins only.</div>
  }

  const keysByProvider = PROVIDERS.map(p => ({
    provider: p,
    keys: keys.filter(k => k.provider === p),
  }))

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Provider API Keys</h1>
      <p style={{ fontSize: 13, color: '#666', marginBottom: 28 }}>
        Keys are encrypted at rest (AES-256-GCM). They cannot be viewed after saving.
        The DB keys supplement or replace env-var keys; existing env vars continue to work
        as a fallback.
      </p>

      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
          padding: '10px 14px', marginBottom: 20, color: '#dc2626', fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {success && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6,
          padding: '10px 14px', marginBottom: 20, color: '#16a34a', fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {success}
          <button onClick={() => setSuccess(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* Per-provider key tables */}
      {keysByProvider.map(({ provider, keys: providerKeys }) => (
        <section key={provider} style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, textTransform: 'capitalize', marginBottom: 10 }}>
            {provider}
            <span style={{ marginLeft: 8, fontSize: 12, color: '#888', fontWeight: 400 }}>
              {providerKeys.filter(k => k.status === 'active').length} active
            </span>
          </h2>

          {providerKeys.length === 0 ? (
            <p style={{ fontSize: 13, color: '#999', paddingLeft: 4 }}>
              No DB keys configured — using env var fallback.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  {(['Label', 'Key', 'Status', 'Last used', 'Actions'] as const).map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 500, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {providerKeys.map(k => (
                  <tr key={k.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 10px', fontWeight: 500 }}>{k.label}</td>
                    <td style={{ padding: '10px 10px', fontFamily: 'monospace', color: '#374151' }}>
                      {maskDisplay(k.last4)}
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
                        background: k.status === 'active' ? '#dcfce7' : '#f3f4f6',
                        color:      k.status === 'active' ? '#16a34a' : '#6b7280',
                      }}>
                        {k.status}
                      </span>
                      {k.disabled_reason && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af' }}>
                          ({k.disabled_reason})
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '10px 10px', color: '#6b7280' }}>{fmtDate(k.last_used_at)}</td>
                    <td style={{ padding: '10px 10px' }}>
                      <button
                        onClick={() => handleToggleStatus(k)}
                        disabled={busyId === k.id}
                        style={{
                          fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                          border: '1px solid #d1d5db', background: '#fff', marginRight: 6,
                          opacity: busyId === k.id ? 0.5 : 1,
                        }}
                      >
                        {k.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(k)}
                        disabled={busyId === k.id}
                        style={{
                          fontSize: 12, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                          border: '1px solid #fca5a5', background: '#fff', color: '#dc2626',
                          opacity: busyId === k.id ? 0.5 : 1,
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {/* Add key form */}
      <section style={{
        background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 24,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Add a new key</h2>
        <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          Keys are write-only — they cannot be retrieved after saving.
        </p>

        {justAdded && (
          <div style={{
            background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6,
            padding: '10px 14px', marginBottom: 16, color: '#16a34a', fontSize: 13,
          }}>
            {justAdded}
          </div>
        )}
        {formError && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6,
            padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13,
          }}>
            {formError}
          </div>
        )}

        <form onSubmit={handleAddKey} style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 3fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                Provider
              </label>
              <select
                value={formProvider}
                onChange={e => setFormProvider(e.target.value as Provider)}
                disabled={formBusy}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 5,
                  border: '1px solid #d1d5db', fontSize: 13, background: '#fff',
                }}
              >
                {PROVIDERS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                Label
              </label>
              <input
                type="text"
                value={formLabel}
                onChange={e => setFormLabel(e.target.value)}
                placeholder="e.g. prod-key-1"
                maxLength={80}
                required
                disabled={formBusy}
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 5,
                  border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
                API Key <span style={{ fontWeight: 400, color: '#9ca3af' }}>(write-only)</span>
              </label>
              <input
                type="password"
                value={formKey}
                onChange={e => setFormKey(e.target.value)}
                placeholder="Paste key here — it will not be shown again"
                required
                disabled={formBusy}
                autoComplete="off"
                style={{
                  width: '100%', padding: '7px 10px', borderRadius: 5,
                  border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={formBusy || !formLabel.trim() || !formKey.trim()}
              style={{
                padding: '7px 18px', borderRadius: 5, fontSize: 13, fontWeight: 600,
                background: formBusy || !formLabel.trim() || !formKey.trim() ? '#d1d5db' : '#2563eb',
                color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {formBusy ? 'Saving…' : 'Add key'}
            </button>
          </div>
        </form>
      </section>

      {/* Disable confirm dialog */}
      {confirmDisable && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: 28, maxWidth: 420, width: '90%',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Disable key?</h3>
            <p style={{ fontSize: 13, color: '#555', marginBottom: 20 }}>
              "{confirmDisable.label}" (••••{confirmDisable.last4}) will be disabled immediately.
              The provider will stop using it on the next request.
              You can re-enable it later.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDisable(null)}
                style={{ padding: '7px 16px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={() => doToggle(confirmDisable.id, 'disabled')}
                disabled={busyId === confirmDisable.id}
                style={{ padding: '7px 16px', borderRadius: 5, background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {busyId === confirmDisable.id ? 'Disabling…' : 'Disable'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: 28, maxWidth: 420, width: '90%',
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Delete key?</h3>
            <p style={{ fontSize: 13, color: '#555', marginBottom: 20 }}>
              "{confirmDelete.label}" (••••{confirmDelete.last4}) will be permanently deleted.
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{ padding: '7px 16px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.id)}
                disabled={busyId === confirmDelete.id}
                style={{ padding: '7px 16px', borderRadius: 5, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {busyId === confirmDelete.id ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
