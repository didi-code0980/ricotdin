// SERVER ONLY — this module reads GEMINI_API_KEY which must never reach the
// browser. Import it only from /app/api route handlers or other server-only
// /lib modules.
//
// This is the ONLY place in the codebase that imports @google/genai directly.
// All Gemini calls must go through this module so we can swap models or
// switch free↔paid in one place.

import { GoogleGenAI } from '@google/genai'

export const GEMINI_MODEL = 'gemini-2.5-flash' as const
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001' as const
export const EMBEDDING_DIMENSION = 768 as const

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to .env.local (server only).')
  }
  return new GoogleGenAI({ apiKey })
}

/**
 * Send a plain text prompt to Gemini and return the text response.
 * Minimal wrapper used for connectivity checks and simple generation tasks.
 */
export async function generateText(prompt: string): Promise<string> {
  const ai = getClient()
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  })
  const text = response.text
  if (text === undefined) {
    throw new Error('Gemini returned an empty response.')
  }
  return text
}
