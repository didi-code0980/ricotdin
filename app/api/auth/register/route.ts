// POST /api/auth/register
//
// Creates a new user account:
//   1. Validates email, username, password.
//   2. Checks username uniqueness (server-side, via service role).
//   3. Creates the auth.users row via admin API — sets app_metadata.role='user'.
//   4. Inserts a public.profiles row.
//   5. Signs in and returns the session tokens.
//
// SECURITY: role is always forced to 'user'. The client cannot influence it.
// SECURITY: service role key stays server-only (never returned to client).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import {
  normalizeUsername,
  validateUsername,
  validateEmail,
  validatePassword,
} from '@/lib/auth/validate'

export async function POST(req: NextRequest) {
  let body: { email?: string; username?: string; password?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { email: rawEmail = '', username: rawUsername = '', password = '' } = body

  // ── Validate inputs ────────────────────────────────────────────────────────
  const emailErr = validateEmail(rawEmail.trim())
  if (emailErr) return NextResponse.json({ error: emailErr }, { status: 422 })

  const username = normalizeUsername(rawUsername)
  const usernameErr = validateUsername(username)
  if (usernameErr) return NextResponse.json({ error: usernameErr }, { status: 422 })

  const passwordErr = validatePassword(password)
  if (passwordErr) return NextResponse.json({ error: passwordErr }, { status: 422 })

  const email = rawEmail.trim().toLowerCase()

  // ── Check username uniqueness ──────────────────────────────────────────────
  const db = createServerClient()
  const { data: existing } = await db
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'That username is already taken. Please choose another.' },
      { status: 409 },
    )
  }

  // ── Create the auth user — Supabase will send a confirmation email ──────────
  const { data: adminData, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    app_metadata: { role: 'user' }, // ONLY place role is set; never user_metadata
  })

  if (createErr || !adminData.user) {
    // Supabase returns "User already registered" for duplicate emails
    const msg = createErr?.message ?? ''
    if (msg.toLowerCase().includes('already')) {
      return NextResponse.json(
        { error: 'An account with that email already exists.' },
        { status: 409 },
      )
    }
    console.error('[register] createUser failed:', msg)
    return NextResponse.json({ error: 'Failed to create account.' }, { status: 500 })
  }

  const userId = adminData.user.id

  // ── Insert profile row ─────────────────────────────────────────────────────
  const { error: profileErr } = await db
    .from('profiles')
    .insert({ id: userId, username, role: 'user' })

  if (profileErr) {
    // Cleanup: delete the auth user so we don't leave an orphan
    await db.auth.admin.deleteUser(userId)
    console.error('[register] profile insert failed:', profileErr.message)
    return NextResponse.json(
      { error: 'Failed to create user profile. Please try again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ needsVerification: true }, { status: 201 })
}
