import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let admin: SupabaseClient | null = null

/** Service-role client for webhooks, cron, and server jobs (bypasses RLS). */
export function getServiceSupabase(): SupabaseClient {
  if (admin) return admin
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for Full Mode server operations',
    )
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}

export function hasSupabaseConfig(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}
