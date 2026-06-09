'use client'

import type { CSSProperties, RefObject } from 'react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import { browserClient } from '@/lib/supabase/browser'
import { ensureAnonymousSession } from '@/lib/supabase/auth'
import type {
  Meeting,
  MeetingStatus,
  TranscriptSegment,
  Todo,
  TodoStatus,
  CalendarSuggestion,
} from '@/types/database'

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_MS = 3_000
const IN_FLIGHT: MeetingStatus[] = ['pending', 'processing']

// ── State machine ─────────────────────────────────────────────────────────────

type PageData =
  | { tag: 'loading' }
  | { tag: 'not-found' }
  | { tag: 'error'; message: string }
  | { tag: 'inflight'; meeting: Meeting }
  | { tag: 'failed'; meeting: Meeting }
  | {
      tag: 'done'
      meeting: Meeting
      segments: TranscriptSegment[]
      todos: Todo[]
      calSugs: CalendarSuggestion[]
    }

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const m = Math.floor(totalSecs / 60).toString().padStart(2, '0')
  const s = (totalSecs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatProposedAt(iso: string | null): string {
  if (!iso) return 'No time specified'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

// ── Page component ────────────────────────────────────────────────────────────

export default function MeetingDetailPage() {
  const params = useParams()
  const meetingId = typeof params.id === 'string' ? params.id : ''

  const [data, setData] = useState<PageData>({ tag: 'loading' })
  const [todoStatuses, setTodoStatuses] = useState<Record<string, TodoStatus>>({})
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [highlightedSegIndex, setHighlightedSegIndex] = useState<number | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const audioRef = useRef<HTMLAudioElement>(null)

  // Derived: stable reference to audio_path for useEffect dep comparison
  const audioPath = data.tag === 'done' ? data.meeting.audio_path : null

  // ── Data loading with polling ───────────────────────────────────────────────

  useEffect(() => {
    if (!meetingId) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    async function load(silent = false) {
      try {
        if (!silent) await ensureAnonymousSession()

        const { data: meeting, error: meetErr } = await browserClient
          .from('meetings')
          .select('*')
          .eq('id', meetingId)
          .maybeSingle()

        if (cancelled) return

        if (meetErr) {
          setData({ tag: 'error', message: meetErr.message })
          return
        }
        if (!meeting) {
          setData({ tag: 'not-found' })
          return
        }

        if (IN_FLIGHT.includes(meeting.status)) {
          setData({ tag: 'inflight', meeting })
          timers.push(setTimeout(() => void load(true), POLL_MS))
          return
        }

        if (meeting.status === 'failed') {
          setData({ tag: 'failed', meeting })
          return
        }

        // status === 'done' — fetch all related data in parallel
        const [segR, todoR, calR] = await Promise.all([
          browserClient
            .from('transcript_segments')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('segment_index'),
          browserClient
            .from('todos')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('created_at'),
          browserClient
            .from('calendar_suggestions')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('created_at'),
        ])

        if (cancelled) return

        const segments = (segR.data ?? []) as TranscriptSegment[]
        const todos = (todoR.data ?? []) as Todo[]
        const calSugs = (calR.data ?? []) as CalendarSuggestion[]

        setTodoStatuses(Object.fromEntries(todos.map((t) => [t.id, t.status])))
        setDismissedIds(new Set(calSugs.filter((c) => c.dismissed).map((c) => c.id)))
        setData({ tag: 'done', meeting, segments, todos, calSugs })
      } catch (err) {
        if (cancelled) return
        setData({
          tag: 'error',
          message: err instanceof Error ? err.message : 'Failed to load meeting.',
        })
      }
    }

    void load()
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [meetingId, reloadKey])

  // ── Audio signed URL ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!audioPath || !meetingId) {
      setAudioUrl(null)
      return
    }
    let cancelled = false

    async function fetchUrl() {
      try {
        const token = await ensureAnonymousSession()
        const res = await fetch(`/api/audio-url/${meetingId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const body = (await res.json()) as { url?: string }
        if (!cancelled && body.url) setAudioUrl(body.url)
      } catch {
        // Non-fatal — player stays hidden gracefully
      }
    }

    void fetchUrl()
    return () => {
      cancelled = true
    }
  }, [audioPath, meetingId])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function seekTo(ms: number) {
    if (!audioRef.current) return
    audioRef.current.currentTime = ms / 1000
    audioRef.current.play().catch(() => undefined) // autoplay policy may block this
  }

  function scrollToSegment(segmentId: string | null, segments: TranscriptSegment[]) {
    if (!segmentId) return
    const seg = segments.find((s) => s.id === segmentId)
    if (!seg) return
    setHighlightedSegIndex(seg.segment_index)
    document
      .getElementById(`seg-${seg.segment_index}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setHighlightedSegIndex(null), 2_000)
  }

  async function toggleTodo(todoId: string, current: TodoStatus) {
    const next: TodoStatus = current === 'done' ? 'open' : 'done'
    setTodoStatuses((prev) => ({ ...prev, [todoId]: next }))
    try {
      const token = await ensureAnonymousSession()
      const res = await fetch(`/api/todos/${todoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error('update failed')
    } catch {
      setTodoStatuses((prev) => ({ ...prev, [todoId]: current }))
    }
  }

  async function dismissCalSug(suggestionId: string) {
    setDismissedIds((prev) => new Set([...prev, suggestionId]))
    try {
      const token = await ensureAnonymousSession()
      const res = await fetch(`/api/calendar-suggestions/${suggestionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dismissed: true }),
      })
      if (!res.ok) throw new Error('dismiss failed')
    } catch {
      setDismissedIds((prev) => {
        const s = new Set(prev)
        s.delete(suggestionId)
        return s
      })
    }
  }

  async function rerunProcessing() {
    setRerunning(true)
    try {
      const token = await ensureAnonymousSession()
      const res = await fetch(`/api/meetings/${meetingId}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setData((prev) =>
          prev.tag === 'failed'
            ? { tag: 'inflight', meeting: { ...prev.meeting, status: 'processing' } }
            : prev,
        )
        setReloadKey((k) => k + 1)
      }
    } catch {
      // Ignore — user can click the button again
    } finally {
      setRerunning(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.55; } }
        .md-body p { margin: 0 0 0.75em; }
        .md-body h1,.md-body h2,.md-body h3 { margin: 1em 0 0.4em; font-weight: 700; color: #111; }
        .md-body h1 { font-size: 1.05em; }
        .md-body h2 { font-size: 1em; }
        .md-body h3 { font-size: 0.95em; color: #333; }
        .md-body ul,.md-body ol { margin: 0 0 0.75em; padding-left: 1.4em; }
        .md-body li { margin-bottom: 0.25em; }
        .md-body strong { font-weight: 700; }
        .md-body em { font-style: italic; }
        .md-body code { background:#f5f5f5; padding:1px 5px; border-radius:3px; font-size:92%; font-family:monospace; }
        .md-body pre { background:#f5f5f5; padding:12px; border-radius:6px; overflow:auto; margin:0 0 0.75em; }
        .md-body pre code { background:none; padding:0; }
        .md-body blockquote { margin:0 0 0.75em; padding-left:1em; border-left:3px solid #ddd; color:#555; }
        .todo-row:last-child,.cal-row:last-child { border-bottom:none; }
      `}</style>

      <main style={S.main}>
        <Link href="/meetings" style={S.back}>← All meetings</Link>

        {data.tag === 'loading' && <SkeletonLoader />}
        {data.tag === 'not-found' && <NotFoundView />}
        {data.tag === 'error' && <ErrorView message={data.message} />}
        {data.tag === 'inflight' && <ProcessingView meeting={data.meeting} />}
        {data.tag === 'failed' && (
          <FailedView meeting={data.meeting} rerunning={rerunning} onRerun={rerunProcessing} />
        )}
        {data.tag === 'done' && (
          <DoneView
            meeting={data.meeting}
            segments={data.segments}
            todos={data.todos}
            calSugs={data.calSugs}
            todoStatuses={todoStatuses}
            dismissedIds={dismissedIds}
            audioUrl={audioUrl}
            audioRef={audioRef}
            highlightedSegIndex={highlightedSegIndex}
            onToggleTodo={toggleTodo}
            onDismissCalSug={dismissCalSug}
            onSeekTo={seekTo}
            onScrollToSegment={(segId) => scrollToSegment(segId, data.segments)}
          />
        )}
      </main>
    </>
  )
}

// ── Loading / error views ─────────────────────────────────────────────────────

function SkeletonLoader() {
  const bar = (w: string, h: number, mb = 12): CSSProperties => ({
    width: w,
    height: h,
    marginBottom: mb,
    borderRadius: 6,
    background: '#ebebeb',
    animation: 'pulse 1.4s ease-in-out infinite',
  })
  return (
    <div style={{ marginTop: 24 }}>
      <div style={bar('58%', 30, 10)} />
      <div style={bar('38%', 16, 32)} />
      <div style={bar('100%', 70, 14)} />
      <div style={bar('100%', 130, 14)} />
      <div style={bar('100%', 200)} />
    </div>
  )
}

function NotFoundView() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 0', color: '#555' }}>
      <p style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Meeting not found</p>
      <p style={{ fontSize: 14, color: '#999', margin: '0 0 24px' }}>
        This meeting may have been deleted or you don&apos;t have access to it.
      </p>
      <Link href="/meetings" style={S.btnPrimary}>← Back to meetings</Link>
    </div>
  )
}

function ErrorView({ message }: { message: string }) {
  return <div style={{ ...S.errBox, marginTop: 24 }}>✗ {message}</div>
}

function ProcessingView({ meeting }: { meeting: Meeting }) {
  return (
    <div>
      <MeetingHeaderBase meeting={meeting} />
      <div style={{ ...S.card, textAlign: 'center', padding: '2.5rem 1.5rem' }}>
        <div style={S.spinner} />
        <p style={{ fontSize: 15, fontWeight: 600, margin: '16px 0 6px' }}>
          {meeting.status === 'pending' ? 'Queued for processing…' : 'Processing recording…'}
        </p>
        <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
          Transcribing audio and extracting notes — typically 30–90 seconds.
        </p>
      </div>
    </div>
  )
}

function FailedView({
  meeting,
  rerunning,
  onRerun,
}: {
  meeting: Meeting
  rerunning: boolean
  onRerun: () => void
}) {
  return (
    <div>
      <MeetingHeaderBase meeting={meeting} />
      <div style={{ ...S.errBox, marginTop: 16 }}>
        <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Processing failed</p>
        {meeting.error_message && (
          <p style={{ margin: '0 0 16px', fontSize: 13, opacity: 0.9 }}>{meeting.error_message}</p>
        )}
        <button
          style={{
            ...S.btnPrimary,
            opacity: rerunning ? 0.6 : 1,
            cursor: rerunning ? 'default' : 'pointer',
          }}
          disabled={rerunning}
          onClick={onRerun}
        >
          {rerunning ? 'Starting…' : '↻ Re-run processing'}
        </button>
      </div>
    </div>
  )
}

// ── Done view ─────────────────────────────────────────────────────────────────

interface DoneViewProps {
  meeting: Meeting
  segments: TranscriptSegment[]
  todos: Todo[]
  calSugs: CalendarSuggestion[]
  todoStatuses: Record<string, TodoStatus>
  dismissedIds: Set<string>
  audioUrl: string | null
  audioRef: RefObject<HTMLAudioElement | null>
  highlightedSegIndex: number | null
  onToggleTodo: (id: string, current: TodoStatus) => void
  onDismissCalSug: (id: string) => void
  onSeekTo: (ms: number) => void
  onScrollToSegment: (segmentId: string | null) => void
}

function DoneView({
  meeting, segments, todos, calSugs,
  todoStatuses, dismissedIds,
  audioUrl, audioRef, highlightedSegIndex,
  onToggleTodo, onDismissCalSug, onSeekTo, onScrollToSegment,
}: DoneViewProps) {
  const activeSugs = calSugs.filter((c) => !dismissedIds.has(c.id))

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={S.h1}>{meeting.title}</h1>
        <div style={S.metaRow}>
          <span>{formatDate(meeting.created_at)}</span>
          {meeting.duration_seconds != null && (
            <> · <span>{formatDuration(meeting.duration_seconds)}</span></>
          )}
          {meeting.language && <> · <span>{meeting.language.toUpperCase()}</span></>}
          <> · <StatusBadge status={meeting.status} /></>
        </div>
      </div>

      {/* Audio player */}
      {meeting.audio_path && (
        <SectionCard label="Recording">
          {audioUrl ? (
            /* eslint-disable-next-line jsx-a11y/media-has-caption */
            <audio ref={audioRef} controls src={audioUrl} style={{ width: '100%' }} />
          ) : (
            <div style={S.audioSkel}>Loading audio player…</div>
          )}
        </SectionCard>
      )}

      {/* Summary */}
      {meeting.summary && (
        <SectionCard label="Summary">
          <p style={{ margin: 0, lineHeight: 1.7, color: '#222', fontSize: 14 }}>
            {meeting.summary}
          </p>
        </SectionCard>
      )}

      {/* Meeting notes — markdown, rehype-sanitize prevents XSS */}
      {meeting.notes && meeting.notes.trim() && (
        <SectionCard label="Meeting notes">
          <div className="md-body" style={{ fontSize: 14, color: '#222', lineHeight: 1.7 }}>
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{meeting.notes}</ReactMarkdown>
          </div>
        </SectionCard>
      )}

      {/* Action items */}
      <SectionCard label={`Action items${todos.length > 0 ? ` (${todos.length})` : ''}`}>
        {todos.length === 0 ? (
          <p style={S.empty}>No action items were found in this meeting.</p>
        ) : (
          <ul style={S.plainList}>
            {todos.map((todo) => {
              const status = todoStatuses[todo.id] ?? todo.status
              const isDone = status === 'done'
              return (
                <li key={todo.id} className="todo-row" style={S.todoRow}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={isDone}
                      onChange={() => onToggleTodo(todo.id, status)}
                      style={{ marginTop: 3, accentColor: '#1a7f37', flexShrink: 0, cursor: 'pointer' }}
                    />
                    <span style={{ flex: 1 }}>
                      <span style={{ color: isDone ? '#aaa' : '#111', textDecoration: isDone ? 'line-through' : 'none', fontSize: 14, lineHeight: 1.5 }}>
                        {todo.content}
                      </span>
                      {(todo.assignee || todo.due_date) && (
                        <span style={{ display: 'block', fontSize: 12, color: '#777', marginTop: 3 }}>
                          {todo.assignee && <>@{todo.assignee}</>}
                          {todo.assignee && todo.due_date && ' · '}
                          {todo.due_date && <>Due {todo.due_date}</>}
                        </span>
                      )}
                    </span>
                  </label>
                  {todo.source_segment_id && (
                    <button
                      style={S.citationBtn}
                      title="Jump to this moment in the transcript"
                      onClick={() => onScrollToSegment(todo.source_segment_id)}
                    >
                      ↗ source
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>

      {/* Calendar suggestions */}
      {activeSugs.length > 0 && (
        <SectionCard label={`Events mentioned (${activeSugs.length})`}>
          <ul style={S.plainList}>
            {activeSugs.map((sug) => (
              <li key={sug.id} className="cal-row" style={S.calRow}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#111' }}>{sug.title}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#666', marginTop: 3 }}>
                    {formatProposedAt(sug.proposed_at)}
                  </span>
                  {sug.raw_mention && (
                    <span style={{ display: 'block', fontSize: 12, color: '#999', marginTop: 2, fontStyle: 'italic' }}>
                      &ldquo;{sug.raw_mention}&rdquo;
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                  {/* Phase 6 placeholder — .ics download not yet built */}
                  <span
                    title="Calendar export coming in a future update (Phase 6)"
                    aria-disabled="true"
                    style={S.calDisabledBtn}
                  >
                    + Add to calendar
                  </span>
                  <button style={S.dismissBtn} onClick={() => onDismissCalSug(sug.id)}>
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Transcript */}
      <SectionCard label={`Transcript${segments.length > 0 ? ` · ${segments.length} segments` : ''}`}>
        {segments.length === 0 ? (
          <p style={S.empty}>No transcript is available for this meeting.</p>
        ) : (
          <TranscriptView
            segments={segments}
            highlightedSegIndex={highlightedSegIndex}
            onSeekTo={onSeekTo}
          />
        )}
      </SectionCard>

      {/* Chat placeholder — Phase 5 */}
      <div style={{ ...S.card, background: '#fafafa', marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#666', fontSize: 14 }}>
              Ask about this meeting
            </p>
            <p style={{ margin: 0, fontSize: 13, color: '#aaa' }}>
              AI-powered Q&amp;A over the transcript — coming in Phase 5.
            </p>
          </div>
          <button style={S.chatDisabledBtn} disabled title="Coming soon">
            Ask a question
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Transcript view ───────────────────────────────────────────────────────────

const SPEAKER_PALETTE = ['#1d4ed8', '#7c3aed', '#b45309', '#166534', '#be185d', '#0f766e']

function TranscriptView({
  segments,
  highlightedSegIndex,
  onSeekTo,
}: {
  segments: TranscriptSegment[]
  highlightedSegIndex: number | null
  onSeekTo: (ms: number) => void
}) {
  // Group consecutive same-speaker segments for visual clarity
  type Group = { speaker: string; segs: TranscriptSegment[] }
  const groups: Group[] = []
  for (const seg of segments) {
    const speaker = seg.speaker ?? 'Speaker'
    const last = groups[groups.length - 1]
    if (last?.speaker === speaker) {
      last.segs.push(seg)
    } else {
      groups.push({ speaker, segs: [seg] })
    }
  }

  // Assign a stable color per unique speaker (order of first appearance)
  const colorMap = new Map<string, string>()
  let ci = 0
  for (const { speaker } of groups) {
    if (!colorMap.has(speaker)) {
      colorMap.set(speaker, SPEAKER_PALETTE[ci % SPEAKER_PALETTE.length])
      ci++
    }
  }

  return (
    <div>
      {groups.map((group, gi) => (
        <div key={gi} style={{ marginBottom: 18 }}>
          <div style={{ marginBottom: 5 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: colorMap.get(group.speaker) ?? '#555',
              }}
            >
              {group.speaker}
            </span>
          </div>
          {group.segs.map((seg) => {
            const isHighlighted = highlightedSegIndex === seg.segment_index
            return (
              <div
                key={seg.id}
                id={`seg-${seg.segment_index}`}
                style={{
                  display: 'flex',
                  gap: 10,
                  marginBottom: 5,
                  padding: '5px 8px',
                  borderRadius: 5,
                  borderLeft: `3px solid ${isHighlighted ? '#e6b800' : 'transparent'}`,
                  background: isHighlighted ? '#fffbcc' : 'transparent',
                  transition: 'background 0.5s, border-color 0.5s',
                }}
              >
                <button
                  style={S.tsBtn}
                  title="Seek to this timestamp"
                  onClick={() => onSeekTo(seg.start_ms)}
                >
                  {formatMs(seg.start_ms)}
                </button>
                <span style={{ flex: 1, lineHeight: 1.65, color: '#222', fontSize: 14 }}>
                  {seg.text}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function SectionCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.card}>
      <div style={S.sectionLabel}>{label}</div>
      {children}
    </div>
  )
}

function MeetingHeaderBase({ meeting }: { meeting: Meeting }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h1 style={S.h1}>{meeting.title}</h1>
      <div style={S.metaRow}>
        <span>{formatDate(meeting.created_at)}</span>
        {meeting.duration_seconds != null && (
          <> · <span>{formatDuration(meeting.duration_seconds)}</span></>
        )}
        <> · <StatusBadge status={meeting.status} /></>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: MeetingStatus }) {
  const color: Record<MeetingStatus, string> = {
    pending: '#b45309', processing: '#1d4ed8', done: '#166534', failed: '#991b1b',
  }
  const bg: Record<MeetingStatus, string> = {
    pending: '#fef3c7', processing: '#dbeafe', done: '#dcfce7', failed: '#fee2e2',
  }
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 99,
        background: bg[status],
        color: color[status],
        verticalAlign: 'middle',
      }}
    >
      {status}
    </span>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, CSSProperties> = {
  main: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 820,
    margin: '0 auto',
    padding: '2rem 1rem',
  },
  back: {
    display: 'inline-block',
    color: '#0066cc',
    textDecoration: 'none',
    fontSize: 14,
    marginBottom: '1.5rem',
  },
  h1: {
    margin: '0 0 8px',
    fontSize: 24,
    fontWeight: 700,
    color: '#111',
    lineHeight: 1.25,
  },
  metaRow: {
    fontSize: 14,
    color: '#555',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  card: {
    border: '1px solid #e5e5e5',
    borderRadius: 10,
    padding: '16px 20px',
    background: '#fff',
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#aaa',
    marginBottom: 12,
  },
  spinner: {
    width: 34,
    height: 34,
    border: '3px solid #e5e5e5',
    borderTopColor: '#0066cc',
    borderRadius: '50%',
    margin: '0 auto',
    animation: 'spin 0.8s linear infinite',
  },
  errBox: {
    background: '#fff0f0',
    border: '1px solid #f55',
    borderRadius: 8,
    padding: '14px 18px',
    color: '#b00020',
    fontSize: 14,
  },
  empty: {
    margin: 0,
    color: '#aaa',
    fontSize: 14,
    fontStyle: 'italic',
  },
  plainList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  todoRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 0',
    borderBottom: '1px solid #f2f2f2',
  },
  citationBtn: {
    background: 'none',
    border: '1px solid #d8d8d8',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 12,
    color: '#0066cc',
    cursor: 'pointer',
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  calRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 0',
    borderBottom: '1px solid #f2f2f2',
  },
  calDisabledBtn: {
    display: 'inline-block',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid #e8e8e8',
    color: '#ccc',
    cursor: 'not-allowed',
    background: '#fafafa',
    userSelect: 'none',
  },
  dismissBtn: {
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid #d8d8d8',
    color: '#555',
    cursor: 'pointer',
    background: '#fff',
  },
  tsBtn: {
    background: 'none',
    border: '1px solid #d8d8d8',
    borderRadius: 4,
    padding: '2px 7px',
    fontSize: 11,
    color: '#666',
    cursor: 'pointer',
    fontFamily: 'monospace',
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  btnPrimary: {
    display: 'inline-block',
    padding: '9px 22px',
    background: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    textDecoration: 'none',
  },
  chatDisabledBtn: {
    padding: '9px 18px',
    background: '#f5f5f5',
    border: '1px solid #e8e8e8',
    borderRadius: 6,
    fontSize: 14,
    color: '#ccc',
    cursor: 'not-allowed',
    flexShrink: 0,
  },
  audioSkel: {
    height: 42,
    background: '#f5f5f5',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    color: '#bbb',
    animation: 'pulse 1.4s ease-in-out infinite',
  },
}
