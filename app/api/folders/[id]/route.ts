// PATCH  /api/folders/:id — rename a folder
// DELETE /api/folders/:id — delete a folder (meetings fall back to Uncategorized via ON DELETE SET NULL)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

async function requireUser(req: NextRequest): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw NextResponse.json({ error: 'Missing Authorization header.' }, { status: 401 })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw NextResponse.json({ error: 'Server misconfiguration.' }, { status: 500 })

  const authClient = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await authClient.auth.getUser()
  if (error || !user) throw NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 })
  return user.id
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string
  try { userId = await requireUser(req) } catch (e) { return e as NextResponse }

  const { id } = await params
  let body: { name?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }

  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
  if (name.length > 100) return NextResponse.json({ error: 'Folder name too long (max 100 characters).' }, { status: 400 })

  const serverClient = createServerClient()

  // Verify ownership
  const { data: existing, error: fetchError } = await serverClient
    .from('folders')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !existing) return NextResponse.json({ error: 'Folder not found.' }, { status: 404 })

  const { data, error } = await serverClient
    .from('folders')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `A folder named "${name}" already exists.` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ folder: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let userId: string
  try { userId = await requireUser(req) } catch (e) { return e as NextResponse }

  const { id } = await params
  const serverClient = createServerClient()

  // Verify ownership before deleting
  const { data: existing, error: fetchError } = await serverClient
    .from('folders')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !existing) return NextResponse.json({ error: 'Folder not found.' }, { status: 404 })

  // Deleting the folder sets meetings.folder_id = NULL via ON DELETE SET NULL
  const { error } = await serverClient
    .from('folders')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
