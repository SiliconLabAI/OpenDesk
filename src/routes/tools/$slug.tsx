import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { getSkill, CATEGORIES } from '~/lib/skills/catalog'
import { runSkill } from '~/lib/skills/run'
import { loadProfile, profileToPromptBlock } from '~/lib/profile'
import {
  startCoverageReelJob,
  startPressClipJob,
} from '~/lib/jobs/browser'

export const Route = createFileRoute('/tools/$slug')({
  component: ToolPage,
})

function ToolPage() {
  const { slug } = Route.useParams()
  const skill = getSkill(slug)

  if (!skill) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Unknown skill</h1>
        <Link to="/tools" className="text-[var(--accent-dim)] underline">
          Back to skills
        </Link>
      </div>
    )
  }

  const cat = CATEGORIES[skill.category]
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(skill.inputs.map((i) => [i.id, ''])),
  )
  const [output, setOutput] = useState('')
  const [provider, setProvider] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [jobMeta, setJobMeta] = useState<{
    jobId?: string | null
    manusTaskUrl?: string
  } | null>(null)

  const canSubmit = useMemo(
    () =>
      skill.inputs
        .filter((i) => i.required)
        .every((i) => values[i.id]?.trim()),
    [skill.inputs, values],
  )

  async function onRun(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    setOutput('')
    setProvider(null)
    setJobMeta(null)
    try {
      // Full Mode browser workers → Manus + webhook
      if (skill.browserWorker && skill.slug === 'press-clip') {
        const res = await startPressClipJob({
          data: {
            url: values.url,
            mention: values.mention,
            brandNotes: profileToPromptBlock(loadProfile()) || undefined,
          },
        })
        if (!res.ok) {
          setError(res.error || 'Failed to start Manus job')
        } else {
          setProvider('manus')
          setJobMeta({ jobId: res.jobId, manusTaskUrl: res.manusTaskUrl })
          setOutput(
            [
              '## Press-clip job started (Manus)',
              '',
              res.message,
              res.jobId ? `Job id: \`${res.jobId}\`` : '',
              res.manusTaskId ? `Manus task: \`${res.manusTaskId}\`` : '',
              '',
              'When Manus finishes, the webhook at `/api/webhooks/manus` updates the job and attaches artifact URLs. Track progress under **Runs**.',
            ]
              .filter(Boolean)
              .join('\n'),
          )
        }
        return
      }

      if (skill.browserWorker && skill.slug === 'coverage-reel') {
        const res = await startCoverageReelJob({
          data: {
            notes: values.notes,
            brandNotes: profileToPromptBlock(loadProfile()) || undefined,
          },
        })
        if (!res.ok) {
          setError(res.error || 'Failed to start Manus job')
        } else {
          setProvider('manus')
          setJobMeta({ jobId: res.jobId, manusTaskUrl: res.manusTaskUrl })
          setOutput(
            [
              '## Coverage-reel job started (Manus)',
              '',
              res.message,
              res.jobId ? `Job id: \`${res.jobId}\`` : '',
              '',
              'Results arrive via webhook when the browser worker completes.',
            ]
              .filter(Boolean)
              .join('\n'),
          )
        }
        return
      }

      const profile = profileToPromptBlock(loadProfile())
      const res = await runSkill({
        data: { slug: skill.slug, values, profile: profile || undefined },
      })
      if (res.ok) {
        setOutput(res.output)
        setProvider(res.provider)
      } else {
        setError(res.error || 'Failed')
        setOutput(res.output)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="space-y-2">
        <Link
          to="/tools"
          search={{ cat: skill.category }}
          className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          ← {cat.label}
        </Link>
        <div className="flex items-start gap-3">
          <span className="text-3xl">{skill.icon}</span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{skill.name}</h1>
            <p className="mt-1 text-[var(--muted)]">{skill.description}</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              <span className="text-[var(--text)]">When:</span> {skill.whenToUse}
            </p>
          </div>
        </div>
        {(skill.localOnly || skill.needsNewsApi || skill.browserWorker) && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
            {skill.browserWorker
              ? 'Full Mode browser job: Manus Playwright connector runs the capture; results land via webhook on /api/webhooks/manus.'
              : skill.localOnly
                ? 'This skill is local-agent only in classic Full Mode. Prefer monitors + Manus for cloud Full Mode, or curl -fsSL newsjack.sh | bash.'
                : 'Best quality with a live news index (Medialyst). Without it, paste articles and timestamps yourself for reduced-coverage judgment.'}
          </div>
        )}
      </div>

      <form onSubmit={onRun} className="space-y-4">
        {skill.inputs.map((input) => (
          <label key={input.id} className="block space-y-1.5">
            <span className="text-sm font-medium">
              {input.label}
              {input.required ? (
                <span className="text-[var(--danger)]"> *</span>
              ) : null}
            </span>
            {input.type === 'textarea' ? (
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-dim)] min-h-[6rem]"
                rows={input.rows ?? 4}
                placeholder={input.placeholder}
                value={values[input.id] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [input.id]: e.target.value }))
                }
              />
            ) : (
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-dim)]"
                placeholder={input.placeholder}
                value={values[input.id] ?? ''}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [input.id]: e.target.value }))
                }
              />
            )}
          </label>
        ))}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={!canSubmit || busy}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#0a0a0b' }}
          >
            {busy
              ? 'Running…'
              : skill.browserWorker
                ? `Start Manus /${skill.slug}`
                : `Run /${skill.slug}`}
          </button>
          <Link
            to="/profile"
            className="text-sm text-[var(--muted)] hover:text-[var(--text)] underline"
          >
            Edit client profile
          </Link>
          {jobMeta?.jobId && (
            <Link
              to="/runs/$id"
              params={{ id: jobMeta.jobId }}
              className="text-sm text-[var(--accent-dim)] underline"
            >
              View job
            </Link>
          )}
          {jobMeta?.manusTaskUrl && (
            <a
              href={jobMeta.manusTaskUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[var(--muted)] underline"
            >
              Manus task
            </a>
          )}
        </div>
      </form>

      {(output || error) && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Output</h2>
            {provider && (
              <span className="text-xs text-[var(--muted)]">
                via {provider}
                {provider === 'offline'
                  ? ' (demo scaffold — set API key for live)'
                  : provider === 'manus'
                    ? ' (async — webhook completes the job)'
                    : ''}
              </span>
            )}
          </div>
          {error && (
            <p className="text-sm text-[var(--danger)]">Error: {error}</p>
          )}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 prose-output text-[var(--text)]">
            {output}
          </div>
        </section>
      )}
    </div>
  )
}
