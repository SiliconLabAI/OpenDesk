import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { clearAppLogs, listAppLogs } from '~/lib/logs/write'

export const Route = createFileRoute('/logs')({
  component: LogsPage,
})

type LogRow = {
  id: string
  level: string
  source: string
  kind: string
  message: string
  request: Record<string, unknown>
  response: Record<string, unknown>
  meta: Record<string, unknown>
  duration_ms: number | null
  error: string | null
  created_at: string
}

function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([])
  const [error, setError] = useState('')
  const [kind, setKind] = useState('')
  const [level, setLevel] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const res = await listAppLogs({
        data: {
          limit: 150,
          kind: kind || undefined,
          level: level || undefined,
        },
      })
      if (!res || !res.ok) {
        setError((res && res.error) || 'Failed to load logs')
        setLogs([])
      } else {
        setError('')
        setLogs((res.logs || []) as LogRow[])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [kind, level])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            LLM, Manus, chat, and skill API traces stored in Supabase{' '}
            <code className="text-xs">app_logs</code>. Apply migration{' '}
            <code className="text-xs">005_app_logs.sql</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">All kinds</option>
            <option value="llm">llm</option>
            <option value="manus">manus</option>
            <option value="chat">chat</option>
            <option value="skill">skill</option>
            <option value="medialyst">medialyst</option>
            <option value="webhook">webhook</option>
          </select>
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">All levels</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
            <option value="debug">debug</option>
          </select>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            {busy ? '…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-red-400"
            onClick={async () => {
              if (!confirm('Clear all logs for this org?')) return
              await clearAppLogs()
              void refresh()
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 border border-red-900/40 rounded-lg p-3">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {logs.map((log) => {
          const isOpen = openId === log.id
          const levelColor =
            log.level === 'error'
              ? 'text-red-400'
              : log.level === 'warn'
                ? 'text-amber-400'
                : 'text-[var(--muted)]'
          return (
            <li
              key={log.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
            >
              <button
                type="button"
                className="w-full text-left px-4 py-3 flex flex-wrap gap-x-3 gap-y-1 items-center text-sm"
                onClick={() => setOpenId(isOpen ? null : log.id)}
              >
                <span className={`font-mono text-xs uppercase ${levelColor}`}>
                  {log.level}
                </span>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                  {log.kind}
                </span>
                <span className="text-xs text-[var(--muted)]">{log.source}</span>
                <span className="flex-1 min-w-[8rem] truncate">{log.message}</span>
                {log.duration_ms != null && (
                  <span className="text-xs text-[var(--muted)]">
                    {log.duration_ms}ms
                  </span>
                )}
                <span className="text-xs text-[var(--muted)]">
                  {new Date(log.created_at).toLocaleString()}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-[var(--border)] px-4 py-3 space-y-2 text-xs font-mono">
                  {log.error && (
                    <div className="text-red-400 whitespace-pre-wrap">
                      {log.error}
                    </div>
                  )}
                  <div>
                    <div className="text-[var(--muted)] mb-1">request</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap bg-[var(--bg)] p-2 rounded-lg">
                      {JSON.stringify(log.request, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="text-[var(--muted)] mb-1">response</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap bg-[var(--bg)] p-2 rounded-lg">
                      {JSON.stringify(log.response, null, 2)}
                    </pre>
                  </div>
                  {log.meta && Object.keys(log.meta).length > 0 && (
                    <div>
                      <div className="text-[var(--muted)] mb-1">meta</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap bg-[var(--bg)] p-2 rounded-lg">
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {!logs.length && !error && (
          <p className="text-sm text-[var(--muted)]">No logs yet.</p>
        )}
      </ul>
    </div>
  )
}
