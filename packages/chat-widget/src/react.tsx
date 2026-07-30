'use client'

import { useEffect } from 'react'

import { loadChatWidget, type ChatWidgetOptions } from './index'

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

export {
  closeChat,
  destroyChat,
  isChatOpen,
  openChat,
  toggleChat,
  whenChatReady,
} from './index'
