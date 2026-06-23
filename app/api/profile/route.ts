// GET  /api/profile  — read own account overview
// PATCH /api/profile — update username / display_name / theme_preference / avatar_key
//
// Authentication: Bearer JWT (anon-key client via requireUser).
// Ownership: user can only read/update their own profile row (RLS enforces this;
//   column-level grant covers username, display_name, avatar_key, theme_preference).
//   Role is never returned as writable and never accepted in PATCH body.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/auth/server'
import { createServerClient } from '@/lib/supabase/server'
import { createSignedDownloadUrl, deleteObject } from '@/lib/storage'
import { normalizeUsername, validateUsername } from '@/lib/auth/validate'
import type { Database, Profile } from '@/types/database'

type Theme = 'luxury' | 'default' | 'playful'
const VALID_THEMES: Theme[] = ['luxury', 'default', 'playful']

// ---------------------------------------------------------------------------
// GET /api/profile
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  const db = createServerClient()

  // Fetch profiles row
  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    console.error('[GET /api/profile] profile fetch failed:', profileErr?.message)
    return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
  }

  // Meeting count and folder count — parallel, non-fatal
  const [{ count: meetingCount, error: countErr }, { count: folderCount, error: folderCountErr }] =
    await Promise.all([
      db.from('meetings').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      db.from('folders').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ])

  if (countErr) console.error('[GET /api/profile] meeting count failed:', countErr.message)
  if (folderCountErr) console.error('[GET /api/profile] folder count failed:', folderCountErr.message)

  // Resolve avatar signed URL if a key is stored
  let avatarUrl: string | null = null
  if (profile.avatar_key) {
    try {
      avatarUrl = await createSignedDownloadUrl({
        key: profile.avatar_key,
        provider: 'r2',
        expiresIn: 3600,
      })
    } catch (e) {
      console.error('[GET /api/profile] avatar signed URL failed:', e)
    }
  }

  return NextResponse.json({
    id: user.id,
    email: user.email ?? null,
    username: profile.username,
    display_name: profile.display_name,
    avatar_key: profile.avatar_key,
    avatar_url: avatarUrl,
    theme_preference: profile.theme_preference,
    role: profile.role as 'user' | 'admin',
    created_at: profile.created_at,
    meeting_count: meetingCount ?? 0,
    folder_count: folderCount ?? 0,
  })
}

// ---------------------------------------------------------------------------
// PATCH /api/profile
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  let user
  try {
    user = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const updates: Partial<Pick<Profile, 'username' | 'display_name' | 'theme_preference' | 'avatar_key'>> = {}

  // --- username ---
  if ('username' in body) {
    const raw = body.username
    if (typeof raw !== 'string') {
      return NextResponse.json({ error: 'username must be a string.' }, { status: 400 })
    }
    const normalized = normalizeUsername(raw)
    const err = validateUsername(normalized)
    if (err) return NextResponse.json({ error: err }, { status: 422 })

    // Uniqueness check — skip if it's unchanged
    const db = createServerClient()
    const { data: existing } = await db
      .from('profiles')
      .select('id')
      .eq('username', normalized)
      .neq('id', user.id)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: 'Username is already taken.' }, { status: 409 })
    }
    updates.username = normalized
  }

  // --- display_name ---
  if ('display_name' in body) {
    const raw = body.display_name
    if (raw !== null && typeof raw !== 'string') {
      return NextResponse.json({ error: 'display_name must be a string or null.' }, { status: 400 })
    }
    if (typeof raw === 'string' && raw.length > 50) {
      return NextResponse.json({ error: 'Display name must be at most 50 characters.' }, { status: 422 })
    }
    updates.display_name = raw === '' ? null : raw
  }

  // --- theme_preference ---
  if ('theme_preference' in body) {
    const raw = body.theme_preference
    if (raw !== null && !VALID_THEMES.includes(raw as Theme)) {
      return NextResponse.json(
        { error: `theme_preference must be one of: ${VALID_THEMES.join(', ')}.` },
        { status: 422 },
      )
    }
    updates.theme_preference = raw as Theme | null
  }

  // --- avatar_key (set after client completes R2 PUT) ---
  if ('avatar_key' in body) {
    const newKey = body.avatar_key
    if (newKey !== null && typeof newKey !== 'string') {
      return NextResponse.json({ error: 'avatar_key must be a string or null.' }, { status: 400 })
    }

    // If replacing an existing avatar, delete the old R2 object
    const db = createServerClient()
    const { data: current } = await db
      .from('profiles')
      .select('avatar_key')
      .eq('id', user.id)
      .single()

    const oldKey = current?.avatar_key ?? null
    if (oldKey && oldKey !== newKey) {
      try {
        await deleteObject({ key: oldKey, provider: 'r2' })
      } catch (e) {
        console.error('[PATCH /api/profile] old avatar delete failed (non-fatal):', e)
      }
    }

    updates.avatar_key = newKey
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided.' }, { status: 400 })
  }

  // Write via user-scoped client so RLS + column-level grant is enforced
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const userClient = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: updateErr } = await userClient
    .from('profiles')
    .update(updates)
    .eq('id', user.id)

  if (updateErr) {
    console.error('[PATCH /api/profile] update failed:', updateErr.message)
    if (updateErr.code === '23505') {
      return NextResponse.json({ error: 'Username is already taken.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
