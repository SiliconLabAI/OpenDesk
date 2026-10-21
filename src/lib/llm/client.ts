import type { ProviderSettings } from '~/lib/settings/types'

export type LlmCallResult = {
  text: string
  provider: string
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

/** OpenAI Chat Completions API (official or compatible). */
export async function callChatCompletions(opts: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  user: string
  temperature?: number
}): Promise<string> {
  const base = normalizeBaseUrl(opts.baseUrl)
  const url = base.endsWith('/v1')
    ? `${base}/chat/completions`
    : `${base}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature ?? 0.4,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`LLM ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content?.trim() || 'Empty model response.'
}

export async function callAnthropic(opts: {
  apiKey: string
  model: string
  system: string
  user: string
}): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>
  }
  return (
    data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim() || 'Empty model response.'
  )
}

/**
 * Route to preferred provider. Order for `auto`:
 * openai_compatible (if enabled) → anthropic → openai
 */
export async function callLlm(
  settings: ProviderSettings,
  system: string,
  user: string,
): Promise<LlmCallResult> {
  const pref = settings.preferredLlm

  const tryCompatible = async () => {
    if (
      !settings.openaiCompatibleEnabled &&
      !settings.openaiCompatibleBaseUrl
    ) {
      throw new Error('openai_compatible_disabled')
    }
    if (!settings.openaiCompatibleBaseUrl) {
      throw new Error('openai_compatible_missing_base')
    }
    const text = await callChatCompletions({
      baseUrl: settings.openaiCompatibleBaseUrl,
      apiKey: settings.openaiCompatibleApiKey,
      model: settings.openaiCompatibleModel || 'gpt-4o-mini',
      system,
      user,
    })
    return { text, provider: 'openai_compatible' as const }
  }

  const tryAnthropic = async () => {
    if (!settings.anthropicApiKey) throw new Error('no_anthropic')
    const text = await callAnthropic({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      system,
      user,
    })
    return { text, provider: 'anthropic' as const }
  }

  const tryOpenai = async () => {
    if (!settings.openaiApiKey) throw new Error('no_openai')
    const text = await callChatCompletions({
      baseUrl: settings.openaiBaseUrl || 'https://api.openai.com/v1',
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
      system,
      user,
    })
    return { text, provider: 'openai' as const }
  }

  if (pref === 'openai_compatible') return tryCompatible()
  if (pref === 'anthropic') return tryAnthropic()
  if (pref === 'openai') return tryOpenai()

  // auto
  const errors: string[] = []
  if (settings.openaiCompatibleEnabled && settings.openaiCompatibleBaseUrl) {
    try {
      return await tryCompatible()
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (settings.anthropicApiKey) {
    try {
      return await tryAnthropic()
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (settings.openaiApiKey) {
    try {
      return await tryOpenai()
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  throw new Error(
    errors.length
      ? `No LLM succeeded: ${errors.join('; ')}`
      : 'No LLM API keys configured. Open Settings to add Anthropic, OpenAI, or an OpenAI-compatible endpoint.',
  )
}
