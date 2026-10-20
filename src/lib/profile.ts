const KEY = 'newsjack-web-profile'

export type ClientProfile = {
  name: string
  standing: string
  beats: string
  competitors: string
  notes: string
}

export const emptyProfile = (): ClientProfile => ({
  name: '',
  standing: '',
  beats: '',
  competitors: '',
  notes: '',
})

export function loadProfile(): ClientProfile {
  if (typeof window === 'undefined') return emptyProfile()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyProfile()
    return { ...emptyProfile(), ...JSON.parse(raw) }
  } catch {
    return emptyProfile()
  }
}

export function saveProfile(p: ClientProfile) {
  localStorage.setItem(KEY, JSON.stringify(p))
}

export function profileToPromptBlock(p: ClientProfile): string {
  const lines: string[] = []
  if (p.name) lines.push(`Company: ${p.name}`)
  if (p.standing) lines.push(`Standing / authority:\n${p.standing}`)
  if (p.beats) lines.push(`Beats / topics:\n${p.beats}`)
  if (p.competitors) lines.push(`Competitors:\n${p.competitors}`)
  if (p.notes) lines.push(`Notes:\n${p.notes}`)
  return lines.join('\n\n')
}
