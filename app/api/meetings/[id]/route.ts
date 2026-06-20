// PATCH /api/meetings/[id] — rename a meeting.
// DELETE /api/meetings/[id] — delete meeting row + audio from Supabase Storage.
//
// PATCH body: { title: string }
//   title is trimmed; must be non-empty, max 200 characters.
//
// DELETE: removes the audio object from Supabase Storage at meetings.audio_path
//   (if set) before deleting the row. On Storage delete failure the error is
//   logged and a warning is returned but the row delete still proceeds — we
//   must not leave the DB in a half-state. ON DELETE CASCADE handles all child
//   rows (transcript_segments, transcript_chunks, todos, calendar_suggestions,
//   chat_sessions/chat_messages).
//
// SECURITY: ownership verified server-side; service-role key stays server-only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/server'
import { deleteObject } from '@/lib/storage'

const MAX_TITLE_LEN = 200

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller
  try {
    caller = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  const { id: meetingId } = await params

  let body: { title?: unknown }
  try {
    body = (await req.json()) as { title?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (typeof body.title !== 'string') {
    return NextResponse.json({ error: 'title must be a string.' }, { status: 422 })
  }
  const title = body.title.trim()
  if (!title) {
    return NextResponse.json({ error: 'title must not be empty.' }, { status: 422 })
  }
  if (title.length > MAX_TITLE_LEN) {
    return NextResponse.json(
      { error: `title must be ${MAX_TITLE_LEN} characters or fewer.` },
      { status: 422 },
    )
  }

  const db = createServerClient()

  const { data: meeting } = await db
    .from('meetings')
    .select('id, user_id')
    .eq('id', meetingId)
    .maybeSingle()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  if (meeting.user_id !== caller.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const { error: updateErr } = await db
    .from('meetings')
    .update({ title })
    .eq('id', meetingId)

  if (updateErr) {
    console.error('[meetings] rename failed:', updateErr.message)
    return NextResponse.json({ error: 'Failed to update meeting.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, title })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let caller
  try {
    caller = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  const { id: meetingId } = await params
  const db = createServerClient()

  const { data: meeting } = await db
    .from('meetings')
    .select('id, user_id, audio_path, storage_provider')
    .eq('id', meetingId)
    .maybeSingle()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  if (meeting.user_id !== caller.id) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  // Delete audio from storage first. Failure here is non-fatal: we log a warning
  // and surface it to the caller, but we still proceed with the row delete so the
  // DB never ends up in a half-state. An orphaned storage object can be cleaned up
  // manually; an orphaned DB row is much harder to deal with.
  let storageWarning: string | null = null
  if (meeting.audio_path) {
    try {
      await deleteObject({ key: meeting.audio_path, provider: meeting.storage_provider })
    } catch (storageErr) {
      console.warn(
        '[meetings] storage delete failed (proceeding with row delete):',
        storageErr,
      )
      storageWarning = 'Audio file could not be removed from storage.'
    }
  }

  // Row delete — cascade removes transcript_segments, transcript_chunks, todos,
  // calendar_suggestions, and chat_sessions (+ chat_messages via sessions).
  const { error: deleteErr } = await db.from('meetings').delete().eq('id', meetingId)
  if (deleteErr) {
    console.error('[meetings] row delete failed:', deleteErr.message)
    return NextResponse.json({ error: 'Failed to delete meeting.' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    ...(storageWarning ? { warning: storageWarning } : {}),
  })
}
