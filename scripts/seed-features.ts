// Seed the `features` table from ai-instruction/features/*.md + tracking.md.
//
// This is the ONLY place that reads the ai-instruction/ directory.
// After running this script the database is the source of truth.
// Idempotent: re-running UPSERTs by key — no duplicates created.
//
// Usage:
//   npx tsx scripts/seed-features.ts

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { parseModuleFile, parseTrackingMd, mergeWithTracking } from '../lib/features/parser.js'

dotenv.config({ path: '.env.local' })

const FEATURES_DIR = path.join(process.cwd(), 'ai-instruction', 'features')
const TRACKING_FILE = path.join(process.cwd(), 'ai-instruction', 'tracking.md')

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
    )
    process.exit(1)
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // ── Parse tracking.md ───────────────────────────────────────────────────────
  const trackingRaw = fs.readFileSync(TRACKING_FILE, 'utf-8')
  const tracking = parseTrackingMd(trackingRaw)
  console.log(`Parsed ${tracking.size} rows from tracking.md`)

  // ── Parse all module files ──────────────────────────────────────────────────
  const files = fs
    .readdirSync(FEATURES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()

  const allMerged = []

  for (const file of files) {
    const filePath = path.join(FEATURES_DIR, file)
    const raw = fs.readFileSync(filePath, 'utf-8')
    const sourcePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/')
    const parsed = parseModuleFile(raw, sourcePath)

    for (const feature of parsed) {
      const tr = tracking.get(feature.key)
      allMerged.push(mergeWithTracking(feature, tr))
    }
  }

  console.log(`Parsed ${allMerged.length} features from ${files.length} module files`)

  // ── Check existing count for reporting ────────────────────────────────────
  const { count: existingCount } = await db
    .from('features')
    .select('*', { count: 'exact', head: true })
  const before = existingCount ?? 0

  // ── Upsert ─────────────────────────────────────────────────────────────────
  let errors = 0

  for (const f of allMerged) {
    const row = {
      key: f.key,
      source_path: f.source_path,
      module_prefix: f.module_prefix,
      module_name: f.module_name,
      title: f.title,
      user_story: f.user_story,
      description: f.description,
      content: f.content,
      status: f.status,
      priority: f.priority,
      note_tags: f.note_tags,
      depends_on: f.depends_on,
      blocks: [] as string[],
      key_files: f.key_files,
      metadata: f.metadata,
    }

    const { error } = await db
      .from('features')
      .upsert(row, { onConflict: 'key', ignoreDuplicates: false })

    if (error) {
      console.error(`  ✗ ${f.key} — ${error.message}`)
      errors++
    } else {
      console.log(`  ✓ ${f.key.padEnd(10)} ${f.title}`)
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const { count: afterCount } = await db
    .from('features')
    .select('*', { count: 'exact', head: true })
  const after = afterCount ?? 0
  const inserted = after - before

  console.log(`\nDone! ${allMerged.length} features processed.`)
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Updated:  ${allMerged.length - inserted - errors}`)
  if (errors > 0) console.error(`  Errors:   ${errors}`)

  if (errors > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
