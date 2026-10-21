import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type ProviderSettings,
} from './types'

export function loadSettings(): ProviderSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(partial: Partial<ProviderSettings>): ProviderSettings {
  const next = { ...loadSettings(), ...partial }
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
  return next
}

export function clearSettings(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY)
}

/** Safe to show in UI — never log full keys */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
