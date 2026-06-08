'use client'

// TEMPORARY — see lib/supabase/auth.ts. Replaced by real auth in Phase 7.
// Silently establishes an anonymous Supabase session on first page load so
// auth.uid() is always set and RLS works correctly.

import { useEffect } from 'react'
import { ensureAnonymousSession } from '@/lib/supabase/auth'

export function AuthBootstrap() {
  useEffect(() => {
    void ensureAnonymousSession().catch((err: unknown) => {
      console.error('[Auth] Failed to establish session:', err)
    })
  }, [])
  return null
}
