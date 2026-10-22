import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'

const DEFAULT_ORG =
  process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001'

async function ensureOrg(sb: ReturnType<typeof getServiceSupabase>) {
  await sb.from('orgs').upsert({ id: DEFAULT_ORG, name: 'Default' }, { onConflict: 'id' })
}

export const saveSkillDraft = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      skillSlug: z.string().min(1),
      values: z.record(z.string()),
      title: z.string().optional(),
      profileName: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    if (!hasSupabaseConfig()) {
      return {
        ok: false as const,
        error: 'Supabase not configured — draft not saved to cloud',
      }
    }
    const sb = getServiceSupabase()
    await ensureOrg(sb)
    const { error } = await sb.from('skill_drafts').upsert(
      {
        org_id: DEFAULT_ORG,
        skill_slug: data.skillSlug,
        title: data.title || data.skillSlug,
        values: data.values,
        profile_name: data.profileName || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,skill_slug' },
    )
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  })

export const loadSkillDraft = createServerFn({ method: 'GET' })
  .validator(z.object({ skillSlug: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!hasSupabaseConfig()) {
      return { ok: false as const, values: null as Record<string, string> | null }
    }
    const sb = getServiceSupabase()
    const { data: row, error } = await sb
      .from('skill_drafts')
      .select('values, updated_at')
      .eq('org_id', DEFAULT_ORG)
      .eq('skill_slug', data.skillSlug)
      .maybeSingle()
    if (error) return { ok: false as const, values: null, error: error.message }
    if (!row) return { ok: true as const, values: null }
    return {
      ok: true as const,
      values: (row.values || {}) as Record<string, string>,
      updatedAt: row.updated_at as string,
    }
  })
