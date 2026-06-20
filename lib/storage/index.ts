// SERVER ONLY — provider-agnostic audio storage abstraction.
//
// All audio I/O must go through this module. Nothing else imports Supabase
// storage methods or @aws-sdk directly.
//
// NEW writes (storage_provider = 'r2') always go to Cloudflare R2.
// LEGACY reads/deletes (storage_provider = 'supabase') use Supabase Storage —
// these branches exist ONLY to serve meetings created before migration CST-02.
// No new row will ever have storage_provider = 'supabase'. Do NOT remove the
// Supabase branches until every row has been migrated and the bucket retired.
//
// R2 bucket CORS: paste lib/storage/CORS.json into Cloudflare dashboard →
// R2 → <bucket> → Settings → CORS policy (replace AllowedOrigins with your domain).

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createServerClient } from '@/lib/supabase/server'

// Supabase bucket name — kept only for legacy reads/deletes.
const SUPABASE_BUCKET = 'recordings'

// ---------------------------------------------------------------------------
// R2 client (lazy singleton — validated on first use)
// ---------------------------------------------------------------------------

let _r2: S3Client | null = null

function r2(): S3Client {
  if (!_r2) {
    const accountId = process.env.R2_ACCOUNT_ID
    const accessKeyId = process.env.R2_ACCESS_KEY_ID
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
          'and R2_SECRET_ACCESS_KEY in your environment (server-only).',
      )
    }
    _r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return _r2
}

function r2Bucket(): string {
  const bucket = process.env.R2_BUCKET
  if (!bucket) throw new Error('R2_BUCKET env var is not set.')
  return bucket
}

// ---------------------------------------------------------------------------
// R2-only writes  (new rows — no legacy branch needed)
// ---------------------------------------------------------------------------

/**
 * Returns a presigned PUT URL for direct browser-to-R2 upload.
 *
 * IMPORTANT: the browser PUT request MUST include the header
 *   Content-Type: <contentType>
 * with the exact same value used here. R2 returns 403 on mismatch.
 *
 * The server echoes `contentType` back to the client in the POST /api/meetings
 * response so the browser can use the authoritative value without guessing.
 */
export async function createSignedUploadUrl({
  key,
  contentType,
  expiresIn = 900,
}: {
  key: string
  contentType: string
  expiresIn?: number
}): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: r2Bucket(), Key: key, ContentType: contentType }),
    { expiresIn },
  )
}

/**
 * Server-side upload of raw bytes to R2.
 * Used after server-side video→mp3 extraction where the browser is not involved.
 */
export async function uploadBytes({
  key,
  buffer,
  contentType,
}: {
  key: string
  buffer: Buffer
  contentType: string
}): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  )
}

// ---------------------------------------------------------------------------
// Provider-dispatched reads
// ---------------------------------------------------------------------------

/**
 * Returns a signed download URL for browser playback, ffmpeg, or ffprobe.
 * Branches on `provider` so legacy Supabase meetings continue to work.
 */
export async function createSignedDownloadUrl({
  key,
  provider,
  expiresIn = 3_600,
}: {
  key: string
  provider: string
  expiresIn?: number
}): Promise<string> {
  if (provider === 'r2') {
    return getSignedUrl(
      r2(),
      new GetObjectCommand({ Bucket: r2Bucket(), Key: key }),
      { expiresIn },
    )
  }

  // LEGACY — Supabase Storage. Serves meetings created before migration CST-02.
  // No new row will ever reach this branch. Remove when the bucket is retired.
  const db = createServerClient()
  const { data, error } = await db.storage.from(SUPABASE_BUCKET).createSignedUrl(key, expiresIn)
  if (error || !data?.signedUrl) {
    throw new Error(`Supabase createSignedUrl failed: ${error?.message ?? 'no URL returned'}`)
  }
  return data.signedUrl
}

/**
 * Downloads the full object and returns it as a Buffer.
 * Used by the pipeline to fetch audio before writing to a temp file.
 */
export async function getObjectBytes({
  key,
  provider,
}: {
  key: string
  provider: string
}): Promise<Buffer> {
  if (provider === 'r2') {
    const res = await r2().send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }))
    if (!res.Body) throw new Error(`R2 GetObject returned no body for key: ${key}`)
    const chunks: Uint8Array[] = []
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  // LEGACY — Supabase Storage. Remove when bucket is retired.
  const db = createServerClient()
  const { data: blob, error } = await db.storage.from(SUPABASE_BUCKET).download(key)
  if (error || !blob) throw new Error(`Supabase download failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await blob.arrayBuffer())
}

/**
 * Returns the object size in bytes, or null if not found.
 * Used for server-side enforcement of the MAX_UPLOAD_BYTES limit in /uploaded.
 */
export async function getObjectSize({
  key,
  provider,
}: {
  key: string
  provider: string
}): Promise<number | null> {
  if (provider === 'r2') {
    try {
      const res = await r2().send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }))
      return res.ContentLength ?? null
    } catch {
      return null
    }
  }

  // LEGACY — Supabase Storage. Remove when bucket is retired.
  const db = createServerClient()
  const dir = key.split('/').slice(0, -1).join('/')
  const filename = key.split('/').at(-1)
  const { data: files } = await db.storage
    .from(SUPABASE_BUCKET)
    .list(dir, { search: filename, limit: 1 })
  if (!files || files.length === 0) return null
  const size = (files[0].metadata as Record<string, unknown> | null)?.['size']
  return typeof size === 'number' ? size : null
}

// ---------------------------------------------------------------------------
// Provider-dispatched deletes
// ---------------------------------------------------------------------------

/**
 * Deletes a single object. Throws on failure — caller decides severity.
 */
export async function deleteObject({
  key,
  provider,
}: {
  key: string
  provider: string
}): Promise<void> {
  if (provider === 'r2') {
    await r2().send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }))
    return
  }

  // LEGACY — Supabase Storage. Remove when bucket is retired.
  const db = createServerClient()
  const { error } = await db.storage.from(SUPABASE_BUCKET).remove([key])
  if (error) throw new Error(`Supabase remove failed: ${error.message}`)
}

/**
 * Deletes multiple objects, potentially from mixed providers (legacy + R2 rows).
 * Returns an array of keys that failed; never throws.
 */
export async function deleteObjects(
  items: Array<{ key: string; provider: string }>,
): Promise<string[]> {
  const failed: string[] = []
  await Promise.allSettled(
    items.map(({ key, provider }) =>
      deleteObject({ key, provider }).catch(() => {
        failed.push(key)
      }),
    ),
  )
  return failed
}
