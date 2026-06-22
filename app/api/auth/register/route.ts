// POST /api/auth/register
//
// Creates a new user account:
//   1. Validates email, username, password.
//   2. Checks username uniqueness (server-side, via service role).
//   3. Creates the auth.users row via admin API — sets app_metadata.role='user',
//      email_confirm=true (no email verification for MVP).
//   4. Immediately disables the account (ban_duration='876600h') so the user
//      cannot sign in until an admin enables them in /admin/users.
//   5. Inserts a public.profiles row.
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

  // ── Create the auth user (email_confirm=true skips verification email) ───────
  const { data: adminData, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,             // MVP: no email verification required
    app_metadata: { role: 'user' },  // ONLY place role is set; never user_metadata
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

  // ── Disable the account until an admin approves it ────────────────────────
  // Uses the same ban_duration mechanism as the admin status toggle.
  const { error: banErr } = await db.auth.admin.updateUserById(userId, {
    ban_duration: '876600h', // ~100 years — effectively disabled
  })
  if (banErr) {
    // Non-fatal: log and continue. The account is created; admin can enable manually.
    console.error('[register] initial ban failed (account created but enabled):', banErr.message)
  }

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

  return NextResponse.json({ pendingApproval: true }, { status: 201 })
}
