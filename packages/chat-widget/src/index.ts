/**
 * Framework-agnostic entry point.
 *
 * This package does not reimplement the widget — it injects the very same
 * `widget.js` a plain HTML site would paste, and its entire reason to exist is
 * the lifecycle handling around that: SPA unmounts, React StrictMode's
 * deliberate double-mount, and calling `open()` from a button that renders
 * before the script has finished loading.
 *
 * If you are not on a JavaScript framework, you do not need this package. The
 * script tag is the supported path and always will be.
 */

export interface ChatWidgetOptions {
  /** The site's public key, from the Websites tab. Starts with `pk_live_`. */
  publicKey: string
  /**
   * Base URL of the deployment serving the widget. Override when self-hosting
   * or pointing a staging build at a staging backend.
   */
  appUrl?: string
  /**
   * Show the floating launcher bubble. Defaults to true, and to false for
   * inline mounts — a page that docks the chat into its own layout rarely
   * wants a second copy floating over it.
   *
   * Only the first call on a page decides this: the loader is a singleton, so
   * a later call cannot turn the launcher on or off.
   */
  launcher?: boolean
}

export interface InlineChatOptions extends ChatWidgetOptions {
  /** The element to fill. The host owns its size, position and borders. */
  target: HTMLElement
}

interface MTChatbotApi {
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  /**
   * Config fetched and launcher mounted. Optional because a deployment serving
   * an older widget.js will not have it — see `whenChatReady`.
   */
  isReady?: () => boolean
  /** Docks a chat into a host-owned container. Returns a disposer. */
  mountInline?: (target: HTMLElement) => () => void
  destroy: () => void
}

declare global {
  interface Window {
    MTChatbot?: MTChatbotApi
  }
}

export const DEFAULT_APP_URL = 'https://mt-rag-chatbots.vercel.app'

const SCRIPT_ID = 'mt-chatbot-widget'

/** How long `open()` will wait for a still-loading script before giving up. */
const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 50

function normalizeBase(appUrl?: string): string {
  let base = (appUrl || DEFAULT_APP_URL).trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  return base
}

/**
 * How many live consumers there are.
 *
 * The loader is a page-level singleton, but a page can legitimately hold
 * several references to it — a floating launcher plus two inline panels, say.
 * Without counting, unmounting any one of them would tear down the widget for
 * all of them.
 */
let consumers = 0

function releaseLoader(): void {
  consumers -= 1
  if (consumers > 0) return

  document.getElementById(SCRIPT_ID)?.remove()

  // Removing a <script> element does not cancel a fetch already in flight, so
  // a fast unmount (StrictMode does exactly this) can leave the loader to
  // finish booting into a page that no longer wants it. Waiting for the API to
  // appear is what stops that becoming an orphaned widget.
  if (window.MTChatbot) {
    window.MTChatbot.destroy()
    return
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  const timer = setInterval(() => {
    if (window.MTChatbot) {
      window.MTChatbot.destroy()
      clearInterval(timer)
    } else if (Date.now() > deadline || consumers > 0) {
      // consumers > 0 means something re-mounted while we waited; leave it be.
      clearInterval(timer)
    }
  }, READY_POLL_MS)
}

/**
 * Injects the loader. Returns a cleanup function — call it on unmount.
 *
 * Safe to call more than once: the script is injected only if absent, and the
 * loader itself guards against double-injection. The widget is torn down only
 * when the last consumer releases it.
 */
export function loadChatWidget(options: ChatWidgetOptions): () => void {
  // Next.js, Remix and Nuxt all run component code on the server first.
  if (typeof document === 'undefined') return () => {}
  if (!options.publicKey) return () => {}

  consumers += 1

  if (!document.getElementById(SCRIPT_ID)) {
    const base = normalizeBase(options.appUrl)

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = `${base}/widget.js`
    script.async = true
    script.dataset.key = options.publicKey
    // Explicit rather than letting the loader derive it from its own src, so a
    // CDN-hosted copy of widget.js still calls the right API.
    script.dataset.api = base
    if (options.launcher === false) script.dataset.launcher = 'false'

    document.body.appendChild(script)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    releaseLoader()
  }
}

/**
 * Docks the chat into an element you own, with no floating launcher.
 *
 * Use this when the chat is part of your page — a support tab, a sidebar, a
 * dedicated /help route — rather than an overlay. You control the container's
 * size, position and borders; the chat fills it.
 *
 * Still an iframe, exactly like the floating panel. An inline chat sits in the
 * middle of your layout, so it is if anything *more* exposed to your CSS —
 * keeping the isolation is what stops your stylesheet and the panel's from
 * interfering with each other.
 *
 * Returns a disposer. Call it on unmount.
 */
export function mountInlineChat(options: InlineChatOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  if (!options.publicKey || !options.target) return () => {}

  const releaseScript = loadChatWidget({
    publicKey: options.publicKey,
    appUrl: options.appUrl,
    // An inline chat plus a floating bubble is two chats on one page. Opt in
    // explicitly if that is really wanted.
    launcher: options.launcher ?? false,
  })

  let disposeInline: (() => void) | null = null
  let disposed = false

  whenChatReady()
    .then((api) => {
      // Unmounted while the loader was still booting.
      if (disposed) return
      disposeInline = api.mountInline?.(options.target) ?? null
    })
    .catch(() => {
      // Never loaded — blocked, or an origin the site owner has not allowed.
    })

  return () => {
    if (disposed) return
    disposed = true
    disposeInline?.()
    releaseScript()
  }
}

/**
 * Whether the widget is mounted and usable, not merely present.
 *
 * The loader assigns `window.MTChatbot` synchronously but fetches its config
 * asynchronously, so the object exists well before the widget can do anything.
 * `isReady` is absent on older loaders; treating that as ready keeps this
 * working against a deployment that has not been updated yet.
 */
function apiIsUsable(api: MTChatbotApi): boolean {
  return typeof api.isReady === 'function' ? api.isReady() : true
}

/**
 * Resolves once the widget is live, or rejects if it never arrives.
 *
 * Waits for the config round trip, not just for the global to appear — so a
 * rejection genuinely means the widget did not load, which is what happens on
 * an origin the site owner has not allowed.
 */
export function whenChatReady(timeoutMs: number = READY_TIMEOUT_MS): Promise<MTChatbotApi> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The chat widget is only available in the browser.'))
      return
    }
    if (window.MTChatbot && apiIsUsable(window.MTChatbot)) {
      resolve(window.MTChatbot)
      return
    }

    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const api = window.MTChatbot
      if (api && apiIsUsable(api)) {
        clearInterval(timer)
        resolve(api)
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error('The chat widget did not load.'))
      }
    }, READY_POLL_MS)
  })
}

/**
 * Controls, safe to call before the script has finished loading.
 *
 * A "Need help?" button often renders before an async script lands. Two things
 * make the first click work anyway: this waits for the widget to be genuinely
 * ready rather than merely present, and the loader itself queues an `open()`
 * that arrives before its config does. Either alone would drop that click.
 */
function control(action: 'open' | 'close' | 'toggle' | 'destroy'): void {
  whenChatReady()
    .then((api) => api[action]())
    .catch(() => {
      // Blocked, not installed on this origin, or never loaded. The host page
      // gets no error for the same reason the loader stays silent.
    })
}

export const openChat = () => control('open')
export const closeChat = () => control('close')
export const toggleChat = () => control('toggle')
export const destroyChat = () => control('destroy')

/** Synchronous, and false until the widget has actually loaded. */
export function isChatOpen(): boolean {
  return typeof window !== 'undefined' && (window.MTChatbot?.isOpen() ?? false)
}
