import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  emptyProfile,
  loadProfile,
  saveProfile,
  type ClientProfile,
} from '~/lib/profile'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const [profile, setProfile] = useState<ClientProfile>(emptyProfile)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setProfile(loadProfile())
  }, [])

  function onSave(e: React.FormEvent) {
    e.preventDefault()
    saveProfile(profile)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Client profile</h1>
        <p className="mt-2 text-[var(--muted)] text-sm leading-relaxed">
          Stored only in this browser (localStorage). Attached to skill runs so
          you don’t re-paste standing, beats, and competitors every time.
        </p>
      </div>

      <form onSubmit={onSave} className="space-y-4">
        {(
          [
            ['name', 'Company name', 'text'],
            ['standing', 'Standing / authority', 'textarea'],
            ['beats', 'Beats & topics', 'textarea'],
            ['competitors', 'Competitors', 'textarea'],
            ['notes', 'Other notes', 'textarea'],
          ] as const
        ).map(([key, label, type]) => (
          <label key={key} className="block space-y-1.5">
            <span className="text-sm font-medium">{label}</span>
            {type === 'textarea' ? (
              <textarea
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm min-h-[5rem] focus:outline-none focus:border-[var(--accent-dim)]"
                value={profile[key]}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, [key]: e.target.value }))
                }
              />
            ) : (
              <input
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-dim)]"
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
    </div>
  )
}
