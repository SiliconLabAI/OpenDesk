/**
 * Manus API v2 client — agent tasks (like Grok/Manus web agents).
 * Research uses the built-in agent only (no Playwright/connectors required).
 * Optional connectors can be passed explicitly for browser jobs if the user has them.
 */

const BASE = 'https://api.manus.ai'

/** @deprecated Playwright is optional — only pass when user has it installed */
export const MANUS_PLAYWRIGHT_CONNECTOR = '356d5bc1-fb9f-4fa1-babb-05039dc09d63'

export type ManusCtx = { apiKey?: string }

export type ManusCreateTaskResult = {
  ok: boolean
  request_id?: string
  task_id: string
  task_title?: string
  task_url?: string
  share_url?: string
  error?: { code: string; message: string }
}

export type ManusWebhookEnvelope = {
  event_id: string
  event_type: string
  task_detail?: {
    task_id: string
    task_title?: string
    task_url?: string
    agent_status?: string
    status?: string
  }
  task_id?: string
  [key: string]: unknown
}

function resolveKey(ctx?: ManusCtx): string {
  const k = ctx?.apiKey || process.env.MANUS_API_KEY
  if (!k) throw new Error('MANUS_API_KEY is not set (add it in Settings or env)')
  return k
}

export function hasManusConfig(ctx?: ManusCtx): boolean {
  return Boolean(ctx?.apiKey || process.env.MANUS_API_KEY)
}

/**
 * Create a Manus agent task.
 *
 * By default: no connectors (clear_connectors: true) — the agent handles web
 * research itself. Only pass `connectors` if you explicitly need Gmail/Slack/etc.
 */
export async function manusCreateTask(
  opts: {
    prompt: string
    title?: string
    /** Optional connector UUIDs. Omit for pure agent research. */
    connectors?: string[]
    agentProfile?: 'standard' | 'lite' | 'max'
    structuredOutputSchema?: Record<string, unknown>
    hideInTaskList?: boolean
    /** When true (default if no connectors), do not load account default connectors */
    clearConnectors?: boolean
  },
  ctx?: ManusCtx,
): Promise<ManusCreateTaskResult> {
  const hasConnectors = Boolean(opts.connectors && opts.connectors.length > 0)
  const clearConnectors =
    opts.clearConnectors !== undefined
      ? opts.clearConnectors
      : !hasConnectors

  const message: Record<string, unknown> = {
    // API accepts string content for simple agent prompts
    content: opts.prompt,
  }
  if (hasConnectors) {
    message.connectors = opts.connectors
  }

  const body: Record<string, unknown> = {
    message,
    agent_profile: opts.agentProfile ?? 'standard',
    interactive_mode: false,
    hide_in_task_list: opts.hideInTaskList ?? true,
  }
  // Start without connectors so Playwright/etc. is never required
  if (clearConnectors && !hasConnectors) {
    body.clear_connectors = true
  }
  if (opts.title) body.title = opts.title
  if (opts.structuredOutputSchema) {
    body.structured_output_schema = opts.structuredOutputSchema
  }

  const res = await fetch(`${BASE}/v2/task.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-manus-api-key': resolveKey(ctx),
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as ManusCreateTaskResult
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus task.create failed (${res.status})`,
    )
  }
  return data
}

export async function manusListMessages(
  taskId: string,
  limit = 20,
  ctx?: ManusCtx,
) {
  const url = new URL(`${BASE}/v2/task.listMessages`)
  url.searchParams.set('task_id', taskId)
  url.searchParams.set('order', 'desc')
  url.searchParams.set('limit', String(limit))
  const res = await fetch(url.toString(), {
    headers: { 'x-manus-api-key': resolveKey(ctx) },
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus listMessages failed (${res.status})`,
    )
  }
  return data
}

export async function manusGetTask(taskId: string, ctx?: ManusCtx) {
  const url = new URL(`${BASE}/v2/task.detail`)
  url.searchParams.set('task_id', taskId)
  const res = await fetch(url.toString(), {
    headers: { 'x-manus-api-key': resolveKey(ctx) },
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus task.detail failed (${res.status})`,
    )
  }
  return data
}

/** Extract assistant text (+ optional file urls) from listMessages response */
export function extractManusResults(listMessagesResponse: unknown): {
  text: string
  fileUrls: string[]
} {
  const data = listMessagesResponse as {
    messages?: Array<{
      role?: string
      content?: unknown
      parts?: unknown
    }>
  }
  const messages = data.messages || []
  const texts: string[] = []
  const fileUrls: string[] = []

  const walk = (node: unknown) => {
    if (node == null) return
    if (typeof node === 'string') {
      texts.push(node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>
      if (typeof o.text === 'string') texts.push(o.text)
      if (typeof o.content === 'string') texts.push(o.content)
      if (typeof o.url === 'string' && /^https?:/i.test(o.url)) {
        fileUrls.push(o.url)
      }
      if (typeof o.file_url === 'string') fileUrls.push(o.file_url as string)
      for (const v of Object.values(o)) {
        if (v && typeof v === 'object') walk(v)
      }
    }
  }

  for (const m of messages) {
    const role = (m.role || '').toLowerCase()
    if (role === 'user' || role === 'human') continue
    walk(m.content)
    walk(m.parts)
  }

  return {
    text: texts.filter(Boolean).join('\n\n').trim(),
    fileUrls: [...new Set(fileUrls)],
  }
}

/**
 * Create task and poll until assistant text appears or timeout.
 * Prefer webhooks for long jobs; this is for chat/skill sync research.
 */
export async function manusRunAndWait(
  opts: {
    prompt: string
    title?: string
    agentProfile?: 'standard' | 'lite' | 'max'
    /** total wait ms (default 45s) */
    timeoutMs?: number
    /** poll interval ms */
    intervalMs?: number
  },
  ctx?: ManusCtx,
): Promise<{
  taskId: string
  taskUrl?: string
  text: string
  fileUrls: string[]
  timedOut: boolean
}> {
  const task = await manusCreateTask(
    {
      prompt: opts.prompt,
      title: opts.title,
      agentProfile: opts.agentProfile ?? 'lite',
      clearConnectors: true,
    },
    ctx,
  )

  const timeoutMs = opts.timeoutMs ?? 45_000
  const intervalMs = opts.intervalMs ?? 4_000
  const started = Date.now()
  let text = ''
  let fileUrls: string[] = []

  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      const msgs = await manusListMessages(task.task_id, 20, ctx)
      const extracted = extractManusResults(msgs)
      if (extracted.text && extracted.text.length > 40) {
        text = extracted.text
        fileUrls = extracted.fileUrls
        break
      }
    } catch {
      /* keep polling */
    }
  }

  return {
    taskId: task.task_id,
    taskUrl: task.task_url,
    text,
    fileUrls,
    timedOut: !text,
  }
}

export async function manusRegisterWebhook(
  url: string,
  events: string[],
  ctx?: ManusCtx,
) {
  const res = await fetch(`${BASE}/v2/webhook.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-manus-api-key': resolveKey(ctx),
    },
    body: JSON.stringify({ url, events }),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus webhook.create failed (${res.status})`,
    )
  }
  return data
}

export async function verifyManusWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.MANUS_WEBHOOK_SECRET
  if (!secret) return true // no secret configured — accept
  if (!signatureHeader) return false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(rawBody),
    )
    const hex = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return (
      signatureHeader === hex ||
      signatureHeader === `sha256=${hex}` ||
      signatureHeader.toLowerCase().includes(hex)
    )
  } catch {
    return false
  }
}
