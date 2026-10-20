import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSkill } from './catalog'
import { buildSystemPrompt, buildUserPrompt, offlineDemoResult } from './prompts'

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
  const text = data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
  return text?.trim() || 'Empty model response.'
}

export const runSkill = createServerFn({ method: 'POST' })
  .validator(RunInput)
  .handler(async ({ data }) => {
    const skill = getSkill(data.slug)
    if (!skill) {
      return { ok: false as const, error: 'Unknown skill', output: '' }
    }

    const system = buildSystemPrompt(skill)
    const user = buildUserPrompt(skill, data.values, data.profile)

    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const output = await callAnthropic(system, user)
        return { ok: true as const, provider: 'anthropic' as const, output }
      }
      if (process.env.OPENAI_API_KEY) {
        const output = await callOpenAI(system, user)
        return { ok: true as const, provider: 'openai' as const, output }
      }
      return {
        ok: true as const,
        provider: 'offline' as const,
        output: offlineDemoResult(skill, data.values),
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
