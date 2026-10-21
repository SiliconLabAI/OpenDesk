import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { callLlm } from '~/lib/llm/client'
import { resolveSettings } from '~/lib/settings/resolve'
import {
  hasManusConfig,
  manusCreateTask,
  manusListMessages,
  extractManusResults,
} from '~/lib/manus/client'
import { searchNews } from '~/lib/medialyst/client'

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

export const researchFromWebsite = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      website: z.string().min(3),
      companyName: z.string().optional(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    let siteText = ''
    let newsBlock = ''

    const url = data.website.startsWith('http')
      ? data.website
      : `https://${data.website}`

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'NewsjackWeb/0.2 (+research)' },
        signal: AbortSignal.timeout(12000),
      })
      const html = await res.text()
      siteText = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12000)
    } catch (e) {
      siteText = `(Could not fetch site: ${e instanceof Error ? e.message : String(e)})`
    }

    if (settings.medialystApiKey) {
      const q = data.companyName || url
      const news = await searchNews(
        { query: q, limit: 8 },
        { apiKey: settings.medialystApiKey, baseUrl: settings.medialystApiBase },
      )
      if (news.ok) {
        newsBlock = news.articles
          .map(
            (a, i) =>
              `${i + 1}. ${a.title} (${a.outlet || '?'}) ${a.published_at || ''} ${a.url || ''}`,
          )
          .join('\n')
      }
    } else if (hasManusConfig({ apiKey: settings.manusApiKey || undefined })) {
      try {
        const task = await manusCreateTask(
          {
            title: `research profile: ${data.companyName || url}`,
            prompt: `Visit ${url} and summarize the company for a PR agent: product, ICP, competitors, spokespeople, beat topics. Also note any recent news headlines you find. Keep under 600 words.`,
            agentProfile: 'lite',
          },
          { apiKey: settings.manusApiKey || undefined },
        )
        await new Promise((r) => setTimeout(r, 10000))
        try {
          const msgs = await manusListMessages(task.task_id, 8, {
            apiKey: settings.manusApiKey || undefined,
          })
          newsBlock =
            extractManusResults(msgs).text ||
            `Manus task ${task.task_id} still running`
        } catch {
          newsBlock = `Manus research task started: ${task.task_id}`
        }
      } catch (e) {
        newsBlock = `Manus fallback failed: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    const system = `You build PR client profiles for newsjack.
From website text and optional news, produce a structured profile:
- Company name
- One-line product
- Standing (why journalists might care)
- Beat topics
- Competitors
- Likely spokespeople / roles
- Suggested monitor topics (5–10 keywords)
Do not invent funding amounts or customer counts not present in the sources.
Label uncertain fields as "unknown / needs confirmation".`

    const user = `Company hint: ${data.companyName || '(none)'}
Website: ${url}

## Website extract
${siteText || '(empty)'}

## News / research
${newsBlock || '(none)'}

Write the profile in markdown.`

    try {
      const { text, provider } = await callLlm(settings, system, user)
      return { ok: true as const, profile: text, provider, website: url }
    } catch (e) {
      return {
        ok: true as const,
        profile: `## Draft profile (LLM unavailable)\n\nWebsite: ${url}\n\n### Extract\n${siteText.slice(0, 2000)}\n\n### Research\n${newsBlock}\n\n_Error: ${e instanceof Error ? e.message : String(e)}_`,
        provider: 'offline',
        website: url,
      }
    }
  })

export const enrichSkillInputs = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      slug: z.string(),
      values: z.record(z.string()),
      profile: z.string().optional(),
      website: z.string().optional(),
      settings: SettingsPartial,
    }),
  )
  .handler(async ({ data }) => {
    const settings = resolveSettings(data.settings)
    let profile = data.profile || ''
    if (data.website?.trim() && !profile.trim()) {
      const r = await researchFromWebsite({
        data: {
          website: data.website,
          settings: data.settings,
        },
      })
      if (r.ok) profile = r.profile
    }

    const system = `You help prefill newsjack skill forms.
Given a client profile and partial inputs for skill "${data.slug}",
return ONLY a JSON object mapping input field ids to suggested string values.
Only fill fields that are empty. Do not invent hard facts without profile support.
Keys must be from: ${JSON.stringify(Object.keys(data.values))}`

    const user = `## Profile\n${profile || '(none)'}\n\n## Current values\n${JSON.stringify(data.values, null, 2)}\n\nReturn JSON only.`

    try {
      const { text } = await callLlm(settings, system, user)
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        return {
          ok: true as const,
          values: data.values,
          profile,
          filled: [] as string[],
        }
      }
      const parsed = JSON.parse(match[0]) as Record<string, string>
      const next = { ...data.values }
      const filled: string[] = []
      for (const [k, v] of Object.entries(parsed)) {
        if (
          k in next &&
          !next[k]?.trim() &&
          typeof v === 'string' &&
          v.trim()
        ) {
          next[k] = v
          filled.push(k)
        }
      }
      return { ok: true as const, values: next, profile, filled }
    } catch {
      return {
        ok: true as const,
        values: data.values,
        profile,
        filled: [] as string[],
      }
    }
  })
