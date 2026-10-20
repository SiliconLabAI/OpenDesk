import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getServiceSupabase, hasSupabaseConfig } from '~/lib/supabase/server'

const listMonitors = createServerFn({ method: 'GET' }).handler(async () => {
  if (!hasSupabaseConfig()) {
    return { ok: false as const, monitors: [], error: 'Supabase not configured' }
  }
  const sb = getServiceSupabase()
  const { data, error } = await sb
    .from('monitors')
    .select('*, clients(name)')
    .order('created_at', { ascending: false })
  if (error) return { ok: false as const, monitors: [], error: error.message }
  return { ok: true as const, monitors: data || [] }
})

const createMonitor = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      title: z.string().min(1),
      slug: z.string().min(1),
      topics: z.string(),
      scheduleCron: z.string().default('0 9 * * *'),
      clientName: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    if (!hasSupabaseConfig()) {
      return { ok: false as const, error: 'Supabase not configured' }
    }
    const orgId = process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001'
    const sb = getServiceSupabase()
    await sb.from('orgs').upsert({ id: orgId, name: 'Default' }, { onConflict: 'id' })

    const clientSlug = data.clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const { data: client, error: cErr } = await sb
      .from('clients')
      .upsert(
        {
          org_id: orgId,
          slug: clientSlug,
          name: data.clientName,
        },
        { onConflict: 'org_id,slug' },
      )
      .select('id')
      .single()
    if (cErr) return { ok: false as const, error: cErr.message }

    const topics = data.topics
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean)

    const { error } = await sb.from('monitors').insert({
      org_id: orgId,
      client_id: client.id,
      slug: data.slug,
      title: data.title,
      topics,
      schedule_cron: data.scheduleCron,
      enabled: true,
    })
    if (error) return { ok: false as const, error: error.message }
    return { ok: true as const }
  })

export const Route = createFileRoute('/monitors/')({
  loader: () => listMonitors(),
  component: MonitorsPage,
})

function MonitorsPage() {
  const data = Route.useLoaderData()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [clientName, setClientName] = useState('')
  const [topics, setTopics] = useState('')
  const [msg, setMsg] = useState('')

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    const res = await createMonitor({
      data: {
        title,
        slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        topics,
        clientName,
        scheduleCron: '0 9 * * *',
      },
    })
    setMsg(res.ok ? 'Monitor saved.' : res.error || 'Failed')
    if (res.ok) window.location.reload()
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Monitors</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Full Mode monitoring profiles (newsjack-monitor-setup). Persist topics and schedule
          in Supabase; wire cron to enqueue detector jobs.
        </p>
      </div>

      {!data.ok && (
        <p className="text-sm text-[var(--muted)]">{data.error}</p>
      )}

      <ul className="space-y-2">
        {(data.monitors || []).map((m: {
          id: string
          title: string
          slug: string
          enabled: boolean
          schedule_cron: string
          topics: string[]
          clients?: { name: string } | null
        }) => (
          <li
            key={m.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <div className="font-medium">
              {m.title}{' '}
              <span className="text-xs text-[var(--muted)]">/{m.slug}</span>
            </div>
            <div className="text-sm text-[var(--muted)] mt-1">
              Client: {m.clients?.name || '—'} · cron {m.schedule_cron} ·{' '}
              {m.enabled ? 'enabled' : 'paused'}
            </div>
            <div className="text-xs text-[var(--muted)] mt-1">
              Topics: {(m.topics || []).join(', ') || '—'}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={onCreate} className="space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h2 className="font-semibold">New monitor</h2>
        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          placeholder="Client name"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          required
        />
        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          placeholder="Monitor title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          placeholder="slug (optional)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <textarea
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm min-h-[5rem]"
          placeholder="Topics (comma or newline separated)"
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
        />
        <button
          type="submit"
          className="rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          Save monitor
        </button>
        {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
      </form>
    </div>
  )
}
