'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    browserClient.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/meetings')
      } else {
        setChecking(false)
      }
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
      const data = (await res.json()) as {
        access_token?: string
        refresh_token?: string
        error?: string
      }

      if (!res.ok || !data.access_token || !data.refresh_token) {
        setError(data.error ?? 'Login failed. Please try again.')
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

  if (checking) return null

  return (
    <div className="w-full max-w-sm">
      {/* Card */}
      <div className="bg-white rounded-3xl border border-b-border shadow-b-xl p-8 relative">
        {/* Wordmark */}
        <div className="mb-6 text-center flex justify-center">
          <img src="/logo.svg" alt="Ricotdin" style={{ height: '44px', width: 'auto' }} />
        </div>

        <p className="text-center font-serif text-xl font-semibold text-b-fg mb-6">
          Welcome back
        </p>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-b-fg/70 font-sans">
              Email or username
            </span>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              autoFocus
              className="input-botanical"
              placeholder="you@example.com or username"
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
              autoComplete="current-password"
              className="input-botanical"
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
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-b-fg/50 mt-5 font-sans">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-b-terra font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
