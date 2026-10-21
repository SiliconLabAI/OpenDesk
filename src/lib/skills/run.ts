import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSkill } from './catalog'
import { buildSystemPrompt, buildUserPrompt, offlineDemoResult } from './prompts'
import {
  formatArticlesForPrompt,
  lookupJournalists,
  queryPrCalendar,
  searchNews,
} from '~/lib/medialyst/client'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import type { ProviderSettings } from '~/lib/settings/types'
import {
  hasManusConfig,
  manusCreateTask,
  manusListMessages,
  extractManusResults,
} from '~/lib/manus/client'

const SettingsPartial = z
  .object({
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
  .optional()

const RunInput = z.object({
  slug: z.string(),
  values: z.record(z.string()),
  profile: z.string().optional(),
  settings: SettingsPartial,
})

async function manusResearchPrompt(
  prompt: string,
  settings: ProviderSettings,
): Promise<string> {
  if (!hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
    return ''
  }
  try {
    const task = await manusCreateTask(
      {
        title: `newsjack research: ${prompt.slice(0, 40)}`,
        prompt,
        agentProfile: 'lite',
      },
      { apiKey: settings.manusApiKey || undefined },
    )
    // Brief wait for fast tasks; long runs still complete via webhook elsewhere
    await new Promise((r) => setTimeout(r, 10000))
    try {
      const msgs = await manusListMessages(task.task_id, 12, {
        apiKey: settings.manusApiKey || undefined,
      })
      const extracted = extractManusResults(msgs)
      if (extracted.text) {
        return `### Manus research (task ${task.task_id})\n${extracted.text}`
      }
    } catch {
      /* still running */
    }
    return `### Manus research started\nTask \`${task.task_id}\`${task.task_url ? ` — ${task.task_url}` : ''}. Still running; use partial user inputs for now.`
  } catch (e) {
    return `### Manus research failed\n${e instanceof Error ? e.message : String(e)}`
  }
}

async function fetchToolContext(
  slug: string,
  values: Record<string, string>,
  settings: ProviderSettings,
): Promise<string | undefined> {
  const hasMedialyst = Boolean(settings.medialystApiKey)
  const ctx = hasMedialyst
    ? { apiKey: settings.medialystApiKey, baseUrl: settings.medialystApiBase }
    : undefined

  if (slug === 'news-search' || slug === 'story-origin-check') {
    const q = values.query || values.story || values.item || ''
    if (!q.trim()) return undefined
    if (hasMedialyst) {
      const res = await searchNews({ query: q, limit: 15 }, ctx)
      if (!res.ok) {
        // fall through to Manus
      } else {
        return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
      }
    }
    return (
      (await manusResearchPrompt(
        `Search the live web for recent news articles about: ${q}

Return up to 12 real articles with title, outlet, publish date, URL, and one-line snippet. Do not invent URLs.`,
        settings,
      )) || undefined
    )
  }

  if (slug === 'pr-calendar') {
    const q = values.company || values.query || ''
    if (!q.trim()) return undefined
    if (hasMedialyst) {
      const res = await queryPrCalendar(
        { query: q, horizon: values.horizon },
        ctx,
      )
      if (res.ok) {
        return `### Medialyst PR calendar\n\`\`\`json\n${JSON.stringify(res.events, null, 2).slice(0, 8000)}\n\`\`\``
      }
    }
    return (
      (await manusResearchPrompt(
        `Build a 6-month PR calendar of real upcoming hooks, awareness days, conferences, and news pegs relevant to: ${q}
Horizon: ${values.horizon || '6 months'}
List dated moments with why they matter for PR. Prefer verifiable public events.`,
        settings,
      )) || undefined
    )
  }

  if (slug === 'find-journalists') {
    const brief = values.brief || ''
    const candidates = values.candidates || ''
    if (hasMedialyst) {
      const res = await lookupJournalists(
        {
          query: brief.slice(0, 500),
          names: candidates
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 10),
        },
        ctx,
      )
      if (res.ok) {
        return `### Medialyst journalist lookup\n\`\`\`json\n${JSON.stringify(res.journalists, null, 2).slice(0, 8000)}\n\`\`\``
      }
    }
    return (
      (await manusResearchPrompt(
        `Research journalists who would cover this PR brief. Do not invent emails.

Brief:
${brief}

Seed candidates:
${candidates || '(none)'}

For each journalist: name, outlet, beat, 1–2 recent relevant pieces with URLs if found, and fit notes.`,
        settings,
      )) || undefined
    )
  }

  if (slug === 'newsjack-detector' || slug === 'coverage-tracker') {
    const q =
      values.company ||
      values.keywords ||
      values.profile ||
      values.signals ||
      values.config ||
      values.hits ||
      ''
    if (!q.trim()) return undefined
    const query = q.split('\n')[0].slice(0, 200)
    if (hasMedialyst) {
      const res = await searchNews({ query, limit: 20 }, ctx)
      if (res.ok) {
        return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
      }
    }
    return (
      (await manusResearchPrompt(
        `Search recent news relevant to this PR monitor context:\n${q.slice(0, 1500)}\n\nReturn dated headlines with outlets and URLs.`,
        settings,
      )) || undefined
    )
  }

  return undefined
}

export const runSkill = createServerFn({ method: 'POST' })
  .validator(RunInput)
  .handler(async ({ data }) => {
    const skill = getSkill(data.slug)
    if (!skill) {
      return { ok: false as const, error: 'Unknown skill', output: '' }
    }

    const settings = resolveSettings(data.settings)
    const system = buildSystemPrompt(skill)
    let extra: string | undefined
    try {
      extra = await fetchToolContext(skill.slug, data.values, settings)
    } catch (e) {
      extra = `Tool context failed: ${e instanceof Error ? e.message : String(e)}`
    }
    const user = buildUserPrompt(skill, data.values, data.profile, extra)

    try {
      const { text, provider } = await callLlm(settings, system, user)
      return {
        ok: true as const,
        provider,
        output: text,
        usedMedialyst: Boolean(extra && extra.includes('Medialyst')),
        usedManus: Boolean(extra && extra.includes('Manus')),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        ok: false as const,
        error: msg,
        output: offlineDemoResult(skill, data.values),
      }
    }
  })

export const testLlmConnection = createServerFn({ method: 'POST' })
  .validator(z.object({ settings: SettingsPartial }))
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    try {
      const { text, provider } = await callLlm(
        settings,
        'Reply with exactly: ok',
        'ping',
      )
      return { ok: true as const, provider, sample: text.slice(0, 80) }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })
