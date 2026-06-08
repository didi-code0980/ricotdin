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

// ---------------------------------------------------------------------------
// supabase-js v2 generic type compatibility notes
//
// supabase-js v2 checks `Database['public'] extends GenericSchema` where:
//   GenericSchema = { Tables: Record<string, GenericTable>; Views: Record<string, GenericView>; Functions: ... }
//
// Problem: TypeScript's conditional-type `extends` check does NOT treat a
// named-property object type (e.g. `{ meetings: X }`) as satisfying
// `Record<string, GenericTable>`, even if each named property extends GenericTable.
// The check requires an explicit index signature.
//
// Fix: intersect the named Tables object with an index-signature type whose value
// type is compatible with (i.e. not narrower than) our specific table shapes.
// This preserves the per-table named types for IDE autocomplete while letting the
// generic constraint pass. Same treatment for Views.
// ---------------------------------------------------------------------------

// Minimum shape required by supabase-js GenericTable constraint.
// All our table types already have these fields, so the intersection is a no-op.
type NoRelationships = never[]
type MinTableShape = {
  Row: Record<string, unknown>
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
  Relationships: NoRelationships
}
// Minimum shape required by supabase-js GenericView constraint.
type MinViewShape = { Row: Record<string, unknown>; Relationships: NoRelationships }

export interface Database {
  public: {
    // Intersection with `{ [k: string]: MinTableShape }` adds the index signature that
    // supabase-js needs to satisfy `Record<string, GenericTable>`.
    Tables: {
      meetings: {
        Row: Meeting
        // Nullable DB columns omit correctly — required only: user_id.
        // title/status have DB defaults so are optional here.
        Insert: {
          id?: string
          user_id: string
          title?: string
          status?: MeetingStatus
          audio_path?: string | null
          duration_seconds?: number | null
          language?: string | null
          summary?: string | null
          notes?: string | null
          error_message?: string | null
          started_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Meeting>
        Relationships: NoRelationships
      }
      transcript_segments: {
        Row: TranscriptSegment
        Insert: {
          id?: string
          meeting_id: string
          segment_index: number
          speaker?: string | null
          start_ms: number
          end_ms: number
          text: string
          created_at?: string
        }
        Update: Partial<TranscriptSegment>
        Relationships: NoRelationships
      }
      transcript_chunks: {
        Row: TranscriptChunk
        Insert: {
          id?: string
          meeting_id: string
          chunk_index: number
          content: string
          embedding: number[]
          start_ms?: number | null
          end_ms?: number | null
          token_count?: number | null
          created_at?: string
        }
        Update: Partial<TranscriptChunk>
        Relationships: NoRelationships
      }
      todos: {
        Row: Todo
        Insert: {
          id?: string
          meeting_id: string
          content: string
          assignee?: string | null
          due_date?: string | null
          status?: TodoStatus
          source_segment_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Todo>
        Relationships: NoRelationships
      }
      calendar_suggestions: {
        Row: CalendarSuggestion
        Insert: {
          id?: string
          meeting_id: string
          title: string
          proposed_at?: string | null
          raw_mention?: string | null
          source_segment_id?: string | null
          dismissed?: boolean
          created_at?: string
        }
        Update: Partial<CalendarSuggestion>
        Relationships: NoRelationships
      }
      chat_sessions: {
        Row: ChatSession
        Insert: {
          id?: string
          user_id: string
          meeting_id?: string | null
          title?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<ChatSession>
        Relationships: NoRelationships
      }
      chat_messages: {
        Row: ChatMessage
        Insert: {
          id?: string
          session_id: string
          role: ChatRole
          content: string
          citations?: Citation[]
          created_at?: string
        }
        Update: Partial<ChatMessage>
        Relationships: NoRelationships
      }
    } & { [tableName: string]: MinTableShape }
    // No views in this schema. Must still satisfy Record<string, GenericView>
    // (required by GenericSchema). MinViewShape is compatible with all table types
    // so the intersection in TablesAndViews<Schema> = Tables & Views does not
    // collapse any table type to never.
    Views: { [viewName: string]: MinViewShape }
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
