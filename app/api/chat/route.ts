// POST /api/chat
//
// Full RAG chatbot pipeline:
//   authenticate → resolve/create session → persist user message → retrieve
//   transcript context (RLS-scoped) → generate grounded answer → persist
//   assistant message with citations → return { sessionId, message }
//
// Retrieval uses the user-scoped client (anon key + JWT) so RLS on
// transcript_chunks ensures a user can only see their own meetings' data.
// Writes use the service-role client (no RLS) for background-safe persistence.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createUserClient } from '@/lib/supabase/user-client'
import { retrieveContext } from '@/lib/rag/retrieve'
import { answerWithContext } from '@/lib/gemini/answer'
import type { HistoryMessage } from '@/lib/gemini/answer'
import type { Database } from '@/types/database'

const NO_CONTEXT_REPLY =
  "I couldn't find relevant information in the meeting transcript to answer that question. " +
  'Try rephrasing, or check that the meeting has finished processing.'

// ---------------------------------------------------------------------------
// Auth helper — returns userId AND jwt (needed for user-scoped Supabase client)
// ---------------------------------------------------------------------------

async function authenticateRequest(
  req: NextRequest,
): Promise<{ userId: string; jwt: string }> {
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) throw NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon)
    throw NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })

  const {
    data: { user },
    error,
  } = await createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.getUser()

  if (error || !user)
    throw NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })

  return { userId: user.id, jwt }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /api/chat?meetingId=<id>
// Returns the most recent chat session + all its messages for this meeting.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  let userId: string
  try {
    ;({ userId } = await authenticateRequest(req))
  } catch (res) {
    return res as NextResponse
  }

  const meetingId = new URL(req.url).searchParams.get('meetingId')
  if (!meetingId) return NextResponse.json({ error: 'meetingId is required.' }, { status: 400 })

  const db = createServerClient()

  // Ownership check
  const { data: meeting } = await db
    .from('meetings')
    .select('id, user_id')
    .eq('id', meetingId)
    .maybeSingle()
  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  if (meeting.user_id !== userId) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  // Most recent session for this user + meeting
  const { data: session } = await db
    .from('chat_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!session) return NextResponse.json({ sessionId: null, messages: [] })

  const { data: messages } = await db
    .from('chat_messages')
    .select('*')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ sessionId: session.id, messages: messages ?? [] })
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let userId: string
  let jwt: string
  try {
    ;({ userId, jwt } = await authenticateRequest(req))
  } catch (res) {
    return res as NextResponse
  }

  // Parse and validate body
  let body: { message?: unknown; meetingId?: unknown; sessionId?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message is required.' }, { status: 400 })

  const meetingId = typeof body.meetingId === 'string' ? body.meetingId : null
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null

  const db = createServerClient() // service role for writes and ownership checks

  // Verify meeting ownership if meetingId is provided
  if (meetingId) {
    const { data: meeting } = await db
      .from('meetings')
      .select('id, user_id')
      .eq('id', meetingId)
      .maybeSingle()
    if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
    if (meeting.user_id !== userId)
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // Resolve or create chat session
  let resolvedSessionId: string
  if (!sessionId) {
    const { data: session, error: sessionErr } = await db
      .from('chat_sessions')
      .insert({ user_id: userId, meeting_id: meetingId })
      .select('id')
      .single()
    if (sessionErr || !session)
      return NextResponse.json({ error: 'Could not create chat session.' }, { status: 500 })
    resolvedSessionId = session.id
  } else {
    const { data: session } = await db
      .from('chat_sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .maybeSingle()
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    if (session.user_id !== userId)
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    resolvedSessionId = session.id
  }

  // Persist user message
  const { error: userMsgErr } = await db.from('chat_messages').insert({
    session_id: resolvedSessionId,
    role: 'user',
    content: message,
    citations: [],
  })
  if (userMsgErr)
    return NextResponse.json({ error: 'Failed to save message.' }, { status: 500 })

  // Load recent history (last 4 messages before the one we just inserted)
  const { data: historyRows } = await db
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', resolvedSessionId)
    .order('created_at', { ascending: false })
    .limit(5)

  const history: HistoryMessage[] = (historyRows ?? [])
    .slice(1) // drop the user message we just inserted (it's first in DESC order)
    .reverse() // restore chronological order
    .map((r) => ({ role: r.role, content: r.content }))

  // Retrieve context using the user-scoped client so RLS applies
  const userClient = createUserClient(jwt)
  const usageCtx = { meetingId, userId }
  let chunks: Awaited<ReturnType<typeof retrieveContext>>
  try {
    chunks = await retrieveContext({ query: message, userClient, meetingId, userId })
  } catch (err) {
    console.error('[chat] retrieval error:', err)
    chunks = []
  }

  // Generate answer — skip Gemini call if no relevant context found
  let answer: string
  let citations: Awaited<ReturnType<typeof answerWithContext>>['citations'] = []

  if (chunks.length === 0) {
    answer = NO_CONTEXT_REPLY
  } else {
    try {
      const result = await answerWithContext({ question: message, chunks, history, ctx: usageCtx })
      answer = result.answer
      citations = result.citations
    } catch (err) {
      console.error('[chat] answer generation error:', err)
      answer = 'I encountered an error while generating an answer. Please try again.'
    }
  }

  // Persist assistant message
  const { data: assistantMsg, error: assistantMsgErr } = await db
    .from('chat_messages')
    .insert({
      session_id: resolvedSessionId,
      role: 'assistant',
      content: answer,
      citations,
    })
    .select('*')
    .single()

  if (assistantMsgErr || !assistantMsg)
    return NextResponse.json({ error: 'Failed to save assistant message.' }, { status: 500 })

  return NextResponse.json({ sessionId: resolvedSessionId, message: assistantMsg })
}
