// SERVER ONLY — reads Gemini API keys. Import only from /app/api or server /lib.
//
// Step B of the pipeline: pass the transcript text to Gemini Flash (text-only,
// cheap) and extract summary, meeting notes, todos, and calendar suggestions.
// Segments are referenced by their 0-based array index so citations map back
// to the transcript_segments rows inserted in Step A.

import { Type, type Schema } from '@google/genai'
import { log } from '@/lib/logger'
import { GEMINI_MODEL } from './client'
import { geminiPool } from './pool'
import { PipelineError } from './errors'
import {
  GeminiAnalysisSchema,
  type AnalysisResult,
  type TranscriptResult,
} from '@/types/pipeline'

// ---------------------------------------------------------------------------
// Gemini response schema
// ---------------------------------------------------------------------------

const ANALYSIS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'A few sentences summarising the meeting',
    },
    notes_markdown: {
      type: Type.STRING,
      description: 'Structured meeting notes in Markdown',
    },
    todos: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.STRING, description: 'Action item description' },
          assignee: { type: Type.STRING, nullable: true },
          due_date: {
            type: Type.STRING,
            nullable: true,
            description: 'YYYY-MM-DD or null',
          },
          source_segment_index: {
            type: Type.INTEGER,
            nullable: true,
            description: '0-based index into the segments array',
          },
        },
        required: ['content', 'assignee', 'due_date', 'source_segment_index'],
      },
    },
    calendar_suggestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          proposed_at: {
            type: Type.STRING,
            nullable: true,
            description: 'ISO 8601 datetime or null if vague',
          },
          raw_mention: {
            type: Type.STRING,
            description: 'Exact phrase from the transcript',
          },
          source_segment_index: {
            type: Type.INTEGER,
            nullable: true,
            description: '0-based index into the segments array',
          },
        },
        required: ['title', 'proposed_at', 'raw_mention', 'source_segment_index'],
      },
    },
  },
  required: ['summary', 'notes_markdown', 'todos', 'calendar_suggestions'],
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(
  segments: TranscriptResult['segments'],
  strict = false,
  meetingDate?: string,
): string {
  // Format the transcript with segment indices so Gemini can cite them back.
  const transcriptText = segments
    .map(
      (s, i) =>
        `[${i}] ${s.speaker} (${(s.start_ms / 1000).toFixed(1)}s): ${s.text}`,
    )
    .join('\n')

  // Anchor date so Gemini resolves relative phrases ("next Tuesday") correctly.
  // Without this, Gemini guesses based on training data cutoff — always wrong.
  const dateContext = meetingDate
    ? `\nMeeting date: ${meetingDate}. Resolve all relative time references ` +
      `("next Tuesday", "this Friday", "end of month", etc.) against this date ` +
      `when producing ISO 8601 values for due_date and proposed_at.\n`
    : ''

  const base = `You are a meeting assistant. Analyse the following meeting transcript.
${dateContext}
TRANSCRIPT (each line prefixed with its 0-based segment index [N]):
${transcriptText}

Instructions:
1. Write a concise summary (2–5 sentences).
2. Write structured meeting notes in Markdown (headings, bullet points).
3. Extract every action item / to-do. For each, note the assignee and due date
   if mentioned, and the segment index [N] where it was stated.
4. Extract every proposed meeting / calendar event. Record the proposed datetime
   (ISO 8601) if determinable, the raw phrasing from the transcript, and the
   segment index [N] where it was mentioned.

Use null for assignee/due_date/proposed_at/source_segment_index when not available.
For due_date use YYYY-MM-DD format.`

  return strict
    ? base + '\n\nReturn ONLY valid JSON. No markdown fences, no explanation.'
    : base
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function parseResult(raw: string): AnalysisResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch {
    throw new PipelineError(
      `Gemini analysis: JSON.parse failed. First 300 chars: ${raw.slice(0, 300)}`,
    )
  }

  const result = GeminiAnalysisSchema.safeParse(parsed)
  if (!result.success) {
    throw new PipelineError(
      `Gemini analysis: schema validation failed: ${result.error.message}`,
    )
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse the transcript text with Gemini Flash (text-only, no audio upload).
 * Returns summary, markdown notes, todos, and calendar suggestions.
 * Segment indices in the result map directly to the array passed in.
 *
 * @param transcript   Parsed transcript from Step A.
 * @param meetingDate  ISO 8601 timestamp of when the meeting took place.
 *                     Injected into the prompt so Gemini can resolve relative
 *                     date phrases ("next Tuesday") against the real meeting date
 *                     instead of guessing. Pass `meetings.started_at` here.
 */
export async function analyzeTranscript(
  transcript: TranscriptResult,
  meetingDate?: string,
): Promise<AnalysisResult> {
  if (transcript.segments.length === 0) {
    return { summary: '', notes_markdown: '', todos: [], calendar_suggestions: [] }
  }

  log(`[analyze] analysing transcript with ${transcript.segments.length} segments` +
    (meetingDate ? ` (meeting date: ${meetingDate})` : ''))

  return geminiPool.call(async (ai) => {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildPrompt(transcript.segments, false, meetingDate),
      config: {
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_RESPONSE_SCHEMA,
      },
    })

    try {
      return parseResult(response.text ?? '')
    } catch (parseErr) {
      // Prompt-level retry with a stricter instruction on the same key.
      // PipelineError from parseResult is 'bad-request' in the pool, so a
      // second parse failure surfaces immediately without key rotation.
      console.warn('[analyze] first parse failed; retrying with strict prompt:', parseErr)
      const response2 = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildPrompt(transcript.segments, true, meetingDate),
        config: {
          responseMimeType: 'application/json',
          responseSchema: ANALYSIS_RESPONSE_SCHEMA,
        },
      })
      return parseResult(response2.text ?? '')
    }
  })
}
