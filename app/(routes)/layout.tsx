'use client'

// Auth guard for all app routes. Redirects to /login if no session.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { browserClient } from '@/lib/supabase/browser'
import { signOut } from '@/lib/supabase/auth'
import ThemeSwitcher from '@/components/ThemeSwitcher'

export default function RoutesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    void browserClient.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/login')
      } else {
        setEmail(session.user?.email ?? null)
        setReady(true)
      }
    })

    const { data: { subscription } } = browserClient.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_OUT') router.replace('/login')
      },
    )
    return () => subscription.unsubscribe()
  }, [router])

  if (!ready) {
    return (
      <div className="min-h-screen bg-b-bg flex items-center justify-center">
        <span className="text-sm text-b-primary font-sans tracking-widest uppercase animate-pulse">
          Loading…
        </span>
      </div>
    )
  }

  async function handleSignOut() {
    await signOut()
    router.replace('/login')
  }

  const navLinks = [
    { href: '/meetings', label: 'Meetings' },
    { href: '/record',   label: 'Record'   },
    { href: '/chat',     label: 'Chat'     },
  ]

  return (
    <>
      {/* Top nav bar */}
      <header className="sticky top-0 z-40 bg-b-bg/90 backdrop-blur-sm border-b border-b-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          {/* Wordmark */}
          <Link href="/meetings" className="font-serif font-bold text-xl text-b-fg tracking-tight">
            Ricot<em className="italic text-b-terra">din</em>
          </Link>

          {/* Nav links */}
          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={[
                    'px-3 py-1.5 rounded-full text-sm font-sans font-medium tracking-wide transition-all duration-300',
                    active
                      ? 'bg-b-fg text-white'
                      : 'text-b-fg/60 hover:text-b-fg hover:bg-b-clay',
                  ].join(' ')}
                >
                  {label}
                </Link>
              )
            })}
          </nav>

          {/* Theme switcher + user + sign out */}
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            {email && (
              <span className="hidden md:block text-xs text-b-fg/40 font-sans truncate max-w-[140px]">
                {email}
              </span>
            )}
            <button
              onClick={() => { void handleSignOut() }}
              className="text-xs font-sans font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full
                         border border-b-border text-b-fg/60 hover:text-b-fg hover:border-b-fg/30
                         transition-all duration-300 cursor-pointer bg-transparent"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="sm:hidden flex items-center gap-1 px-4 pb-2">
          {navLinks.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className={[
                  'px-3 py-1 rounded-full text-xs font-sans font-medium tracking-wide transition-all duration-300',
                  active
                    ? 'bg-b-fg text-white'
                    : 'text-b-fg/60 hover:text-b-fg hover:bg-b-clay',
                ].join(' ')}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>
    </>
  )
}
