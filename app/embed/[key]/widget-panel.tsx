'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, SquarePen, X } from 'lucide-react'

import { MessageList } from '@/components/chat/messages'
import { Thinking } from '@/components/chat/thinking'
import {
  createThread,
  loadThreads,
  memoryKeyOf,
  newId,
  saveThreads,
  storageKeyFor,
  type ChatMessage,
  type ChatThread,
} from '@/lib/chat/storage'
import { cn } from '@/lib/utils'
import {
  CHANNEL,
  isChannelMessage,
  type LoaderMessage,
  type PanelMessageBody,
} from '@/lib/widget/protocol'
import { DEFAULT_THEME, resolveTheme, type WidgetTheme } from '@/lib/widget/theme'

type Phase = 'connecting' | 'ready' | 'standalone'

/** How long to wait for the loader to answer a refresh before giving up. */
const REFRESH_TIMEOUT_MS = 8000

/**
 * The chat panel, as it runs inside the widget iframe.
 *
 * Unlike the standalone module at /chat/[key], this one holds no credential of
 * its own. Its theme and its signed session both arrive from the loader over
 * postMessage, because the loader's config call is the only request in the
 * whole flow that the browser stamps with the host page's real origin.
 */
export function WidgetPanel({ publicKey }: { publicKey: string | null }) {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [theme, setTheme] = useState<WidgetTheme>(DEFAULT_THEME)
  const [thread, setThread] = useState<ChatThread | null>(null)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set())

  const sessionRef = useRef<string | null>(null)
  const parentOriginRef = useRef<string>('*')
  const openRef = useRef(false)
  const unreadRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /** Resolvers waiting on a fresh session after a 401. */
  const refreshWaitersRef = useRef<((token: string | null) => void)[]>([])

  const storageKey = useMemo(
    () => (publicKey ? storageKeyFor(`widget:${publicKey}`) : null),
    [publicKey],
  )

  const post = useCallback((message: PanelMessageBody) => {
    if (typeof window === 'undefined' || window.parent === window) return
    window.parent.postMessage({ channel: CHANNEL, ...message }, parentOriginRef.current)
  }, [])

  // ── Handshake ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Opened directly rather than embedded. Nothing here can work without a
    // loader to authorise it, so say so plainly instead of failing on send.
    if (window.parent === window) {
      setPhase('standalone')
      return
    }

    const onMessage = (event: MessageEvent) => {
      // Only the frame that embedded us may drive this panel. `event.source`
      // and `event.origin` are set by the browser and cannot be forged by the
      // sender, unlike anything inside the payload.
      if (event.source !== window.parent) return
      if (!isChannelMessage(event.data)) return

      const message = event.data as LoaderMessage

      if (message.type === 'init') {
        parentOriginRef.current = event.origin
        sessionRef.current = message.session
        setTheme(resolveTheme(message.theme))
        setPhase('ready')

        // Anything blocked on a 401 can now continue.
        const waiters = refreshWaitersRef.current
        refreshWaitersRef.current = []
        waiters.forEach((resolve) => resolve(message.session))
        return
      }

      if (message.type === 'visibility') {
        openRef.current = message.open
        if (message.open) {
          unreadRef.current = 0
          post({ type: 'unread', count: 0 })
          // Deferred: the panel is still animating in, and focusing mid-flight
          // makes mobile browsers scroll the host page.
          setTimeout(() => inputRef.current?.focus(), 220)
        }
      }
    }

    window.addEventListener('message', onMessage)

    // The loader sets referrerpolicy="origin" on the iframe, so the referrer
    // is the host page's origin and the opening handshake can be addressed
    // rather than broadcast. Falling back to '*' costs nothing — this message
    // carries no payload — but only matters if a referrer never arrives.
    let handshakeTarget = '*'
    try {
      if (document.referrer) handshakeTarget = new URL(document.referrer).origin
    } catch {
      // Malformed referrer. The broadcast fallback still completes the
      // handshake, and `init` is validated by event.origin regardless.
    }

    window.parent.postMessage({ channel: CHANNEL, type: 'ready' }, handshakeTarget)

    return () => window.removeEventListener('message', onMessage)
  }, [post])

  // ── History ─────────────────────────────────────────────────────────────
  // One rolling conversation rather than the thread list the full module has:
  // a 380px panel is not where anyone browses their history, and "continue
  // where I left off" is the behaviour a returning visitor expects.
  //
  // Third-party storage is partitioned per host site by modern browsers and
  // blocked outright by some. loadThreads/saveThreads already swallow that, so
  // the panel simply becomes session-only rather than breaking.
  useEffect(() => {
    if (!storageKey) return
    setThread(loadThreads(storageKey)[0] ?? null)
  }, [storageKey])

  useEffect(() => {
    if (!storageKey) return
    saveThreads(storageKey, thread ? [thread] : [])
  }, [storageKey, thread])

  const messages = thread?.messages ?? []

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages.length, pending])

  /**
   * Asks the loader for a new session and waits for the `init` that follows.
   * Resolves null on timeout so a wedged parent surfaces as one failed message
   * rather than a request that never settles.
   */
  const requestFreshSession = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      let settled = false
      const finish = (token: string | null) => {
        if (settled) return
        settled = true
        resolve(token)
      }

      refreshWaitersRef.current.push(finish)
      post({ type: 'refresh' })
      setTimeout(() => finish(null), REFRESH_TIMEOUT_MS)
    })
  }, [post])

  const callChat = useCallback(
    async (question: string, memoryKey: string, token: string): Promise<Response> => {
      return fetch('/api/widget/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question, memoryKey }),
      })
    },
    [],
  )

  const handleSend = useCallback(
    async (raw: string) => {
      const question = raw.trim()
      if (!question || pending || phase !== 'ready') return

      setInput('')

      const active = thread ?? createThread(question)
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content: question,
        createdAt: Date.now(),
      }

      setFreshIds((current) => new Set(current).add(userMessage.id))
      setThread({
        ...active,
        updatedAt: userMessage.createdAt,
        messages: [...active.messages, userMessage],
      })
      setPending(true)

      const append = (message: ChatMessage) => {
        setFreshIds((current) => new Set(current).add(message.id))
        setThread((current) =>
          current
            ? {
                ...current,
                updatedAt: message.createdAt,
                messages: [...current.messages, message],
              }
            : current,
        )

        if (!openRef.current && message.role === 'assistant') {
          unreadRef.current += 1
          post({ type: 'unread', count: unreadRef.current })
        }
      }

      try {
        const memoryKey = memoryKeyOf(active)
        let token = sessionRef.current
        if (!token) throw new Error('No session')

        let response = await callChat(question, memoryKey, token)

        // A session that aged out mid-conversation is recoverable and common
        // on a tab left open all afternoon — refresh once before surfacing it.
        if (response.status === 401) {
          const refreshed = await requestFreshSession()
          if (refreshed) {
            token = refreshed
            response = await callChat(question, memoryKey, token)
          }
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { message?: string }
            | null

          append({
            id: newId(),
            role: 'assistant',
            // The route already writes visitor-safe copy for every failure; it
            // is on someone else's website, so a raw status means nothing here.
            content:
              body?.message ??
              'Something went wrong reaching the assistant. Please try again.',
            createdAt: Date.now(),
            failed: true,
          })
          return
        }

        const body = (await response.json()) as {
          answer?: string
          sources?: ChatMessage['sources']
        }

        append({
          id: newId(),
          role: 'assistant',
          content:
            body.answer?.trim() ||
            'No answer came back for that question. Try rephrasing it.',
          createdAt: Date.now(),
          sources: body.sources?.length ? body.sources : undefined,
        })
      } catch {
        append({
          id: newId(),
          role: 'assistant',
          content: 'Could not reach the assistant. Check your connection and try again.',
          createdAt: Date.now(),
          failed: true,
        })
      } finally {
        setPending(false)
      }
    },
    [callChat, pending, phase, post, requestFreshSession, thread],
  )

  const handleReset = useCallback(() => {
    setThread(null)
    setFreshIds(new Set())
    setInput('')
    inputRef.current?.focus()
  }, [])

  let composerPlaceholder = 'Ask a question…'
  if (phase === 'connecting') composerPlaceholder = 'Connecting…'
  else if (pending) composerPlaceholder = 'Thinking…'

  if (phase === 'standalone') {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas px-6 text-center">
        <div className="max-w-xs">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
            <Bot className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-ink-900">
            This assistant runs inside a website
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
            Open it from the chat button on the site that installed it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-canvas"
      style={
        {
          '--w-accent': theme.accent,
          '--w-accent-fg': theme.accentForeground,
        } as React.CSSProperties
      }
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header
        className="flex shrink-0 items-center gap-3 px-4 py-3"
        style={{ background: 'var(--w-accent)', color: 'var(--w-accent-fg)' }}
      >
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--w-accent-fg) 18%, transparent)' }}
        >
          <Bot className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">
            {theme.title}
          </div>
          <div className="truncate text-[11px] opacity-70">{theme.subtitle}</div>
        </div>

        {messages.length > 0 ? (
          <button
            type="button"
            onClick={handleReset}
            aria-label="Start a new conversation"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
          >
            <SquarePen className="h-4 w-4" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => post({ type: 'close' })}
          aria-label="Close chat"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </header>

      {/* ── Transcript ───────────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="animate-fade-in space-y-4">
            <div className="rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3 text-[15px] leading-relaxed font-light text-ink-900 shadow-soft">
              {theme.greeting}
            </div>

            {theme.starters.length > 0 ? (
              <div className="space-y-2">
                {theme.starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    disabled={phase !== 'ready'}
                    onClick={() => handleSend(starter)}
                    className="block w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-sm font-light text-ink-700 shadow-soft transition-all hover:border-ink-300 hover:text-ink-900 disabled:opacity-50"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            <MessageList messages={messages} freshIds={freshIds} />
            {pending ? <Thinking /> : null}
          </div>
        )}
      </div>

      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-surface px-3 pt-3 pb-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleSend(input)
          }}
          className="flex items-end gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            autoComplete="off"
            disabled={pending || phase !== 'ready'}
            placeholder={composerPlaceholder}
            onChange={(event) => setInput(event.target.value)}
            /* 16px: anything smaller makes iOS Safari zoom the host page. */
            className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-canvas px-3.5 text-base font-light text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-ink-300 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || pending || phase !== 'ready'}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-opacity disabled:opacity-30"
            style={{ background: 'var(--w-accent)', color: 'var(--w-accent-fg)' }}
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </form>

        <div
          className={cn(
            'pt-2 text-center text-[10px] text-ink-400',
            !theme.showBranding && 'invisible',
          )}
        >
          Powered by Multi-Tenant Chatbot
        </div>
      </div>
    </div>
  )
}
