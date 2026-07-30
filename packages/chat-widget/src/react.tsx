'use client'

import { useEffect, useRef, type CSSProperties } from 'react'

import {
  loadChatWidget,
  mountInlineChat,
  type ChatWidgetOptions,
} from './index'

export type ChatWidgetProps = ChatWidgetOptions & {
  /**
   * Set false to unmount the widget without unmounting the component — the
   * usual way to hide it on admin or checkout routes.
   */
  enabled?: boolean
}

/**
 * Mounts the chat widget.
 *
 * Render it once, above your router. Mounting it inside a routed component
 * makes it tear down and re-inject on every navigation, which costs a config
 * request each time and closes the panel out from under whoever was typing.
 *
 * Renders nothing: the widget lives in its own shadow root appended to
 * document.body, deliberately outside the React tree so React can never
 * re-render or restyle it.
 */
export function ChatWidget({ publicKey, appUrl, enabled = true }: ChatWidgetProps) {
  useEffect(() => {
    if (!enabled) return
    // The returned cleanup handles StrictMode's mount/unmount/mount cycle.
    return loadChatWidget({ publicKey, appUrl })
  }, [publicKey, appUrl, enabled])

  return null
}

export type InlineChatWidgetProps = Omit<ChatWidgetOptions, 'launcher'> & {
  /** Also show the floating launcher alongside the inline chat. Default false. */
  launcher?: boolean
  className?: string
  /**
   * The container is yours to size. It has no intrinsic height, so give it one
   * — a bare div collapses to zero and the chat will look like it never loaded.
   */
  style?: CSSProperties
}

/**
 * The chat, docked into your layout instead of floating over it.
 *
 * Renders a single div and fills it. Use it for a support tab, a sidebar, or a
 * dedicated /help route — anywhere the chat is part of the page rather than an
 * overlay on top of it.
 *
 * ```tsx
 * <InlineChatWidget
 *   publicKey="pk_live_..."
 *   style={{ height: 600, maxWidth: 420, borderRadius: 16, overflow: 'hidden' }}
 * />
 * ```
 */
export function InlineChatWidget({
  publicKey,
  appUrl,
  launcher = false,
  className,
  style,
}: InlineChatWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = containerRef.current
    if (!target) return

    return mountInlineChat({ publicKey, appUrl, launcher, target })
  }, [publicKey, appUrl, launcher])

  // A default height so a container with no styling still shows something,
  // rather than collapsing to zero and looking broken.
  return <div ref={containerRef} className={className} style={{ height: 520, ...style }} />
}

export {
  closeChat,
  destroyChat,
  isChatOpen,
  mountInlineChat,
  openChat,
  toggleChat,
  whenChatReady,
} from './index'
