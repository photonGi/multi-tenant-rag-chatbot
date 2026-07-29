'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  CornerDownLeft,
  Link2,
  MessageSquare,
  MessageSquareText,
  MessagesSquare,
  Search,
  SearchX,
  Sparkles,
  SquarePen,
  Trash2,
} from 'lucide-react'

import { MessageList } from '@/components/chat/messages'
import { Thinking } from '@/components/chat/thinking'
import {
  createThread,
  formatRelative,
  loadThreads,
  memoryKeyOf,
  newId,
  saveThreads,
  storageKeyFor,
  type ChatMessage,
  type ChatThread,
} from '@/lib/chat/storage'
import { ChatLinkUnavailable } from '@/components/chat/link-unavailable'
import { describeError } from '@/lib/errors'
import { N8nError, n8nClient } from '@/lib/n8n/client'
import { cn } from '@/lib/utils'

type View = 'chat' | 'history'

const STARTERS = [
  {
    kind: 'Coverage',
    prompt: 'What topics do these documents cover?',
  },
  {
    kind: 'Summary',
    prompt: 'Summarise the main points for me.',
  },
]

/**
 * The public chat module.
 *
 * Standalone by design: it holds no Supabase client, reads no session, and
 * renders its own shell. Everything it needs arrives in the URL — the workspace
 * key it posts to n8n, and an optional display name — and everything it keeps
 * lives in the visitor's own browser.
 */
export function ChatModule({
  chatKey,
  workspaceName,
}: {
  chatKey: string
  workspaceName: string | null
}) {
  const storageKey = useMemo(() => storageKeyFor(chatKey), [chatKey])

  const [hydrated, setHydrated] = useState(false)
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [view, setView] = useState<View>('chat')
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  // Set once the workflow refuses the key — the workspace was deleted or its
  // link regenerated. The shape of the key is already known good by this point
  // (page.tsx checks it), so this can only mean the key no longer resolves.
  const [revoked, setRevoked] = useState(false)

  // Ids of messages that arrived during this session. Only these animate in —
  // replaying the whole cascade every time a thread is resumed from history
  // would make reading old conversations feel slow.
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set())

  const scrollRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const stickToBottomRef = useRef(true)

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null
  const messages = activeThread?.messages ?? []

  // Read history only after mount: localStorage does not exist on the server,
  // so touching it during render would hydrate mismatched markup.
  useEffect(() => {
    setThreads(loadThreads(storageKey))
    setActiveThreadId(null)
    setHydrated(true)
  }, [storageKey])

  useEffect(() => {
    if (!hydrated) return
    saveThreads(storageKey, threads)
  }, [hydrated, storageKey, threads])

  // Another tab sharing this link writes to the same slot; pick up its changes
  // instead of overwriting them on the next keystroke.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return
      setThreads(loadThreads(storageKey))
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageKey])

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior })
  }, [])

  // Reading back through a conversation should not be interrupted. Once the
  // visitor scrolls away from the bottom, new content stops pulling them down.
  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    stickToBottomRef.current =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
  }, [])

  // Follow the answer as it lands. The reveal cascade keeps changing height for
  // about a second, so scrolling once when the message mounts would stop short.
  //
  // A callback ref rather than an effect: the transcript replaces the zero
  // state without `view` changing, so an effect keyed on view would never see
  // the node appear and the first conversation would never be observed.
  const attachContent = useCallback(
    (node: HTMLDivElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      if (!node) return

      const observer = new ResizeObserver(() => {
        if (stickToBottomRef.current) scrollToBottom('smooth')
      })
      observer.observe(node)
      observerRef.current = observer
    },
    [scrollToBottom],
  )

  // Opening a thread should start at the newest message, not glide down to it.
  useEffect(() => {
    stickToBottomRef.current = true
    scrollToBottom('auto')
  }, [activeThreadId, view, scrollToBottom])

  const appendMessage = useCallback((threadId: string, message: ChatMessage) => {
    setFreshIds((current) => new Set(current).add(message.id))
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              updatedAt: message.createdAt,
              messages: [...thread.messages, message],
            }
          : thread,
      ),
    )
  }, [])

  const handleSend = useCallback(
    async (raw: string) => {
      const question = raw.trim()
      if (!question || pending) return

      setInput('')
      setView('chat')

      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: question,
        createdAt: Date.now(),
      }

      setFreshIds((current) => new Set(current).add(userMessage.id))
      stickToBottomRef.current = true

      // Resolve the target thread before the request goes out. The visitor can
      // open history or another thread while it is in flight, and the answer
      // still has to land in the thread it was asked in.
      const existing = activeThreadId
        ? threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const thread = existing ?? createThread(question)
      const threadId = thread.id

      if (!existing) setActiveThreadId(threadId)

      setThreads((current) =>
        existing
          ? current.map((item) =>
              item.id === threadId
                ? {
                    ...item,
                    updatedAt: userMessage.createdAt,
                    messages: [...item.messages, userMessage],
                  }
                : item,
            )
          : [
              { ...thread, updatedAt: userMessage.createdAt, messages: [userMessage] },
              ...current,
            ],
      )

      setPending(true)
      try {
        const response = await n8nClient.chat({
          api_key: chatKey,
          question,
          // Scopes the workflow's memory node to this conversation.
          memory_key: memoryKeyOf(thread),
        })
        appendMessage(threadId, {
          id: newId(),
          role: 'assistant',
          content:
            response.answer?.trim() ||
            'No answer came back for that question. Try rephrasing it.',
          createdAt: Date.now(),
          sources: response.sources?.length ? response.sources : undefined,
        })
      } catch (error) {
        // A refused key is terminal — every later turn would fail the same way,
        // so the page swaps to the unavailable state instead of stacking error
        // bubbles. Anything else (a 500, a dropped connection, an inactive
        // workflow) is transient and stays retryable in place.
        if (error instanceof N8nError && error.isRejectedKey) {
          setRevoked(true)
          return
        }

        appendMessage(threadId, {
          id: newId(),
          role: 'assistant',
          content: describeError(error),
          createdAt: Date.now(),
          failed: true,
        })
      } finally {
        setPending(false)
      }
    },
    [activeThreadId, appendMessage, chatKey, pending, threads],
  )

  const handleNewChat = useCallback(() => {
    setActiveThreadId(null)
    setInput('')
    setView('chat')
    setFreshIds(new Set())
  }, [])

  const handleResume = useCallback((threadId: string) => {
    setActiveThreadId(threadId)
    setView('chat')
    // Resumed messages are already "arrived" — they render in place.
    setFreshIds(new Set())
  }, [])

  const handleDelete = useCallback(
    (threadId: string) => {
      setThreads((current) => current.filter((thread) => thread.id !== threadId))
      if (activeThreadId === threadId) setActiveThreadId(null)
    },
    [activeThreadId],
  )

  // Deleting the conversation currently on screen. Confirmed because this
  // browser is the only place it exists — there is no server copy to restore.
  const handleDeleteActive = useCallback(() => {
    if (!activeThreadId) return
    if (!confirm('Delete this conversation? It is only stored in this browser.')) return

    handleDelete(activeThreadId)
    setView('chat')
  }, [activeThreadId, handleDelete])

  const handleClearAll = useCallback(() => {
    if (threads.length === 0) return
    if (
      !confirm(
        `Delete all ${threads.length} conversation${threads.length === 1 ? '' : 's'}? They are only stored in this browser and cannot be recovered.`,
      )
    ) {
      return
    }

    setThreads([])
    setActiveThreadId(null)
    setQuery('')
  }, [threads.length])

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure origin, denied permission). The link is in
      // the address bar either way.
    }
  }, [])

  const ordered = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return ordered

    return ordered.filter((thread) => {
      if (thread.title.toLowerCase().includes(needle)) return true
      return thread.messages.some((message) =>
        message.content.toLowerCase().includes(needle),
      )
    })
  }, [ordered, query])

  const title = workspaceName || 'Document Assistant'

  // Stored history is left untouched: if the key turns out to have been
  // refused in error, a reload brings the conversation back rather than
  // having quietly discarded it.
  if (revoked) return <ChatLinkUnavailable reason="revoked" />

  return (
    // h-dvh, not h-screen: on mobile the collapsing URL bar makes 100vh taller
    // than the visible area, which would bury the composer off-screen.
    <div className="flex h-dvh overflow-hidden bg-canvas">
      {/* ── Left rail — folded into the header below md ───────────────────── */}
      <nav className="relative z-50 hidden h-full w-16 shrink-0 flex-col items-center border-r border-border bg-surface py-5 md:flex">
        <button
          type="button"
          onClick={handleNewChat}
          data-tooltip="New chat"
          className="mb-8 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-white shadow-soft transition-colors hover:bg-ink-800"
        >
          <span className="text-lg font-bold tracking-tighter">+</span>
        </button>

        <div className="flex w-full flex-col items-center gap-3">
          {(
            [
              { id: 'chat', label: 'Chat', icon: MessageSquareText },
              { id: 'history', label: 'Chat history', icon: MessagesSquare },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              data-tooltip={label}
              className={cn(
                'relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200',
                view === id
                  ? 'bg-ink-900 text-surface shadow-md'
                  : 'text-ink-400 hover:bg-ink-100 hover:text-ink-900',
              )}
            >
              <Icon className="h-4.5 w-4.5" />
              {id === 'history' && threads.length > 0 ? (
                <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-surface" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-auto flex flex-col items-center pb-1">
          <span
            data-tooltip="Public endpoint · no sign-in required"
            className="flex h-4 w-4 cursor-help items-center justify-center"
          >
            <span className="h-2 w-2 animate-pulse-slow rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
          </span>
        </div>
      </nav>

      {/* ── Viewport ──────────────────────────────────────────────────────── */}
      <main className="flex h-full w-full flex-1 flex-col bg-canvas/30">
        <header className="sticky top-0 z-40 flex w-full items-center justify-between gap-3 border-b border-border/40 bg-canvas/90 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 md:px-8">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight text-ink-900 uppercase">
                {title}
              </span>
              <span className="hidden shrink-0 rounded border border-ink-200 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 sm:inline">
                ASSISTANT
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
             
              <span
                className={cn(
                  'ml-0.5 truncate border-l border-ink-200 pl-2 text-[10px] font-medium text-brand transition-opacity duration-300',
                  activeThread && view === 'chat' ? 'opacity-100' : 'opacity-0',
                )}
              >
                {activeThread?.title ?? ''}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 md:gap-3">
            {/* Below md the rail is hidden, so history moves in here. */}
            <button
              type="button"
              onClick={() => setView(view === 'history' ? 'chat' : 'history')}
              aria-label={view === 'history' ? 'Back to chat' : 'Chat history'}
              className={cn(
                'relative flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border shadow-soft transition-all md:hidden',
                view === 'history'
                  ? 'border-ink-900 bg-ink-900 text-surface'
                  : 'border-border bg-surface text-ink-500 active:bg-ink-100',
              )}
            >
              <MessagesSquare className="h-4 w-4" />
              {view !== 'history' && threads.length > 0 ? (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-surface" />
              ) : null}
            </button>

            {activeThread ? (
              <button
                type="button"
                onClick={handleDeleteActive}
                aria-label="Delete this conversation"
                title="Delete this conversation"
                className="group flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2.5 shadow-soft transition-all hover:border-alert/40 hover:text-alert active:bg-ink-100 sm:px-3"
              >
                <Trash2 className="h-4 w-4 text-ink-500 transition-colors group-hover:text-alert" />
                <span className="hidden text-xs font-medium text-ink-600 group-hover:text-alert lg:block">
                  Delete
                </span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleCopyLink}
              aria-label={copied ? 'Link copied' : 'Copy share link'}
              className="group flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2.5 shadow-soft transition-all hover:border-ink-300 hover:shadow-elevated active:bg-ink-100 sm:px-3"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Link2 className="h-4 w-4 text-ink-500 group-hover:text-ink-900" />
              )}
              <span className="hidden text-xs font-medium text-ink-600 group-hover:text-ink-900 lg:block">
                {copied ? 'Link copied' : 'Share link'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleNewChat}
              aria-label="New chat"
              className="group flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface px-2.5 shadow-soft transition-all hover:border-ink-300 hover:shadow-elevated active:bg-ink-100 sm:px-3"
            >
              <SquarePen className="h-4 w-4 text-ink-500 group-hover:text-ink-900" />
              <span className="hidden text-xs font-medium text-ink-600 group-hover:text-ink-900 lg:block">
                New Chat
              </span>
            </button>
          </div>
        </header>

        <div className="relative flex flex-1 flex-col overflow-hidden">
          {view === 'history' ? (
            <HistoryView
              threads={filtered}
              query={query}
              onQueryChange={setQuery}
              onResume={handleResume}
              onDelete={handleDelete}
              onClearAll={handleClearAll}
              totalCount={threads.length}
            />
          ) : messages.length === 0 && !pending ? (
            <ZeroState
              title={title}
              disabled={!hydrated}
              value={input}
              onChange={setInput}
              onSubmit={handleSend}
            />
          ) : (
            <>
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex-1 animate-fade-in overflow-y-auto px-4 py-6 pb-36 sm:px-6 sm:py-8 sm:pb-40 md:px-8"
              >
                {/* Observed for height changes so the view can follow the
                    answer as its blocks cascade in. */}
                <div
                  ref={attachContent}
                  className="mx-auto w-full max-w-3xl space-y-7 sm:space-y-10"
                >
                  <MessageList messages={messages} freshIds={freshIds} />
                  {pending ? <Thinking /> : null}
                </div>
              </div>

              <div className="pb-safe absolute bottom-0 left-0 z-20 w-full bg-linear-to-t from-canvas via-canvas to-transparent px-4 pt-16 sm:px-6 sm:pt-20 md:px-8">
                <div className="relative mx-auto flex max-w-3xl items-center rounded-xl border border-border bg-surface p-1 shadow-elevated transition-colors focus-within:border-ink-300">
                  <MessageSquare className="ml-3 h-5 w-5 shrink-0 text-ink-400 sm:ml-4" />
                  <input
                    type="text"
                    value={input}
                    autoComplete="off"
                    disabled={pending}
                    placeholder={pending ? 'Waiting for an answer…' : 'Ask a follow up…'}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSend(input)
                    }}
                    /* 16px on mobile — anything smaller makes iOS Safari zoom
                       the whole page in on focus. */
                    className="w-full border-none bg-transparent px-3 py-3 text-base font-light text-ink-900 outline-none placeholder:text-ink-400 disabled:opacity-60 sm:px-4"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function ZeroState({
  title,
  value,
  disabled,
  onChange,
  onSubmit,
}: {
  title: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onSubmit: (value: string) => void
}) {
  return (
    <div className="absolute inset-0 z-30 flex animate-fade-in flex-col items-center justify-center overflow-y-auto px-4 py-8 sm:p-6">
      <div className="flex w-full max-w-2xl flex-col items-center gap-6 sm:gap-8">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-balance text-ink-900 sm:text-2xl">
            {title}
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed font-light text-pretty text-ink-500">
            Ask anything about the documents in this workspace. No sign-in needed —
            this conversation stays in your browser.
          </p>
        </div>

        <div className="group relative w-full">
          <div className="absolute -inset-0.5 rounded-xl bg-linear-to-r from-ink-200 to-ink-100 opacity-30 blur transition duration-500 group-hover:opacity-50" />
          <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-elevated transition-all duration-300 group-focus-within:border-ink-300">
            <div className="flex items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
              <Sparkles className="h-5 w-5 shrink-0 text-ink-400" />
              <input
                type="text"
                autoComplete="off"
                disabled={disabled}
                value={value}
                placeholder="Ask a question…"
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmit(value)
                }}
                className="w-full border-none bg-transparent text-base font-light text-ink-900 outline-none placeholder:text-ink-400"
              />
              <span className="hidden shrink-0 items-center gap-1 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 sm:flex">
                <CornerDownLeft className="h-3 w-3" />
              </span>
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 opacity-0 [animation:slideUp_0.5s_ease-out_0.2s_forwards] sm:grid-cols-2">
          {STARTERS.map(({ kind, prompt }) => (
            <button
              key={kind}
              type="button"
              disabled={disabled}
              onClick={() => onSubmit(prompt)}
              className="group rounded-xl border border-border bg-surface p-3.5 text-left transition-all hover:border-ink-300 hover:shadow-soft active:bg-ink-50"
            >
              <span className="mb-1 block text-xs font-semibold text-ink-900 transition-colors group-hover:text-brand">
                {kind}
              </span>
              <span className="block text-sm leading-relaxed font-light text-ink-500">
                {prompt}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function HistoryView({
  threads,
  query,
  totalCount,
  onQueryChange,
  onResume,
  onDelete,
  onClearAll,
}: {
  threads: ChatThread[]
  query: string
  totalCount: number
  onQueryChange: (value: string) => void
  onResume: (threadId: string) => void
  onDelete: (threadId: string) => void
  onClearAll: () => void
}) {
  return (
    <div className="w-full flex-1 animate-fade-in overflow-y-auto px-4 py-6 pb-16 sm:px-6 sm:py-8 md:px-10">
      <div className="mx-auto w-full max-w-3xl space-y-5 sm:space-y-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-ink-900 sm:text-xl">
                Chat History
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-500 sm:text-sm">
                Stored in this browser only — clearing site data removes it.
              </p>
            </div>

            {totalCount > 0 ? (
              <button
                type="button"
                onClick={onClearAll}
                className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-ink-500 shadow-soft transition-all hover:border-alert/40 hover:text-alert active:bg-ink-100 sm:px-3"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Clear all</span>
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-soft transition-all focus-within:ring-1 focus-within:ring-ink-300">
            <Search className="h-4 w-4 shrink-0 text-ink-400" />
            <input
              type="text"
              value={query}
              placeholder="Search conversations…"
              onChange={(event) => onQueryChange(event.target.value)}
              className="w-full border-none bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400 sm:text-sm"
            />
          </div>
        </div>

        <div className="space-y-3">
          {threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-ink-400">
              {totalCount === 0 ? (
                <>
                  <MessagesSquare className="mb-3 h-10 w-10 opacity-40" />
                  <div className="text-sm font-medium text-ink-500">
                    No conversations yet.
                  </div>
                  <div className="mt-1 text-xs text-ink-400">
                    Ask a question to start your first thread.
                  </div>
                </>
              ) : (
                <>
                  <SearchX className="mb-3 h-10 w-10 opacity-40" />
                  <div className="text-sm font-medium text-ink-500">
                    No conversations found.
                  </div>
                  <div className="mt-1 text-xs text-ink-400">
                    Try a different search term.
                  </div>
                </>
              )}
            </div>
          ) : (
            threads.map((thread) => {
              const firstUser = thread.messages.find(
                (message) => message.role === 'user',
              )
              const preview = firstUser?.content ?? 'Conversation thread'

              return (
                <div
                  key={thread.id}
                  className="group relative rounded-xl border border-border bg-surface p-4 shadow-soft transition-all hover:border-ink-300 hover:shadow-elevated sm:p-5"
                >
                  {/* Stretched hit area — a nested delete button rules out
                      wrapping the whole row in one <button>. */}
                  <button
                    type="button"
                    onClick={() => onResume(thread.id)}
                    aria-label={`Resume conversation: ${thread.title}`}
                    className="absolute inset-0 z-0 rounded-xl"
                  />

                  <div className="pointer-events-none relative z-10 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink-900 transition-colors group-hover:text-brand">
                        {thread.title}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-500">
                        {preview}
                      </div>
                      <div className="mt-2.5 font-mono text-[10px] text-ink-400">
                        {thread.messages.length} MSG • {formatRelative(thread.updatedAt)}
                      </div>
                    </div>

                    {/* Always visible, not hover-revealed: there is no hover on
                        touch, and this is the only way to remove a thread. */}
                    <button
                      type="button"
                      onClick={() => onDelete(thread.id)}
                      aria-label={`Delete conversation: ${thread.title}`}
                      className="pointer-events-auto -m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-all hover:bg-alert/10 hover:text-alert active:bg-alert/10"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
