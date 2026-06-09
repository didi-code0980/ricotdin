// POST /api/meetings/:id/uploaded
// Called by the client after a successful direct upload to Supabase Storage.
// Confirms the file landed (optional storage check) and keeps status='pending'
// so the Phase 3 pipeline can pick it up.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { processMeeting } from '@/lib/pipeline/processMeeting'
import type { Database } from '@/types/database'

const BUCKET = 'recordings'

async function requireUser(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    throw NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })
  }

  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser()
  if (error || !user) {
    throw NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
  }
  return user.id
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string
  try {
    userId = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  const { id: meetingId } = await params

  const serverClient = createServerClient()

  // Verify the meeting belongs to this user
  const { data: meeting, error: fetchError } = await serverClient
    .from('meetings')
    .select('id, audio_path, user_id')
    .eq('id', meetingId)
    .single()

  if (fetchError || !meeting) {
    return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  }

  if (meeting.user_id !== userId) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // Optionally verify the file actually exists in Storage
  if (meeting.audio_path) {
    const { data: files, error: listError } = await serverClient.storage
      .from(BUCKET)
      .list(meeting.audio_path.split('/').slice(0, -1).join('/'), {
        search: meeting.audio_path.split('/').at(-1),
        limit: 1,
      })

    if (listError) {
      console.warn('[uploaded] storage list error (non-fatal):', listError.message)
    } else if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'File not found in storage — upload may have failed.' },
        { status: 422 },
      )
    }
  }

  // Auto-trigger the processing pipeline (fire and forget).
  // processMeeting() is idempotent — if already processing/done it exits early.
  void processMeeting(meetingId).catch((err: unknown) => {
    console.error('[uploaded] processMeeting fire-and-forget error:', err)
  })

  return NextResponse.json({ ok: true, meetingId })
}
