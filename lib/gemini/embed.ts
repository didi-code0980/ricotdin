// SERVER ONLY — reads GEMINI_API_KEY. Import only from /app/api or server /lib.
//
// Batched text embedding using gemini-embedding-001 at 768 dimensions (must
// match the vector(768) column in transcript_chunks and EMBEDDING_DIMENSION).

import { getAIClient, GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMENSION } from './client'
import { retryWithBackoff } from './retry'
import { PipelineError } from './errors'

// Gemini embedding API batch limit (conservative — free tier may be lower).
// Each call embeds up to this many texts; we loop for larger inputs.
const BATCH_SIZE = 100

/**
 * Embed an array of texts using the Gemini embedding model.
 * Returns one 768-dimension float array per input text, in the same order.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const ai = getAIClient()
  const all: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    console.log(
      `[embed] embedding batch ${Math.floor(i / BATCH_SIZE) + 1} ` +
        `(${batch.length} chunks, total so far ${i})`,
    )

    const response = await retryWithBackoff(() =>
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
