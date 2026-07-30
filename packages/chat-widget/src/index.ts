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
}

interface CerebrosChatApi {
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  destroy: () => void
}

declare global {
  interface Window {
    CerebrosChat?: CerebrosChatApi
  }
}

export const DEFAULT_APP_URL = 'https://app.sysmatixx.com'

const SCRIPT_ID = 'cerebros-chat-widget'

/** How long `open()` will wait for a still-loading script before giving up. */
const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 50

function normalizeBase(appUrl?: string): string {
  let base = (appUrl || DEFAULT_APP_URL).trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  return base
}

/**
 * Injects the loader. Returns a cleanup function — call it on unmount.
 *
 * Safe to call more than once: the loader itself guards against
 * double-injection, and the script-id check here stops a second `<script>`
 * from being appended at all.
 */
export function loadChatWidget(options: ChatWidgetOptions): () => void {
  // Next.js, Remix and Nuxt all run component code on the server first.
  if (typeof document === 'undefined') return () => {}
  if (!options.publicKey) return () => {}

  if (document.getElementById(SCRIPT_ID)) {
    return () => {}
  }

  const base = normalizeBase(options.appUrl)

  const script = document.createElement('script')
  script.id = SCRIPT_ID
  script.src = `${base}/widget.js`
  script.async = true
  script.dataset.key = options.publicKey
  // Explicit rather than letting the loader derive it from its own src, so a
  // CDN-hosted copy of widget.js still calls the right API.
  script.dataset.api = base

  document.body.appendChild(script)

  let disposed = false

  return () => {
    if (disposed) return
    disposed = true
    script.remove()

    // Removing a <script> element does not cancel a fetch already in flight,
    // so a fast unmount (StrictMode does exactly this) can leave the loader to
    // finish booting into a page that no longer wants it. Waiting for the API
    // to appear is what stops that becoming an orphaned widget.
    if (window.CerebrosChat) {
      window.CerebrosChat.destroy()
      return
    }

    const deadline = Date.now() + READY_TIMEOUT_MS
    const timer = setInterval(() => {
      if (window.CerebrosChat) {
        window.CerebrosChat.destroy()
        clearInterval(timer)
      } else if (Date.now() > deadline) {
        clearInterval(timer)
      }
    }, READY_POLL_MS)
  }
}

/**
 * Resolves once the widget is live, or rejects if it never arrives.
 *
 * Useful when you want to know whether the widget actually loaded — it will
 * not, for instance, on an origin the site owner has not allowed.
 */
export function whenChatReady(timeoutMs: number = READY_TIMEOUT_MS): Promise<CerebrosChatApi> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The chat widget is only available in the browser.'))
      return
    }
    if (window.CerebrosChat) {
      resolve(window.CerebrosChat)
      return
    }

    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      if (window.CerebrosChat) {
        clearInterval(timer)
        resolve(window.CerebrosChat)
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
 * A "Need help?" button often renders before an async script lands; queueing
 * the intent rather than dropping it is the difference between the first click
 * working and doing nothing.
 */
function control(action: keyof Omit<CerebrosChatApi, 'isOpen'>): void {
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
  return typeof window !== 'undefined' && (window.CerebrosChat?.isOpen() ?? false)
}
