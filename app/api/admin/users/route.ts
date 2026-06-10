// GET /api/admin/users
//
// Returns a list of all users: { id, email, username, role, created_at, banned }.
// Requires admin role (checked via app_metadata — set server-side only).
//
// SECURITY: role is read from app_metadata (service-role-set), not user_metadata.
// SECURITY: service role key stays server-only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/server'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (res) {
    return res as NextResponse
  }

  const db = createServerClient()

  // Fetch all auth users (service role)
  const { data: { users: authUsers }, error: usersErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (usersErr) {
    console.error('[admin/users] listUsers failed:', usersErr.message)
    return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 500 })
  }

  // Fetch all profiles for username lookup
  const { data: profiles, error: profilesErr } = await db
    .from('profiles')
    .select('id, username, role, created_at')

  if (profilesErr) {
    console.error('[admin/users] profiles fetch failed:', profilesErr.message)
    return NextResponse.json({ error: 'Failed to fetch profiles.' }, { status: 500 })
  }

  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? [])

  const users = authUsers.map((u) => {
    const profile = profileMap.get(u.id)
    const appRole = (u.app_metadata as Record<string, unknown>)?.role as string | undefined
    return {
      id: u.id,
      email: u.email ?? null,
      username: profile?.username ?? null,
      role: appRole ?? profile?.role ?? 'user',
      created_at: u.created_at,
      banned: u.banned_until !== null && u.banned_until !== undefined,
    }
  })

  return NextResponse.json({ users })
}
