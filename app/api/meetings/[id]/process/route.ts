// POST /api/meetings/:id/process
//
// Fire-and-forget trigger for the processing pipeline. Returns 202 immediately;
// processMeeting() runs in the background and updates meetings.status as it goes.
//
// The meeting must belong to the authenticated user. Processing is idempotent:
// if the meeting is already processing or done, processMeeting() is a no-op.
//
// Use this endpoint to:
//   • trigger processing after confirming an upload (called by /uploaded route)
//   • manually re-run a failed meeting

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { processMeeting } from '@/lib/pipeline/processMeeting'
import type { Database } from '@/types/database'

async function requireUser(req: NextRequest): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })

  const { data: { user }, error } = await createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.getUser()

  if (error || !user) throw NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
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
  const db = createServerClient()

  // Verify ownership (service role can see all rows; we check user_id explicitly)
  const { data: meeting } = await db
    .from('meetings')
    .select('id, user_id, status')
    .eq('id', meetingId)
    .maybeSingle()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  if (meeting.user_id !== userId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  // Fire and forget — processMeeting handles its own error/status updates.
  // This works on a persistent self-hosted Next.js server (npm start).
  // If the server restarts mid-job, the meeting stays in 'processing'; re-POST
  // this endpoint to recover (processMeeting allows restart from 'failed').
  void processMeeting(meetingId).catch((err: unknown) => {
    console.error('[process route] unhandled pipeline error:', err)
  })

  return NextResponse.json({ ok: true, meetingId, status: 'processing' }, { status: 202 })
}
