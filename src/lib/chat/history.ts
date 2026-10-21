export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  skillSlug?: string
  createdAt: string
}

export type ChatThread = {
  id: string
  title: string
  skillSlug?: string
  messages: ChatMessage[]
  updatedAt: string
}

const KEY = 'newsjack.chat.threads.v1'

export function loadThreads(): ChatThread[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return JSON.parse(raw) as ChatThread[]
  } catch {
    return []
  }
}

export function saveThreads(threads: ChatThread[]) {
  localStorage.setItem(KEY, JSON.stringify(threads.slice(0, 50)))
}

export function upsertThread(thread: ChatThread) {
  const all = loadThreads().filter((t) => t.id !== thread.id)
  all.unshift(thread)
  saveThreads(all)
}

export function deleteThread(id: string) {
  saveThreads(loadThreads().filter((t) => t.id !== id))
}

export function newId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
