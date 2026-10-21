import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  emptyProfile,
  loadProfile,
  saveProfile,
  type ClientProfile,
} from '~/lib/profile'
import { researchFromWebsite } from '~/lib/auto/research'
import { loadSettings } from '~/lib/settings/client'
import { Markdown } from '~/components/Markdown'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const [profile, setProfile] = useState<ClientProfile>(emptyProfile)
  const [website, setWebsite] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState('')

  useEffect(() => {
    setProfile(loadProfile())
  }, [])

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    saveProfile(profile)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function onResearch() {
    if (!website.trim()) {
      setMsg('Enter a website URL.')
      return
    }
    setBusy(true)
    setMsg('Researching…')
    try {
      const res = await researchFromWebsite({
        data: {
          website: website.trim(),
          companyName: profile.name || undefined,
          settings: loadSettings(),
        },
      })
      if (res.ok) {
        setPreview(res.profile)
        setProfile((p) => ({
          ...p,
          name: p.name || res.website,
          standing: res.profile,
        }))
        setMsg(`Built via ${res.provider}. Review standing field, then Save.`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Client profile</h1>
        <p className="mt-2 text-[var(--muted)] text-sm leading-relaxed">
          Like the local newsjack agent: paste a website and we infer standing,
          beats, and topics. Stored in this browser; attached to skill runs.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
        <div className="text-xs font-medium text-[var(--muted)]">
          Auto-build from website
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            placeholder="https://yourcompany.com"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={onResearch}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40"
          >
            {busy ? '…' : 'Research'}
          </button>
        </div>
        {msg && <p className="text-xs text-[var(--muted)]">{msg}</p>}
      </div>

      <form onSubmit={onSave} className="space-y-4">
        {(
          [
            ['name', 'Company name', false],
            ['standing', 'Standing / authority', true],
            ['beats', 'Beats / topics', true],
            ['competitors', 'Competitors', true],
            ['notes', 'Notes', true],
          ] as const
        ).map(([key, label, multi]) => (
          <label key={key} className="block space-y-1.5">
            <span className="text-sm font-medium">{label}</span>
            {multi ? (
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm min-h-[5rem]"
                value={profile[key]}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, [key]: e.target.value }))
                }
              />
            ) : (
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={profile[key]}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, [key]: e.target.value }))
                }
              />
            )}
          </label>
        ))}
        <button
          type="submit"
          className="rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--accent)', color: '#0a0a0b' }}
        >
          {saved ? 'Saved' : 'Save profile'}
        </button>
      </form>

      {preview && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="text-xs text-[var(--muted)] mb-2">Research preview</div>
          <Markdown content={preview} />
        </div>
      )}
    </div>
  )
}
