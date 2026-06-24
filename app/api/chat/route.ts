// POST /api/chat
//
// Full RAG chatbot pipeline:
//   authenticate → resolve/create session → persist user message → retrieve
//   transcript context (RLS-scoped) → generate grounded answer → persist
//   assistant message with citations → return { sessionId, message }
//
// Access: viewer+ for meeting access (shared-folder members may use RAG chat).
// Each user gets their own chat_session row even for shared meetings.
// Retrieval uses the user-scoped client (anon key + JWT) so RLS on
// transcript_chunks enforces shared-folder access automatically.

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createUserClient } from '@/lib/supabase/user-client'
import { retrieveContext } from '@/lib/rag/retrieve'
import { answerWithContext } from '@/lib/gemini/answer'
import { checkMeetingAccess } from '@/lib/access'
import { logActivity } from '@/lib/activity/logActivity'
import { applyQuotaMovement } from '@/lib/quota/applyQuotaMovement'
import { logger } from '@/lib/logger'
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
// Access: viewer+ on the meeting.
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

  // Viewer+ access required to read chat history for a meeting
  const { data: meeting } = await db
    .from('meetings')
    .select('id, user_id, folder_id')
    .eq('id', meetingId)
    .maybeSingle()
  if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
  if (!(await checkMeetingAccess(db, meeting, userId, 'viewer'))) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  // Most recent session for THIS user + meeting (each user has their own session)
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

  // Stable ID for this user message — used as the quota dedup key so that
  // charge and refund are idempotent even if the request is retried.
  const userMsgId = randomUUID()

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

  const db = createServerClient() // service role for writes and access checks

  // Verify viewer+ access to the meeting if meetingId is provided
  if (meetingId) {
    const { data: meeting } = await db
      .from('meetings')
      .select('id, user_id, folder_id')
      .eq('id', meetingId)
      .maybeSingle()
    if (!meeting) return NextResponse.json({ error: 'Meeting not found.' }, { status: 404 })
    if (!(await checkMeetingAccess(db, meeting, userId, 'viewer'))) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }
  }

  // Resolve or create chat session (each user owns their own session row)
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

  // Persist user message — explicit id so the quota dedup key is pre-known
  const { error: userMsgErr } = await db.from('chat_messages').insert({
    id: userMsgId,
    session_id: resolvedSessionId,
    role: 'user',
    content: message,
    citations: [],
  })
  if (userMsgErr)
    return NextResponse.json({ error: 'Failed to save message.' }, { status: 500 })

  logActivity({ userId, eventType: 'chat_message', meetingId, metadata: { sessionId: resolvedSessionId } })

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

  // ── QUO-03: Agent-query quota gate ───────────────────────────────────────
  // Runs after the access check and after the user message is persisted.
  // Deduped by userMsgId so a retried request never double-charges.
  const quotaCharge = await applyQuotaMovement({
    userId,
    deltaAudioSeconds: 0,
    deltaAgentQueries: -1,
    reason: 'agent_query',
    dedupKey: `agent:${userMsgId}:charge`,
    allowOverdraw: false,
    meetingId,
    metadata: { session_id: resolvedSessionId },
  })
  if (quotaCharge.status === 'insufficient') {
    return NextResponse.json(
      {
        blocked: true,
        reason: 'insufficient_agent_balance',
        remaining_queries: quotaCharge.agentRemaining,
      },
      { status: 402 },
    )
  }

  // Retrieve context using the user-scoped client so RLS applies.
  // After migration 012, transcript_chunks SELECT policy includes shared-folder
  // members, so viewers of shared meetings can use RAG automatically.
  const userClient = createUserClient(jwt)
  const usageCtx = { meetingId, userId }
  let chunks: Awaited<ReturnType<typeof retrieveContext>>
  try {
    chunks = await retrieveContext({ query: message, userClient, meetingId, userId })
  } catch (err) {
    logger.error('[chat] retrieval error', { detail: String(err) })
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
      // Technical failure — refund the 1 agent query so the user isn't charged.
      // Uses a distinct dedup key so repeated failures never double-refund.
      await applyQuotaMovement({
        userId,
        deltaAudioSeconds: 0,
        deltaAgentQueries: +1,
        reason: 'refund',
        dedupKey: `agent:${userMsgId}:refund`,
        allowOverdraw: false,
        meetingId,
        metadata: { reason: 'answer_generation_failed', session_id: resolvedSessionId },
      }).catch((e: unknown) => logger.error('[chat] quota refund failed (non-fatal)', { detail: String(e) }))

      logger.error('[chat] answer generation error', { detail: String(err) })
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
