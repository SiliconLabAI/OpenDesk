import type { SupabaseClient } from '@supabase/supabase-js'

export function defaultOrgId(): string {
  return process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001'
}

export async function ensureDefaultOrg(sb: SupabaseClient): Promise<string> {
  const id = defaultOrgId()
  await sb.from('orgs').upsert({ id, name: 'Default' }, { onConflict: 'id' })
  return id
}
