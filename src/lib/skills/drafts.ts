import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'
import { ensureDefaultOrg } from '~/lib/supabase/org'

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
        error: 'Supabase not configured — cannot save skill draft',
      }
    }
    try {
      const sb = getServiceSupabase()
      const orgId = await ensureDefaultOrg(sb)
      const row = {
        org_id: orgId,
        skill_slug: data.skillSlug,
        title: data.title || data.skillSlug,
        payload: data.values,
        profile_name: data.profileName || null,
        updated_at: new Date().toISOString(),
      }
      // Try payload column first; fall back to values for old schema
      let { error } = await sb
        .from('skill_drafts')
        .upsert(row, { onConflict: 'org_id,skill_slug' })
      if (error && /payload|column/i.test(error.message)) {
        const { error: e2 } = await sb.from('skill_drafts').upsert(
          {
            org_id: orgId,
            skill_slug: data.skillSlug,
            title: data.title || data.skillSlug,
            values: data.values,
            profile_name: data.profileName || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,skill_slug' },
        )
        error = e2
      }
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const loadSkillDraft = createServerFn({ method: 'GET' })
  .validator(z.object({ skillSlug: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!hasSupabaseConfig()) {
      return {
        ok: false as const,
        values: null as Record<string, string> | null,
        error: 'No Supabase',
      }
    }
    try {
      const sb = getServiceSupabase()
      const orgId = await ensureDefaultOrg(sb)
      const { data: row, error } = await sb
        .from('skill_drafts')
        .select('*')
        .eq('org_id', orgId)
        .eq('skill_slug', data.skillSlug)
        .maybeSingle()
      if (error) {
        return { ok: false as const, values: null, error: error.message }
      }
      if (!row) return { ok: true as const, values: null }
      const payload =
        (row.payload as Record<string, string> | null) ||
        (row.values as Record<string, string> | null) ||
        null
      return {
        ok: true as const,
        values: payload,
        updatedAt: row.updated_at as string,
      }
    } catch (e) {
      return {
        ok: false as const,
        values: null,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

export const listSkillDrafts = createServerFn({ method: 'GET' }).handler(
  async () => {
    if (!hasSupabaseConfig()) {
      return { ok: false as const, drafts: [] as unknown[], error: 'No Supabase' }
    }
    try {
      const sb = getServiceSupabase()
      const orgId = await ensureDefaultOrg(sb)
      const { data, error } = await sb
        .from('skill_drafts')
        .select('skill_slug, title, updated_at, profile_name')
        .eq('org_id', orgId)
        .order('updated_at', { ascending: false })
      if (error) return { ok: false as const, drafts: [], error: error.message }
      return { ok: true as const, drafts: data || [] }
    } catch (e) {
      return {
        ok: false as const,
        drafts: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)
