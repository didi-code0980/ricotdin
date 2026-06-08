'use client'

// TEMPORARY — anonymous sign-in so RLS has a real auth.uid().
// Phase 7 replaces this with real login (email/password or OAuth).
// To enable: go to Supabase dashboard → Authentication → Providers → Anonymous sign-ins → Enable.

import { browserClient } from './browser'

/**
 * Ensures the browser has an active Supabase session.
 * If none exists, signs in anonymously and returns the new access token.
 * Safe to call multiple times — returns the existing token if already signed in.
 */
export async function ensureAnonymousSession(): Promise<string> {
  const {
    data: { session },
  } = await browserClient.auth.getSession()
  if (session?.access_token) return session.access_token

  const { data, error } = await browserClient.auth.signInAnonymously()
  if (error) {
    throw new Error(
      `Anonymous sign-in failed: ${error.message}. ` +
        'Make sure "Anonymous sign-ins" is enabled in the Supabase dashboard ' +
        '(Authentication → Providers → Anonymous sign-ins).',
    )
  }
  if (!data.session) {
    throw new Error('No session returned after anonymous sign-in.')
  }
  return data.session.access_token
}

/**
 * Returns the current session's access token, or null if not signed in.
 * Does not attempt sign-in — use ensureAnonymousSession() when you need a token.
 */
export async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await browserClient.auth.getSession()
  return session?.access_token ?? null
}
