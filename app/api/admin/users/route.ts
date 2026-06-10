// GET /api/admin/users?page=1&perPage=20&search=
//
// Returns a paginated, searchable list of all users.
// Each row includes: id, email, username, role, disabled, meeting_count,
// created_at, last_sign_in_at.
//
// Fetches all users via the Admin API (listUsers, max perPage=1000) and applies
// search + pagination server-side so we can join with profiles + meeting counts.
//
// SECURITY: requires admin role (checked server-side via app_metadata).
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

  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('perPage') ?? '20', 10)))
  const search = searchParams.get('search')?.toLowerCase().trim() ?? ''

  const db = createServerClient()

  // Fetch all users from the Admin API (up to 1000; sufficient for MVP)
  const { data: { users: authUsers }, error: usersErr } = await db.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (usersErr) {
    console.error('[admin/users] listUsers failed:', usersErr.message)
    return NextResponse.json({ error: 'Failed to fetch users.' }, { status: 500 })
  }

  // Fetch all profiles (username + role)
  const { data: profiles, error: profilesErr } = await db
    .from('profiles')
    .select('id, username, role')

  if (profilesErr) {
    console.error('[admin/users] profiles fetch failed:', profilesErr.message)
    return NextResponse.json({ error: 'Failed to fetch profiles.' }, { status: 500 })
  }

  // Fetch meeting counts per user
  const { data: meetingRows, error: meetingsErr } = await db
    .from('meetings')
    .select('user_id')

  if (meetingsErr) {
    console.error('[admin/users] meetings count failed:', meetingsErr.message)
    // Non-fatal — show 0 rather than failing the whole request
  }

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))

  const countMap = new Map<string, number>()
  for (const row of meetingRows ?? []) {
    countMap.set(row.user_id, (countMap.get(row.user_id) ?? 0) + 1)
  }

  const allUsers = authUsers.map((u) => {
    const profile = profileMap.get(u.id)
    const appRole = (u.app_metadata as Record<string, unknown>)?.role as string | undefined
    return {
      id: u.id,
      email: u.email ?? null,
      username: profile?.username ?? null,
      role: (appRole ?? profile?.role ?? 'user') as 'user' | 'admin',
      disabled: !!u.banned_until && new Date(u.banned_until) > new Date(),
      meeting_count: countMap.get(u.id) ?? 0,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
    }
  })

  // Server-side search by email or username
  const filtered = search
    ? allUsers.filter(
        (u) =>
          u.email?.toLowerCase().includes(search) ||
          u.username?.toLowerCase().includes(search),
      )
    : allUsers

  const total = filtered.length
  const offset = (page - 1) * perPage
  const users = filtered.slice(offset, offset + perPage)

  return NextResponse.json({ users, total, page, perPage })
}
