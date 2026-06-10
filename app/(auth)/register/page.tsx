'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      })
      const data = (await res.json()) as {
        access_token?: string
        refresh_token?: string
        needsLogin?: boolean
        error?: string
      }

      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.')
        return
      }

      if (data.needsLogin) {
        // Edge case: account created but auto-sign-in failed — go to login
        router.replace('/login')
        return
      }

      if (!data.access_token || !data.refresh_token) {
        setError('Unexpected server response. Please try logging in.')
        return
      }

      await browserClient.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      })

      router.replace('/meetings')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={S.card}>
      <h1 style={S.title}>Create account</h1>
      <p style={S.sub}>Ricotdin Meeting Assistant</p>

      <form onSubmit={(e) => { void handleSubmit(e) }} style={S.form}>
        <label style={S.label}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            style={S.input}
            placeholder="you@example.com"
          />
        </label>

        <label style={S.label}>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            style={S.input}
            placeholder="3–30 chars: letters, digits, - or _"
          />
        </label>

        <label style={S.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={S.input}
            placeholder="At least 8 characters"
          />
        </label>

        {error && <p style={S.error}>{error}</p>}

        <button type="submit" disabled={loading} style={S.btn}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p style={S.footer}>
        Already have an account?{' '}
        <Link href="/login" style={S.link}>
          Sign in
        </Link>
      </p>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  card: {
    background: '#fff',
    borderRadius: 10,
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: 400,
  },
  title: { margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#111' },
  sub: { margin: '0 0 1.5rem', color: '#777', fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    fontSize: 14,
    fontWeight: 500,
    color: '#333',
  },
  input: {
    padding: '8px 10px',
    fontSize: 14,
    border: '1px solid #d0d0d0',
    borderRadius: 6,
    outline: 'none',
  },
  error: {
    fontSize: 13,
    color: '#b00020',
    background: '#fff0f0',
    border: '1px solid #f5c0c0',
    borderRadius: 6,
    padding: '8px 12px',
    margin: 0,
  },
  btn: {
    padding: '10px',
    fontSize: 15,
    fontWeight: 600,
    background: '#1a7f37',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    marginTop: 4,
  },
  footer: { textAlign: 'center', fontSize: 13, color: '#666', marginTop: '1.25rem', marginBottom: 0 },
  link: { color: '#1a7f37', fontWeight: 500 },
}
