import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { doctrineFor } from '~/lib/skills/doctrine'
import {
  formatArticlesForPrompt,
  hasMedialystConfig,
  searchNews,
} from '~/lib/medialyst/client'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001'

async function callLlm(system: string, user: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
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
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    return (
      data.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim() || ''
    )
  }
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenAI ${res.status}`)
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content?.trim() || ''
  }
  throw new Error('No ANTHROPIC_API_KEY or OPENAI_API_KEY configured')
}

function fingerprint(title: string, url?: string): string {
  const base = `${(url || '').toLowerCase().trim()}|${title.toLowerCase().trim()}`
  // simple stable hash
  let h = 0
  for (let i = 0; i < base.length; i++) h = (Math.imul(31, h) + base.charCodeAt(i)) | 0
  return `fp_${Math.abs(h).toString(36)}_${base.slice(0, 40).replace(/\W+/g, '_')}`
}

/**
 * Full Mode detector pass for one monitor:
 * news fetch → coarse filter → triage/judge → persist seen_signals + job
 */
export async function runDetectorForMonitor(monitorId: string): Promise<{
  ok: boolean
  jobId?: string
  output?: string
  error?: string
  newSignals?: number
}> {
  if (!hasSupabaseConfig()) {
    return { ok: false, error: 'Supabase not configured' }
  }
  const sb = getServiceSupabase()

  const { data: monitor, error: mErr } = await sb
    .from('monitors')
    .select('*, clients(*)')
    .eq('id', monitorId)
    .single()
  if (mErr || !monitor) {
    return { ok: false, error: mErr?.message || 'Monitor not found' }
  }

  const client = monitor.clients as {
    name?: string
    standing?: string
    beats?: string
    competitors?: string
  } | null

  const topics: string[] = monitor.topics?.length
    ? monitor.topics
    : [client?.name || monitor.title].filter(Boolean)

  // 1) Fetch news per topic
  const allArticles: Array<{
    title: string
    url?: string
    outlet?: string
    published_at?: string
    snippet?: string
  }> = []
  let newsSource = 'none'

  if (hasMedialystConfig()) {
    newsSource = 'medialyst'
    for (const topic of topics.slice(0, 5)) {
      const res = await searchNews({ query: topic, limit: 15, recency: '7d' })
      if (res.ok) {
        for (const a of res.articles) {
          if (a.title) {
            allArticles.push({
              title: a.title,
              url: a.url,
              outlet: a.outlet,
              published_at: a.published_at,
              snippet: a.snippet,
            })
          }
        }
      }
    }
  }

  // Dedupe against seen_signals
  const { data: seenRows } = await sb
    .from('seen_signals')
    .select('fingerprint')
    .eq('org_id', monitor.org_id)
    .eq('monitor_id', monitorId)
    .limit(5000)

  const seen = new Set((seenRows || []).map((r: { fingerprint: string }) => r.fingerprint))
  const fresh = allArticles.filter((a) => {
    const fp = fingerprint(a.title, a.url)
    return !seen.has(fp)
  })

  // 2–3) Coarse filter + triage via LLM
  const profileBlock = [
    `Client: ${client?.name || 'unknown'}`,
    client?.standing ? `Standing:\n${client.standing}` : null,
    client?.beats ? `Beats:\n${client.beats}` : null,
    client?.competitors ? `Competitors:\n${client.competitors}` : null,
    `Monitor topics: ${topics.join(', ')}`,
    `News source: ${newsSource}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const headlinesBlock =
    fresh.length > 0
      ? formatArticlesForPrompt(fresh)
      : allArticles.length > 0
        ? '(all fetched articles already seen)\n' + formatArticlesForPrompt(allArticles.slice(0, 10))
        : '(no articles fetched — Medialyst not configured or empty results; judge any user-pasted context only)'

  const system = doctrineFor('newsjack-detector')
  const user = `## Client / monitor profile
${profileBlock}

## Candidate signals (fresh first)
${headlinesBlock}

Run coarse relevance + triage + detector judgment. Persist-ready: list each signal with fingerprint-friendly title/url and verdict.`

  let outputText: string
  try {
    outputText = await callLlm(system, user)
  } catch (e) {
    outputText = `## Detector offline scaffold\n\n${e instanceof Error ? e.message : String(e)}\n\n### Candidates\n${headlinesBlock}`
  }

  // 4) Persist job + mark seen
  const { data: job, error: jErr } = await sb
    .from('jobs')
    .insert({
      org_id: monitor.org_id,
      client_id: monitor.client_id,
      monitor_id: monitorId,
      kind: 'detector_run',
      skill_slug: 'newsjack-detector',
      status: 'completed',
      input: {
        monitor_id: monitorId,
        topics,
        news_source: newsSource,
        candidate_count: fresh.length,
      },
      output_text: outputText,
      output: {
        news_source: newsSource,
        fresh_count: fresh.length,
        total_fetched: allArticles.length,
      },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (jErr) {
    return { ok: false, error: jErr.message, output: outputText }
  }

  let newSignals = 0
  for (const a of fresh.slice(0, 50)) {
    const fp = fingerprint(a.title, a.url)
    const { error } = await sb.from('seen_signals').upsert(
      {
        org_id: monitor.org_id,
        monitor_id: monitorId,
        fingerprint: fp,
        title: a.title,
        url: a.url || null,
        first_public_at: a.published_at || null,
      },
      { onConflict: 'org_id,fingerprint' },
    )
    if (!error) newSignals++
  }

  await sb
    .from('monitors')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', monitorId)

  // Optional Slack
  await maybeSlackNotify(monitor.org_id, monitor.title, outputText)

  return {
    ok: true,
    jobId: job.id,
    output: outputText,
    newSignals,
  }
}

async function maybeSlackNotify(orgId: string, title: string, body: string) {
  if (!hasSupabaseConfig()) return
  const sb = getServiceSupabase()
  const { data: secret } = await sb
    .from('secrets')
    .select('value_ciphertext')
    .eq('org_id', orgId)
    .eq('name', 'slack_webhook')
    .maybeSingle()
  const url = secret?.value_ciphertext
  if (!url || !url.startsWith('https://')) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*Newsjack detector — ${title}*\n${body.slice(0, 3500)}`,
      }),
    })
  } catch {
    // ignore
  }
}

export const runDetectorJob = createServerFn({ method: 'POST' })
  .validator(z.object({ monitorId: z.string().uuid() }))
  .handler(async ({ data }) => runDetectorForMonitor(data.monitorId))

export const runAllEnabledMonitors = createServerFn({ method: 'POST' })
  .validator(z.object({ cronSecret: z.string().optional() }))
  .handler(async ({ data }) => {
    const expected = process.env.CRON_SECRET
    if (expected && data.cronSecret !== expected) {
      return { ok: false as const, error: 'Unauthorized', results: [] }
    }
    if (!hasSupabaseConfig()) {
      return { ok: false as const, error: 'No Supabase', results: [] }
    }
    const sb = getServiceSupabase()
    const { data: monitors } = await sb
      .from('monitors')
      .select('id')
      .eq('enabled', true)
      .limit(50)
    const results = []
    for (const m of monitors || []) {
      results.push(await runDetectorForMonitor(m.id))
    }
    return { ok: true as const, results }
  })
