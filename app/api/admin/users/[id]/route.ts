// DELETE /api/admin/users/[id]
//
// Permanently deletes a user. Steps:
//   1. Verify caller is admin.
//   2. Self-delete and last-admin guards.
//   3. Collect audio_path values from all of the target's meetings.
//   4. Delete those Storage objects (service role). Failures are logged +
//      returned as warnings; they do NOT abort the user delete.
//   5. auth.admin.deleteUser() — CASCADE on auth.users removes profiles and
//      meetings (and all their children: transcript_segments, transcript_chunks,
//      todos, calendar_suggestions, chat_sessions, chat_messages).
//
// GUARDS:
//   - Cannot delete your own account.
//   - Cannot delete the last remaining admin.
//
// SECURITY: requires admin role on caller (server-side).
// SECURITY: service role key stays server-only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/server'
import { guardDelete } from '@/lib/admin/guards'

const BUCKET = 'recordings'

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
  const db = createServerClient()

  // Fetch target role for guard evaluation
  const { data: targetProfile } = await db
    .from('profiles')
    .select('role')
    .eq('id', targetId)
    .maybeSingle()

  if (!targetProfile) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  }

  // Count all admins for last-admin guard
  const { count: adminCount } = await db
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'admin')

  const guard = guardDelete(caller.id, targetId, targetProfile.role, adminCount ?? 0)
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: guard.status })
  }

  // Collect audio paths from all of the target's meetings before deleting
  const { data: meetings } = await db
    .from('meetings')
    .select('audio_path')
    .eq('user_id', targetId)

  const audioPaths = (meetings ?? [])
    .map((m) => m.audio_path)
    .filter((p): p is string => typeof p === 'string')

  // Delete Storage objects. Failure here is non-fatal — log + warn but proceed.
  const storageWarnings: string[] = []
  if (audioPaths.length > 0) {
    const { error: storageErr } = await db.storage.from(BUCKET).remove(audioPaths)
    if (storageErr) {
      const msg = `Audio storage cleanup failed (${audioPaths.length} file(s)): ${storageErr.message}`
      console.warn('[admin/delete] ' + msg)
      storageWarnings.push(msg)
    }
  }

  // Delete the user — CASCADE handles profiles, meetings, and all child rows
  const { error: deleteErr } = await db.auth.admin.deleteUser(targetId)
  if (deleteErr) {
    console.error('[admin/delete] deleteUser failed:', deleteErr.message)
    return NextResponse.json({ error: 'Failed to delete user.' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    deleted: targetId,
    ...(storageWarnings.length > 0 ? { storageWarnings } : {}),
  })
}
