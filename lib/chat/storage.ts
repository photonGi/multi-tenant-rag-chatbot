/**
 * Browser-owned chat history.
 *
 * The public chat module never writes to Supabase — it has no session to write
 * under. Every thread lives in localStorage instead, namespaced per shared link
 * so two different workspace links opened in the same browser keep entirely
 * separate histories, and each thread inside a namespace keeps its own message
 * list.
 */

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  /** Set when the request failed, so the bubble can render as a failure. */
  failed?: boolean
  sources?: { source?: string; label?: string; similarity?: number }[]
}

export interface ChatThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  /**
   * Conversation key handed to the workflow so its memory node can scope one
   * buffer to this thread. Stamped once at creation and never recomputed, so
   * every turn in the thread carries the same key.
   */
  memoryKey?: string
}

const STORAGE_PREFIX = 'cerebros.chat.v1'
const VISITOR_STORAGE_KEY = `${STORAGE_PREFIX}.visitor`

/**
 * FNV-1a over the link key. Keeps the raw key out of the storage key name
 * while still giving each shared link a stable, collision-resistant namespace.
 */
export function namespaceFor(key: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function storageKeyFor(key: string): string {
  return `${STORAGE_PREFIX}.${namespaceFor(key)}`
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

let cachedVisitorId: string | null = null

/**
 * Stable identifier for this browser.
 *
 * There is no sign-in here, so "user" can only mean this browser profile. It
 * lives outside the per-link namespace deliberately: the same person opening
 * two different workspace links is still the same person.
 */
export function getVisitorId(): string {
  if (cachedVisitorId) return cachedVisitorId
  if (typeof window === 'undefined') return 'ssr'

  try {
    const stored = window.localStorage.getItem(VISITOR_STORAGE_KEY)
    if (stored) {
      cachedVisitorId = stored
      return stored
    }

    const created = newId()
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created)
    cachedVisitorId = created
    return created
  } catch {
    // Storage blocked (private mode, third-party cookie policy). Hold one for
    // the life of the page so the key at least stays stable while they type;
    // history is not persisting in this situation either.
    cachedVisitorId = newId()
    return cachedVisitorId
  }
}

/**
 * `<visitor>:<thread>` — distinct for every conversation and every browser,
 * identical across every turn within one conversation.
 */
export function buildMemoryKey(threadId: string): string {
  return `${getVisitorId()}:${threadId}`
}

function isThread(value: unknown): value is ChatThread {
  if (!value || typeof value !== 'object') return false
  const t = value as ChatThread
  return typeof t.id === 'string' && Array.isArray(t.messages)
}

export function loadThreads(storageKey: string): ChatThread[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(isThread).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    // Corrupt or unreadable (private mode, quota, hand-edited) — start clean
    // rather than taking the whole module down with it.
    return []
  }
}

export function saveThreads(storageKey: string, threads: ChatThread[]): void {
  if (typeof window === 'undefined') return

  try {
    const next = JSON.stringify(threads)

    // Skip no-op writes. Two tabs on the same link each mirror the other's
    // changes back, and writing an identical value keeps that exchange from
    // depending on the browser suppressing same-value storage events.
    if (window.localStorage.getItem(storageKey) === next) return

    window.localStorage.setItem(storageKey, next)
  } catch {
    // Storage full or blocked. The in-memory conversation still works for this
    // session, so there is nothing useful to surface here.
  }
}

/** Thread titles come from the opening question, as in the design. */
export function titleFrom(question: string): string {
  const clean = question.trim().replace(/\s+/g, ' ')
  if (!clean) return 'New conversation'
  return clean.length > 35 ? `${clean.slice(0, 35)}…` : clean
}

export function createThread(question: string): ChatThread {
  const now = Date.now()
  const id = newId()

  return {
    id,
    title: titleFrom(question),
    createdAt: now,
    updatedAt: now,
    messages: [],
    memoryKey: buildMemoryKey(id),
  }
}

/**
 * Threads created before memory keys existed have none stored. Deriving it is
 * equivalent as long as the visitor id survived, which it does whenever the
 * thread itself did.
 */
export function memoryKeyOf(thread: ChatThread): string {
  return thread.memoryKey ?? buildMemoryKey(thread.id)
}

export function formatRelative(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)

  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`

  return new Date(timestamp).toLocaleDateString()
}
