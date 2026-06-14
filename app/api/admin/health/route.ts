// GET /api/admin/health
//
// Runs connectivity checks against Supabase DB and Gemini, then returns
// an aggregated health report.
//
// SECURITY: requires admin role.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/server'
import { buildHealthReport } from '@/lib/admin/health'
import type { CheckResult } from '@/lib/admin/health'

async function checkSupabase(): Promise<CheckResult> {
  try {
    const db = createServerClient()
    // Lightweight read to verify DB connectivity
    const { error } = await db.from('profiles').select('id').limit(1)
    if (error) return { status: 'error', message: error.message }
    return { status: 'ok' }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Unknown error' }
  }
}

async function checkGemini(): Promise<CheckResult> {
  try {
    const key = process.env.GEMINI_API_KEY
    if (!key) return { status: 'error', message: 'GEMINI_API_KEY not configured' }
    // Use the models list endpoint as a cheap liveness probe
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` }
    return { status: 'ok' }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (res) {
    return res as NextResponse
  }

  const [supabase, gemini] = await Promise.all([checkSupabase(), checkGemini()])
  const report = buildHealthReport({ supabase, gemini })

  const httpStatus = report.status === 'ok' ? 200 : 503
  return NextResponse.json(report, { status: httpStatus })
}
