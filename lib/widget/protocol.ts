/**
 * The postMessage contract between the loader (on the customer's page) and the
 * panel (inside our iframe).
 *
 * Kept in one file because it is a wire format with two independent
 * implementations — the panel is TypeScript/React, the loader is hand-written
 * vanilla JS in public/widget.js. Anything added here has to be added there
 * too, and the `CHANNEL` tag is what lets each side ignore the postMessage
 * traffic of every other script on the page.
 */

export const CHANNEL = 'sysmatixx-widget'

/** Panel → loader. */
export type PanelMessage =
  /** Sent on mount. The loader answers with `init`. */
  | { channel: typeof CHANNEL; type: 'ready' }
  /** The session expired mid-conversation; the loader refetches config. */
  | { channel: typeof CHANNEL; type: 'refresh' }
  /** Visitor pressed the close control inside the panel. */
  | { channel: typeof CHANNEL; type: 'close' }
  /** Unread answers, for the launcher badge while the panel is shut. */
  | { channel: typeof CHANNEL; type: 'unread'; count: number }

/** Loader → panel. */
export type LoaderMessage =
  /** Everything the panel needs to run. Sent in reply to `ready`, and again after a `refresh`. */
  | {
      channel: typeof CHANNEL
      type: 'init'
      session: string
      theme: unknown
      parentOrigin: string
    }
  /** Panel visibility changed, so it can focus the composer on open. */
  | { channel: typeof CHANNEL; type: 'visibility'; open: boolean }

/**
 * A plain `Omit<Union, K>` collapses a union to the keys its members share, so
 * `Omit<PanelMessage, 'channel'>` would lose `count` from the unread variant.
 * Distributing over the union first keeps each member intact.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A panel message with the channel tag left for the sender to stamp on. */
export type PanelMessageBody = DistributiveOmit<PanelMessage, 'channel'>

export function isChannelMessage(value: unknown): value is { channel: string; type: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { channel?: unknown }).channel === CHANNEL &&
    typeof (value as { type?: unknown }).type === 'string'
  )
}
