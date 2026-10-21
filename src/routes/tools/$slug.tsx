import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { getSkill } from '~/lib/skills/catalog'
import { runSkill } from '~/lib/skills/run'
import {
  startCoverageReelJob,
  startPressClipJob,
} from '~/lib/jobs/browser'
import { saveProfile, loadProfile, profileToPromptBlock } from '~/lib/profile'
import { loadSettings } from '~/lib/settings/client'
import { enrichSkillInputs, researchFromWebsite } from '~/lib/auto/research'
import { Markdown } from '~/components/Markdown'


export const Route = createFileRoute('/tools/$slug')({
  component: ToolPage,
})

function ToolPage() {
  const { slug } = Route.useParams()
  const skill = getSkill(slug)

  const initial = useMemo(() => {
    if (!skill) return {} as Record<string, string>
    const o: Record<string, string> = {}
    for (const i of skill.inputs) o[i.id] = ''
    return o
  }, [skill])

  const [values, setValues] = useState<Record<string, string>>(initial)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState('')
  const [website, setWebsite] = useState('')
  const [status, setStatus] = useState('')

  if (!skill) {
    return (
      <div>
        <p>Unknown skill.</p>
        <Link to="/tools" className="text-[var(--accent-dim)] underline">
          Back
        </Link>
      </div>
    )
  }

  function setField(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  function loadExample() {
    if (!skill?.examples) return
    setValues((prev) => ({ ...prev, ...skill.examples }))
    setStatus('Example loaded — edit anything, then Run.')
  }

  async function onAutoFill() {
    setBusy(true)
    setStatus('Inferring missing fields…')
    setError('')
    try {
      const settings = loadSettings()
      const profile = profileToPromptBlock(loadProfile())
      const res = await enrichSkillInputs({
        data: {
          slug: skill.slug,
          values,
          profile: profile || undefined,
          website: website || undefined,
          settings,
        },
      })
      if (res.ok) {
        setValues(res.values)
        if (res.profile && !profile) {
          // stash researched profile into local profile notes
          const p = loadProfile()
          saveProfile({
            ...p,
            name: p.name || website || p.name,
            standing: res.profile,
          })
        }
        setStatus(
          res.filled.length
            ? `Filled: ${res.filled.join(', ')}`
            : 'Nothing to fill (or LLM unavailable).',
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onResearchSite() {
    if (!website.trim()) {
      setStatus('Enter a website first.')
      return
    }
    setBusy(true)
    setStatus('Researching website…')
    setError('')
    try {
      const res = await researchFromWebsite({
        data: {
          website: website.trim(),
          settings: loadSettings(),
        },
      })
      if (res.ok) {
        const p = loadProfile()
        saveProfile({
          ...p,
          name: p.name || res.website,
          standing: res.profile,
        })
        // Prefer first company-like textarea
        for (const input of skill.inputs) {
          if (
            /company|profile|context|brief|update/i.test(input.id) ||
            /company|profile|context/i.test(input.label)
          ) {
            setField(input.id, res.profile)
            break
          }
        }
        setOutput(res.profile)
        setProvider(res.provider)
        setStatus(`Profile built via ${res.provider}. Saved to Profile.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOutput('')
    setProvider('')
    setStatus('')
    try {
      const profile = profileToPromptBlock(loadProfile())
      const settings = loadSettings()

      if (skill.browserWorker) {
        if (skill.slug === 'press-clip') {
          const res = await startPressClipJob({
            data: {
              url: values.url,
              mention: values.mention,
              brandNotes: profile || undefined,
              manusApiKey: settings.manusApiKey || undefined,
            },
          })
          if (!res.ok) {
            setError(res.error || 'Job failed')
          } else {
            setOutput(
              [
                '## Manus press-clip job queued',
                '',
                `- **Job ID:** \`${res.jobId}\``,
                `- **Manus task:** \`${res.manusTaskId}\``,
                res.taskUrl ? `- **Task URL:** ${res.taskUrl}` : '',
                '',
                'Results arrive via webhook → **Runs**.',
              ]
                .filter(Boolean)
                .join('\n'),
            )
            setProvider('manus')
          }
        } else if (skill.slug === 'coverage-reel') {
          const res = await startCoverageReelJob({
            data: {
              notes: values.notes,
              brandNotes: profile || undefined,
              manusApiKey: settings.manusApiKey || undefined,
            },
          })
          if (!res.ok) {
            setError(res.error || 'Job failed')
          } else {
            setOutput(
              [
                '## Manus coverage-reel job queued',
                '',
                `- **Job ID:** \`${res.jobId}\``,
                `- **Manus task:** \`${res.manusTaskId}\``,
                res.taskUrl ? `- **Task URL:** ${res.taskUrl}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            )
            setProvider('manus')
          }
        }
      } else {
        const res = await runSkill({
          data: {
            slug: skill.slug,
            values,
            profile: profile || undefined,
            settings,
          },
        })
        if (!res.ok) setError(res.error || 'Run failed')
        setOutput(res.output || '')
        setProvider(res.provider || '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/tools"
          className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          ← Skills
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight flex items-center gap-2">
          <span>{skill.icon}</span> {skill.name}
        </h1>
        <p className="mt-2 text-[var(--muted)] text-sm">{skill.description}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          When to use: {skill.whenToUse}
        </p>
      </div>

      {/* Auto research bar */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
        <div className="text-xs font-medium text-[var(--muted)]">
          Auto (like newsjack agent) — website → profile when fields are empty
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            className="flex-1 min-w-[12rem] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="https://yourcompany.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={onResearchSite}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
          >
            Build profile from site
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onAutoFill}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
          >
            Fill empty fields
          </button>
          {skill.examples && (
            <button
              type="button"
              onClick={loadExample}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--accent-dim)]"
            >
              Try example
            </button>
          )}
        </div>
        {status && (
          <p className="text-xs text-[var(--muted)]">{status}</p>
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {skill.inputs.map((input) => (
          <label key={input.id} className="block space-y-1.5">
            <span className="text-sm font-medium">
              {input.label}
              {input.required ? (
                <span className="text-[var(--accent)]"> *</span>
              ) : null}
            </span>
            {input.type === 'textarea' ? (
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm min-h-[6rem]"
                rows={input.rows || 5}
                placeholder={input.placeholder}
                value={values[input.id] || ''}
                onChange={(e) => setField(input.id, e.target.value)}
                required={input.required}
              />
            ) : (
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                placeholder={input.placeholder}
                value={values[input.id] || ''}
                onChange={(e) => setField(input.id, e.target.value)}
                required={input.required}
              />
            )}
          </label>
        ))}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          {busy ? 'Running…' : skill.browserWorker ? 'Start Manus job' : 'Run skill'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-400 border border-red-900/40 rounded-lg p-3">
          {error}
        </p>
      )}

      {output && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
              Result {provider ? `· ${provider}` : ''}
            </span>
          </div>
          <Markdown content={output} />
        </div>
      )}
    </div>
  )
}
