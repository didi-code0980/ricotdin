// PATCH /api/admin/users/[id]
// DELETE /api/admin/users/[id]
//
// PATCH body: { role?: 'user' | 'admin', banned?: boolean }
//   - Updates app_metadata.role and syncs to profiles.role (keeping them in sync).
// DELETE: disables the account (bans the user; data is retained).
//
// SECURITY: requires admin role on the CALLER; checked server-side.
// SECURITY: an admin cannot demote themselves (to avoid lock-out).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/server'
import type { UserRole } from '@/types/database'

const VALID_ROLES: UserRole[] = ['user', 'admin']

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller
  try {
    caller = await requireAdmin(req)
  } catch (res) {
    return res as NextResponse
  }

  const { id: targetId } = await params

  let body: { role?: string; banned?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const db = createServerClient()
  const updates: Record<string, unknown> = {}

  // ── Role change ────────────────────────────────────────────────────────────
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role as UserRole)) {
      return NextResponse.json(
        { error: `Role must be one of: ${VALID_ROLES.join(', ')}.` },
        { status: 422 },
      )
    }

    // Admins cannot demote themselves to prevent accidental lock-out
    if (targetId === caller.id && body.role !== 'admin') {
      return NextResponse.json(
        { error: 'You cannot change your own role.' },
        { status: 400 },
      )
    }

    // Update app_metadata (source of truth for JWT claims)
    const { error: metaErr } = await db.auth.admin.updateUserById(targetId, {
      app_metadata: { role: body.role },
    })
    if (metaErr) {
      console.error('[admin/users] updateUserById (role) failed:', metaErr.message)
      return NextResponse.json({ error: 'Failed to update role.' }, { status: 500 })
    }

    // Sync profiles.role so the display table stays consistent
    const { error: profileErr } = await db
      .from('profiles')
      .update({ role: body.role as UserRole })
      .eq('id', targetId)

    if (profileErr) {
      console.error('[admin/users] profiles.role sync failed:', profileErr.message)
      // Non-fatal — app_metadata is the authoritative source; profiles is display only
    }

    updates.role = body.role
  }

  // ── Ban / unban ────────────────────────────────────────────────────────────
  if (body.banned !== undefined) {
    if (targetId === caller.id) {
      return NextResponse.json({ error: 'You cannot ban yourself.' }, { status: 400 })
    }
    const banDuration = body.banned ? '876600h' : 'none' // ~100 years = effectively permanent
    const { error: banErr } = await db.auth.admin.updateUserById(targetId, {
      ban_duration: banDuration,
    })
    if (banErr) {
      console.error('[admin/users] updateUserById (ban) failed:', banErr.message)
      return NextResponse.json({ error: 'Failed to update ban status.' }, { status: 500 })
    }
    updates.banned = body.banned
  }

  return NextResponse.json({ updated: updates })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller
  try {
    caller = await requireAdmin(req)
  } catch (res) {
    return res as NextResponse
  }

  const { id: targetId } = await params

  if (targetId === caller.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 })
  }

  const db = createServerClient()
  const { error } = await db.auth.admin.deleteUser(targetId)

  if (error) {
    console.error('[admin/users] deleteUser failed:', error.message)
    return NextResponse.json({ error: 'Failed to delete user.' }, { status: 500 })
  }

  return NextResponse.json({ deleted: targetId })
}
