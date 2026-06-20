// GET /api/audio-url/[id]   ([id] = meetingId)
//
// Returns a short-lived Supabase Storage signed URL for streaming the meeting's
// audio recording. The recordings bucket is private — this route is the ONLY
// authorised way the browser gets a playback URL. Never expose permanent URLs.
//
// Signed URLs expire after SIGNED_URL_EXPIRY_SECS. If the meeting has no
// audio_path (e.g. deleted to save storage quota), returns 404.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createSignedDownloadUrl } from '@/lib/storage'
import type { Database } from '@/types/database'

const SIGNED_URL_EXPIRY_SECS = 3_600 // 1 hour

async function requireUser(req: NextRequest): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })

  const {
    data: { user },
    error,
  } = await createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.getUser()

  if (error || !user) throw NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
  return user.id
}

export async function GET(
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
  const { data: meeting } = await db
    .from('meetings')
    .select('id, user_id, audio_path, storage_provider')
    .eq('id', meetingId)
    .maybeSingle()

  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  if (meeting.user_id !== userId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  if (!meeting.audio_path) return NextResponse.json({ error: 'No audio for this meeting.' }, { status: 404 })

  let signedUrl: string
  try {
    signedUrl = await createSignedDownloadUrl({
      key: meeting.audio_path,
      provider: meeting.storage_provider,
      expiresIn: SIGNED_URL_EXPIRY_SECS,
    })
  } catch (err) {
    console.error('[audio-url] createSignedDownloadUrl failed:', err)
    return NextResponse.json({ error: 'Failed to create signed URL.' }, { status: 500 })
  }

  return NextResponse.json({ url: signedUrl })
}
