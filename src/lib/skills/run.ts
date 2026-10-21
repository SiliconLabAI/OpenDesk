import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSkill } from './catalog'
import { buildSystemPrompt, buildUserPrompt, offlineDemoResult } from './prompts'
import {
  formatArticlesForPrompt,
  hasMedialystConfig,
  lookupJournalists,
  queryPrCalendar,
  searchNews,
} from '~/lib/medialyst/client'

const RunInput = z.object({
  slug: z.string(),
  values: z.record(z.string()),
  profile: z.string().optional(),
})

async function callOpenAI(system: string, user: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('no_openai')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`OpenAI error ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content?.trim() || 'Empty model response.'
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no_anthropic')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Anthropic error ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
  }
  const text = data.content
    ?.filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
  return text?.trim() || 'Empty model response.'
}

async function fetchToolContext(
  slug: string,
  values: Record<string, string>,
): Promise<string | undefined> {
  if (!hasMedialystConfig()) return undefined

  if (slug === 'news-search' || slug === 'story-origin-check') {
    const q = values.query || values.story || values.item || ''
    if (!q.trim()) return undefined
    const res = await searchNews({ query: q, limit: 15 })
    if (!res.ok) return `Medialyst news-search error: ${res.error}`
    return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
  }

  if (slug === 'pr-calendar') {
    const q = values.company || values.query || ''
    if (!q.trim()) return undefined
    const res = await queryPrCalendar({
      query: q,
      horizon: values.horizon,
    })
    if (!res.ok) return `Medialyst pr-calendar error: ${res.error}`
    return `### Medialyst PR calendar\n\`\`\`json\n${JSON.stringify(res.events, null, 2).slice(0, 8000)}\n\`\`\``
  }

  if (slug === 'find-journalists') {
    const brief = values.brief || ''
    const candidates = values.candidates || ''
    const res = await lookupJournalists({
      query: brief.slice(0, 500),
      names: candidates
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 10),
    })
    if (!res.ok) return `Medialyst journalists error: ${res.error}`
    return `### Medialyst journalist lookup\n\`\`\`json\n${JSON.stringify(res.journalists, null, 2).slice(0, 8000)}\n\`\`\``
  }

  if (slug === 'newsjack-detector' || slug === 'coverage-tracker') {
    const q =
      values.company ||
      values.keywords ||
      values.profile ||
      values.signals ||
      ''
    if (!q.trim()) return undefined
    const query = q.split('\n')[0].slice(0, 200)
    const res = await searchNews({ query, limit: 20 })
    if (!res.ok) return `Medialyst news-search error: ${res.error}`
    return `### Medialyst news results\n${formatArticlesForPrompt(res.articles)}`
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

    const system = buildSystemPrompt(skill)
    let extra: string | undefined
    try {
      extra = await fetchToolContext(skill.slug, data.values)
    } catch (e) {
      extra = `Tool context failed: ${e instanceof Error ? e.message : String(e)}`
    }
    const user = buildUserPrompt(skill, data.values, data.profile, extra)

    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const output = await callAnthropic(system, user)
        return {
          ok: true as const,
          provider: 'anthropic' as const,
          output,
          usedMedialyst: Boolean(extra && extra.includes('Medialyst')),
        }
      }
      if (process.env.OPENAI_API_KEY) {
        const output = await callOpenAI(system, user)
        return {
          ok: true as const,
          provider: 'openai' as const,
          output,
          usedMedialyst: Boolean(extra && extra.includes('Medialyst')),
        }
      }
      return {
        ok: true as const,
        provider: 'offline' as const,
        output: offlineDemoResult(skill, data.values),
        usedMedialyst: false,
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
