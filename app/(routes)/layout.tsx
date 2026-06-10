'use client'

// Auth guard for all app routes. Redirects to /login if no session.
// Also renders a slim user bar at the top of every page.

import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'
import { signOut } from '@/lib/supabase/auth'

export default function RoutesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    // Check session once on mount
    void browserClient.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login')
      } else {
        setEmail(session.user?.email ?? null)
        setReady(true)
      }
    })

    // Redirect on sign-out (e.g. token expiry, sign out in another tab)
    const { data: { subscription } } = browserClient.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_OUT') router.replace('/login')
      },
    )
    return () => subscription.unsubscribe()
  }, [router])

  if (!ready) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', color: '#888' }}>
        Loading…
      </div>
    )
  }

  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  return (
    <>
      <div style={S.bar}>
        <span style={S.barEmail}>{email}</span>
        <button style={S.signOutBtn} onClick={() => { void handleSignOut() }}>
          Sign out
        </button>
      </div>
      {children}
    </>
  )
}

const S: Record<string, CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    padding: '6px 20px',
    background: '#f8f8f8',
    borderBottom: '1px solid #eee',
    fontSize: 13,
    color: '#555',
  },
  barEmail: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 },
  signOutBtn: {
    fontSize: 12,
    padding: '3px 10px',
    border: '1px solid #d0d0d0',
    borderRadius: 5,
    background: '#fff',
    cursor: 'pointer',
    color: '#333',
  },
}
