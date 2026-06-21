// GET /api/admin/features
//
// Returns the full feature list, optionally filtered by module_prefix, status,
// and a free-text search (key, title, description).
//
// SECURITY: admin-only, server-enforced via requireAdmin().

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/server'
import { listFeatures } from '@/lib/features'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (res) {
    return res as NextResponse
  }

  const { searchParams } = new URL(req.url)
  const module_prefix = searchParams.get('module_prefix') ?? undefined
  const status = searchParams.get('status') as 'done' | 'partial' | 'not_started' | undefined
  const search = searchParams.get('search') ?? undefined
  const page = Number(searchParams.get('page') ?? 1)
  const perPage = Number(searchParams.get('perPage') ?? 200)

  try {
    const features = await listFeatures({ module_prefix, status, search, page, perPage })
    return NextResponse.json({ features })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
