/**
 * Manus API v2 client — browser worker for press-clip / coverage-reel.
 */

const BASE = 'https://api.manus.ai'

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

export async function manusCreateTask(
  opts: {
    prompt: string
    title?: string
    connectors?: string[]
    agentProfile?: 'standard' | 'lite' | 'max'
    structuredOutputSchema?: Record<string, unknown>
    hideInTaskList?: boolean
  },
  ctx?: ManusCtx,
): Promise<ManusCreateTaskResult> {
  const body: Record<string, unknown> = {
    message: {
      content: opts.prompt,
      connectors: opts.connectors ?? [MANUS_PLAYWRIGHT_CONNECTOR],
    },
    agent_profile: opts.agentProfile ?? 'standard',
    interactive_mode: false,
    hide_in_task_list: opts.hideInTaskList ?? true,
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
  const res = await fetch(url, {
    headers: { 'x-manus-api-key': resolveKey(ctx) },
  })
  if (!res.ok) {
    throw new Error(`Manus listMessages failed (${res.status})`)
  }
  return res.json()
}

export async function manusRegisterWebhook(
  callbackUrl: string,
  ctx?: ManusCtx,
) {
  const res = await fetch(`${BASE}/v2/webhook.create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-manus-api-key': resolveKey(ctx),
    },
    body: JSON.stringify({ url: callbackUrl }),
  })
  const data = await res.json()
  if (!res.ok || data.ok === false) {
    throw new Error(
      data.error?.message || `Manus webhook.create failed (${res.status})`,
    )
  }
  return data
}

export async function manusPublicKey(ctx?: ManusCtx): Promise<string> {
  const res = await fetch(`${BASE}/v2/webhook.publicKey`, {
    headers: { 'x-manus-api-key': resolveKey(ctx) },
  })
  if (!res.ok) throw new Error('Failed to fetch Manus webhook public key')
  const data = await res.json()
  return data.public_key || data.publicKey || data.key || JSON.stringify(data)
}

export function extractManusResults(messagesPayload: unknown): {
  text: string
  fileUrls: string[]
} {
  const fileUrls: string[] = []
  const texts: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const o = node as Record<string, unknown>
    if (typeof o.fileUrl === 'string') fileUrls.push(o.fileUrl)
    if (typeof o.file_url === 'string') fileUrls.push(o.file_url)
    if (
      typeof o.url === 'string' &&
      /\.(pdf|mp4|webm|png|jpg)(\?|$)/i.test(o.url)
    ) {
      fileUrls.push(o.url)
    }
    if (typeof o.text === 'string' && o.text.length > 40) texts.push(o.text)
    if (typeof o.content === 'string' && o.content.length > 40)
      texts.push(o.content)
    Object.values(o).forEach(walk)
  }
  walk(messagesPayload)
  return {
    text: texts[0] || '',
    fileUrls: [...new Set(fileUrls)],
  }
}
