// SERVER ONLY — this module reads SUPABASE_SERVICE_ROLE_KEY which must never
// reach the browser. Import it only from /app/api route handlers or other
// server-only /lib modules.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Server/service-role client — bypasses RLS. Use this in the processing
// pipeline and other background writes where there is no user session.
export function createServerClient() {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      // Service role clients should not persist sessions.
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
