'use client'

import type { CSSProperties } from 'react'
import { useState, useEffect, useRef } from 'react'
import { ensureAnonymousSession } from '@/lib/supabase/auth'
import { browserClient } from '@/lib/supabase/browser'
import type { ChatMessage, Citation } from '@/types/database'

interface Props {
  meetingId: string | null
  initialSessionId?: string | null
  onCitationClick?: (citation: Citation) => void
}

export default function ChatPanel({
  meetingId,
  initialSessionId = null,
  onCitationClick,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load existing messages when a session is resumed
  useEffect(() => {
    if (!sessionId) return
    async function loadHistory() {
      const { data } = await browserClient
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId!)
        .order('created_at', { ascending: true })
      if (data) setMessages(data as ChatMessage[])
    }
    void loadHistory()
  }, [sessionId])

  // Keep the latest message visible
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    if (!input.trim() || loading) return
    const text = input.trim()
    setInput('')
    setError(null)
    setLoading(true)

    // Optimistic user message so the UI feels instant
    const optimisticId = `opt-${Date.now()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      session_id: sessionId ?? '',
      role: 'user',
      content: text,
      citations: [],
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const token = await ensureAnonymousSession()
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text, meetingId, sessionId }),
      })

      const body = (await res.json()) as {
        sessionId?: string
        message?: ChatMessage
        error?: string
      }

      if (!res.ok) throw new Error(body.error ?? 'Chat request failed.')

      if (body.sessionId) setSessionId(body.sessionId)
      if (body.message) setMessages((prev) => [...prev, body.message!])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      // Roll back the optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
    } finally {
      setLoading(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div style={S.panel}>
      <div style={S.thread}>
        {messages.length === 0 && !loading && (
          <div style={S.emptyHint}>
            {meetingId
              ? 'Ask anything about this meeting transcript.'
              : 'Ask anything about your meetings.'}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onCitationClick={onCitationClick}
          />
        ))}

        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                ...S.bubble,
                ...S.assistant,
                color: '#999',
                fontStyle: 'italic',
              }}
            >
              Thinking…
            </div>
          </div>
        )}

        {error && <div style={S.errMsg}>✗ {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={S.inputRow}>
        <textarea
          style={S.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={loading}
        />
        <button
          style={{
            ...S.sendBtn,
            opacity: loading || !input.trim() ? 0.5 : 1,
            cursor: loading || !input.trim() ? 'default' : 'pointer',
          }}
          onClick={() => void send()}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessageBubble
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const m = Math.floor(totalSecs / 60).toString().padStart(2, '0')
  const s = (totalSecs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessage
  onCitationClick?: (c: Citation) => void
}) {
  const isUser = message.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div style={{ ...S.bubble, ...(isUser ? S.userBubble : S.assistant) }}>
        {message.content}
      </div>

      {!isUser && message.citations.length > 0 && (
        <div style={S.citationRow}>
          <span style={{ fontSize: 11, color: '#aaa', alignSelf: 'center' }}>
            Sources:
          </span>
          {message.citations.map((c, i) => (
            <button
              key={i}
              style={S.citationChip}
              title={`Jump to ${formatMs(c.start_ms)}`}
              onClick={() => onCitationClick?.(c)}
            >
              {formatMs(c.start_ms)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S: Record<string, CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: 420,
    fontFamily: 'system-ui, sans-serif',
  },
  thread: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 0 8px',
    display: 'flex',
    flexDirection: 'column',
  },
  emptyHint: {
    color: '#aaa',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 48,
  },
  bubble: {
    maxWidth: '82%',
    padding: '9px 13px',
    borderRadius: 12,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 14,
  },
  userBubble: {
    background: '#0066cc',
    color: '#fff',
    borderBottomRightRadius: 3,
  },
  assistant: {
    background: '#f2f2f2',
    color: '#111',
    borderBottomLeftRadius: 3,
  },
  citationRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
    paddingLeft: 2,
  },
  citationChip: {
    fontSize: 11,
    fontFamily: 'monospace',
    padding: '2px 7px',
    borderRadius: 4,
    border: '1px solid #d0d0d0',
    background: '#fff',
    color: '#0066cc',
    cursor: 'pointer',
    lineHeight: 1.5,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-end',
    paddingTop: 10,
    borderTop: '1px solid #e8e8e8',
  },
  textarea: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #d8d8d8',
    borderRadius: 8,
    resize: 'none',
    fontSize: 14,
    fontFamily: 'system-ui, sans-serif',
    lineHeight: 1.5,
    outline: 'none',
  },
  sendBtn: {
    padding: '9px 18px',
    background: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  errMsg: {
    color: '#b00020',
    fontSize: 13,
    padding: '4px 4px',
    marginTop: 4,
  },
}
