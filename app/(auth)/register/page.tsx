'use client'

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
    <div className="w-full max-w-sm">
      <div className="bg-white rounded-3xl border border-b-border shadow-b-xl p-8">
        {/* Wordmark */}
        <div className="mb-6 text-center flex justify-center">
          <img src="/logo.svg" alt="Ricotdin" style={{ height: '44px', width: 'auto' }} />
        </div>

        <p className="text-center font-serif text-xl font-semibold text-b-fg mb-6">
          Create your account
        </p>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-b-fg/70 font-sans">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              className="input-botanical"
              placeholder="you@example.com"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-b-fg/70 font-sans">
              Username
            </span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="input-botanical"
              placeholder="3–30 chars: letters, digits, - or _"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-b-fg/70 font-sans">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="input-botanical"
              placeholder="At least 8 characters"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary mt-1 w-full"
            style={{ opacity: loading ? 0.65 : 1 }}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-b-fg/50 mt-5 font-sans">
          Already have an account?{' '}
          <Link href="/login" className="text-b-terra font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
