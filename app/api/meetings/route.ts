// POST /api/meetings
// Creates a meetings row and returns a signed upload URL for direct browser→Storage upload.
// Uses the service role key (bypasses RLS) so the pipeline can write regardless of session.
// The caller's JWT is verified via the anon-key client to identify the user.

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const BUCKET = 'recordings'

/** Verify the JWT and return the user_id, or throw a 401 response. */
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

  // Use the caller's JWT so Supabase validates it against the real session
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

export async function POST(req: NextRequest) {
  let userId: string
  try {
    userId = await requireUser(req)
  } catch (res) {
    return res as NextResponse
  }

  let body: { durationSeconds?: number; startedAt?: string }
  try {
    body = (await req.json()) as { durationSeconds?: number; startedAt?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const serverClient = createServerClient()

  // Verify the bucket exists — fail with a clear message if not
  const { data: bucket, error: bucketError } = await serverClient.storage.getBucket(BUCKET)
  if (bucketError || !bucket) {
    console.error('[meetings] bucket check failed:', bucketError?.message)
    return NextResponse.json(
      {
        error:
          'Storage bucket "recordings" not found. ' +
          'Create a PRIVATE bucket named "recordings" in the Supabase dashboard → Storage.',
      },
      { status: 503 },
    )
  }

  // Generate the meeting ID server-side so we can build the audio path before insert
  const meetingId = randomUUID()
  const audioPath = `${userId}/${meetingId}.webm`

  const title = formatMeetingTitle(body.startedAt)
  const startedAt = body.startedAt ?? new Date().toISOString()

  const { error: insertError } = await serverClient.from('meetings').insert({
    id: meetingId,
    user_id: userId,
    title,
    status: 'pending',
    audio_path: audioPath,
    duration_seconds: body.durationSeconds ?? null,
    started_at: startedAt,
  })

  if (insertError) {
    console.error('[meetings] insert failed:', insertError.message)
    return NextResponse.json({ error: 'Failed to create meeting record.' }, { status: 500 })
  }

  // Generate the signed upload URL — the browser uses this token to push the file
  // directly to Supabase Storage without routing through our server.
  const { data: signedData, error: signedError } = await serverClient.storage
    .from(BUCKET)
    .createSignedUploadUrl(audioPath)

  if (signedError || !signedData) {
    console.error('[meetings] createSignedUploadUrl failed:', signedError?.message)
    // Roll back the meeting row so we don't have orphaned pending rows
    await serverClient.from('meetings').delete().eq('id', meetingId)
    return NextResponse.json({ error: 'Failed to create upload URL.' }, { status: 500 })
  }

  return NextResponse.json({
    meetingId,
    path: signedData.path,
    token: signedData.token,
  })
}

function formatMeetingTitle(isoDate?: string): string {
  const d = isoDate ? new Date(isoDate) : new Date()
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}
