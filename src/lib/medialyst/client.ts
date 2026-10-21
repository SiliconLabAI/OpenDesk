/**
 * Medialyst public REST API client.
 * Docs: https://medialyst.ai/docs/developers/mcp-agent-skill
 * Base: https://api.medialyst.ai (or as configured)
 */

const BASE =
  process.env.MEDIALYST_API_BASE?.replace(/\/$/, '') ||
  'https://api.medialyst.ai'

function apiKey(): string | null {
  return process.env.MEDIALYST_API_KEY || null
}

export function hasMedialystConfig(): boolean {
  return Boolean(apiKey())
}

async function medialystFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const key = apiKey()
  if (!key) {
    return { ok: false, error: 'MEDIALYST_API_KEY not set', status: 0 }
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers || {}),
      },
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message: string }).message)
          : text.slice(0, 200)
      return { ok: false, error: msg || `HTTP ${res.status}`, status: res.status }
    }
    return { ok: true, data: data as T }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      status: 0,
    }
  }
}

export type NewsArticle = {
  title?: string
  url?: string
  outlet?: string
  author?: string
  published_at?: string
  snippet?: string
  [key: string]: unknown
}

/** POST /api/v1/news/search */
export async function searchNews(opts: {
  query: string
  limit?: number
  recency?: string
}): Promise<{ ok: true; articles: NewsArticle[]; raw: unknown } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: opts.limit ?? 20,
  }
  if (opts.recency) body.recency = opts.recency

  const res = await medialystFetch<unknown>('/api/v1/news/search', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) return { ok: false, error: res.error }

  const raw = res.data
  const articles = normalizeArticles(raw)
  return { ok: true, articles, raw }
}

/** POST /api/v1/pr-calendar/query */
export async function queryPrCalendar(opts: {
  query: string
  horizon?: string
}): Promise<{ ok: true; events: unknown[]; raw: unknown } | { ok: false; error: string }> {
  const res = await medialystFetch<unknown>('/api/v1/pr-calendar/query', {
    method: 'POST',
    body: JSON.stringify({
      query: opts.query,
      horizon: opts.horizon,
    }),
  })
  if (!res.ok) return { ok: false, error: res.error }
  const raw = res.data as { events?: unknown[]; data?: unknown[] }
  const events = raw.events || raw.data || (Array.isArray(raw) ? raw : [])
  return { ok: true, events: events as unknown[], raw }
}

/** POST /api/v1/journalists/enrich or lookup */
export async function lookupJournalists(opts: {
  query?: string
  names?: string[]
  article_url?: string
}): Promise<{ ok: true; journalists: unknown[]; raw: unknown } | { ok: false; error: string }> {
  const res = await medialystFetch<unknown>('/api/v1/journalists/lookup', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    // fallback enrich
    const res2 = await medialystFetch<unknown>('/api/v1/journalists/enrich', {
      method: 'POST',
      body: JSON.stringify(opts),
    })
    if (!res2.ok) return { ok: false, error: res2.error }
    return {
      ok: true,
      journalists: normalizeList(res2.data),
      raw: res2.data,
    }
  }
  return { ok: true, journalists: normalizeList(res.data), raw: res.data }
}

function normalizeList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (Array.isArray(o.journalists)) return o.journalists
    if (Array.isArray(o.data)) return o.data
    if (Array.isArray(o.results)) return o.results
  }
  return []
}

function normalizeArticles(raw: unknown): NewsArticle[] {
  if (Array.isArray(raw)) return raw as NewsArticle[]
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const k of ['articles', 'results', 'data', 'items']) {
      if (Array.isArray(o[k])) return o[k] as NewsArticle[]
    }
  }
  return []
}

export function formatArticlesForPrompt(articles: NewsArticle[]): string {
  if (!articles.length) return '(no articles returned)'
  return articles
    .slice(0, 25)
    .map((a, i) => {
      const parts = [
        `${i + 1}. ${a.title || '(no title)'}`,
        a.outlet ? `   Outlet: ${a.outlet}` : null,
        a.author ? `   Author: ${a.author}` : null,
        a.published_at ? `   Published: ${a.published_at}` : null,
        a.url ? `   URL: ${a.url}` : null,
        a.snippet ? `   ${String(a.snippet).slice(0, 200)}` : null,
      ]
      return parts.filter(Boolean).join('\n')
    })
    .join('\n\n')
}
