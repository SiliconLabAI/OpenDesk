import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'
import { ensureDefaultOrg } from '~/lib/supabase/org'
import { DEFAULT_SETTINGS, type ProviderSettings } from './types'

const SettingsSchema = z.object({
  preferredLlm: z
    .enum(['auto', 'anthropic', 'openai', 'openai_compatible'])
    .optional(),
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  openaiCompatibleEnabled: z.boolean().optional(),
  openaiCompatibleBaseUrl: z.string().optional(),
  openaiCompatibleApiKey: z.string().optional(),
  openaiCompatibleModel: z.string().optional(),
  medialystApiKey: z.string().optional(),
  medialystApiBase: z.string().optional(),
  manusApiKey: z.string().optional(),
  appUrl: z.string().optional(),
  slackWebhookUrl: z.string().optional(),
})

export const loadSettingsRemote = createServerFn({ method: 'GET' }).handler(
  async () => {
    if (!hasSupabaseConfig()) {
      return {
        ok: false as const,
        settings: { ...DEFAULT_SETTINGS },
        error: 'No Supabase',
      }
    }
    try {
      const sb = getServiceSupabase()
      const orgId = await ensureDefaultOrg(sb)
      const { data, error } = await sb
        .from('app_settings')
        .select('settings')
        .eq('org_id', orgId)
        .maybeSingle()
      if (error) {
        return {
          ok: false as const,
          settings: { ...DEFAULT_SETTINGS },
          error: error.message,
        }
      }
      const settings = {
        ...DEFAULT_SETTINGS,
        ...((data?.settings as Partial<ProviderSettings>) || {}),
      }
      return { ok: true as const, settings }
    } catch (e) {
      return {
        ok: false as const,
        settings: { ...DEFAULT_SETTINGS },
        error: e instanceof Error ? e.message : String(e),
      }
    }
  },
)

export const saveSettingsRemote = createServerFn({ method: 'POST' })
  .validator(z.object({ settings: SettingsSchema }))
  .handler(async ({ data }) => {
    if (!hasSupabaseConfig()) {
      return { ok: false as const, error: 'Supabase not configured' }
    }
    try {
      const sb = getServiceSupabase()
      const orgId = await ensureDefaultOrg(sb)
      const { error } = await sb.from('app_settings').upsert(
        {
          org_id: orgId,
          settings: data.settings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id' },
      )
      if (error) return { ok: false as const, error: error.message }
      return { ok: true as const }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
