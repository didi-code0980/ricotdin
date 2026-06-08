// TypeScript types mirroring the Postgres schema (schema.sql).
// Keep in sync with any schema migrations.

export type MeetingStatus = 'pending' | 'processing' | 'done' | 'failed'
export type TodoStatus = 'open' | 'done' | 'dismissed'
export type ChatRole = 'user' | 'assistant'

// Citation object stored in chat_messages.citations (jsonb)
export interface Citation {
  chunk_id: string
  meeting_id: string
  start_ms: number
  end_ms: number
}

// ---------------------------------------------------------------------------
// Row shapes — what you get back from SELECT *
// ---------------------------------------------------------------------------

export interface Meeting {
  id: string
  user_id: string
  title: string
  status: MeetingStatus
  audio_path: string | null
  duration_seconds: number | null
  language: string | null
  summary: string | null
  notes: string | null
  error_message: string | null
  started_at: string | null
  created_at: string
  updated_at: string
}

export interface TranscriptSegment {
  id: string
  meeting_id: string
  segment_index: number
  speaker: string | null
  start_ms: number
  end_ms: number
  text: string
  created_at: string
}

export interface TranscriptChunk {
  id: string
  meeting_id: string
  chunk_index: number
  content: string
  // pgvector returns a number array; embeddings are dimension 768
  embedding: number[]
  start_ms: number | null
  end_ms: number | null
  token_count: number | null
  created_at: string
}

export interface Todo {
  id: string
  meeting_id: string
  content: string
  assignee: string | null
  due_date: string | null
  status: TodoStatus
  source_segment_id: string | null
  created_at: string
  updated_at: string
}

export interface CalendarSuggestion {
  id: string
  meeting_id: string
  title: string
  proposed_at: string | null
  raw_mention: string | null
  source_segment_id: string | null
  dismissed: boolean
  created_at: string
}

export interface ChatSession {
  id: string
  user_id: string
  meeting_id: string | null
  title: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: string
  session_id: string
  role: ChatRole
  content: string
  citations: Citation[]
  created_at: string
}

// ---------------------------------------------------------------------------
// Database interface for Supabase generic typing
// createClient<Database>() gives column-level type inference on all queries.
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      meetings: {
        Row: Meeting
        Insert: Omit<Meeting, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Meeting>
      }
      transcript_segments: {
        Row: TranscriptSegment
        Insert: Omit<TranscriptSegment, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<TranscriptSegment>
      }
      transcript_chunks: {
        Row: TranscriptChunk
        Insert: Omit<TranscriptChunk, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<TranscriptChunk>
      }
      todos: {
        Row: Todo
        Insert: Omit<Todo, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Todo>
      }
      calendar_suggestions: {
        Row: CalendarSuggestion
        Insert: Omit<CalendarSuggestion, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<CalendarSuggestion>
      }
      chat_sessions: {
        Row: ChatSession
        Insert: Omit<ChatSession, 'id' | 'created_at' | 'updated_at'> & {
          id?: string
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ChatSession>
      }
      chat_messages: {
        Row: ChatMessage
        Insert: Omit<ChatMessage, 'id' | 'created_at'> & {
          id?: string
          created_at?: string
        }
        Update: Partial<ChatMessage>
      }
    }
    Views: Record<string, never>
    Functions: {
      match_transcript_chunks: {
        Args: {
          query_embedding: number[]
          match_count?: number
          filter_meeting_id?: string | null
        }
        Returns: Array<{
          id: string
          meeting_id: string
          content: string
          start_ms: number
          end_ms: number
          similarity: number
        }>
      }
    }
    Enums: {
      meeting_status: MeetingStatus
      todo_status: TodoStatus
      chat_role: ChatRole
    }
  }
}
