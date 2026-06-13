// SERVER ONLY — reads Gemini API keys. Import only from /app/api or server /lib.
//
// Batched text embedding using gemini-embedding-001 at 768 dimensions (must
// match the vector(768) column in transcript_chunks and EMBEDDING_DIMENSION).
//
// Each batch is a separate geminiPool.call() so a 429 on batch N doesn't
// force re-embedding batches 0..N-1.

import { log } from '@/lib/logger'
import { GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMENSION } from './client'
import { geminiPool } from './pool'
import { PipelineError } from './errors'

// Gemini embedding API batch limit (conservative — free tier may be lower).
const BATCH_SIZE = 100

/**
 * Embed an array of texts using the Gemini embedding model.
 * Returns one 768-dimension float array per input text, in the same order.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const all: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    log(
      `[embed] embedding batch ${Math.floor(i / BATCH_SIZE) + 1} ` +
        `(${batch.length} chunks, total so far ${i})`,
    )

    const response = await geminiPool.call(ai =>
      ai.models.embedContent({
        model: GEMINI_EMBEDDING_MODEL,
        contents: batch,
        config: { outputDimensionality: EMBEDDING_DIMENSION },
      }),
    )

    const embeddings = response.embeddings
    if (!embeddings || embeddings.length !== batch.length) {
      throw new PipelineError(
        `Gemini embed: expected ${batch.length} embeddings, got ${embeddings?.length ?? 0}`,
      )
    }

    for (const emb of embeddings) {
      const values = emb.values
      if (!values || values.length !== EMBEDDING_DIMENSION) {
        throw new PipelineError(
          `Gemini embed: wrong dimension ${values?.length ?? 0}, expected ${EMBEDDING_DIMENSION}`,
        )
      }
      all.push(values)
    }
  }

  return all
}
