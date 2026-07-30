/**
 * Multi-Tenant Chatbot — widget loader.
 *
 *   <script src="https://<app>/widget.js" data-key="pk_live_..." async></script>
 *
 * This is the only file a customer ever pastes, and it runs on their site, in
 * their visitors' browsers. Two rules follow from that and shape everything
 * below:
 *
 *   1. It must never break the host page. Every failure path is silent — a
 *      revoked key, a blocked network, an unlisted origin — because the
 *      visitor is not our user and can do nothing about any of it.
 *   2. It must not be reachable by the host page's CSS or JS. The UI lives in
 *      a shadow root and the conversation lives in an iframe, so neither side
 *      can style or script the other.
 *
 * Vanilla and dependency-free on purpose: it has to work identically whether
 * the surrounding page is React, WordPress, Rails or hand-written HTML. The
 * ES6 floor is free — every browser that implements attachShadow (Chrome 53,
 * Safari 10, Firefox 63, Edge 79) implements const, Promise and template
 * literals too, so there is nothing to gain by writing ES5.
 *
 * Ship this minified. It is unminified here so it can be read and debugged.
 */
;(function () {
  'use strict'

  const CHANNEL = 'sysmatixx-widget'
  const MOBILE_BREAKPOINT = 480

  // Guard against double-injection. React StrictMode mounts effects twice in
  // development, and tag managers are perfectly capable of firing the same
  // snippet on every route change.
  if (window.__mtChatbotLoaded) return
  window.__mtChatbotLoaded = true

  // ── Snippet configuration ─────────────────────────────────────────────────
  // `currentScript` is set while this file executes, including for async
  // scripts. The querySelector fallback covers bundlers that re-execute the
  // source in a context where it is null.
  const script =
    document.currentScript || document.querySelector('script[data-key^="pk_live_"]')
  if (!script) return

  const publicKey = script.dataset.key
  if (!publicKey) return

  // Opt out of the floating launcher. Set when the page only wants the inline
  // form — a chat docked into a container the host lays out itself — so the
  // two do not both appear.
  const wantsLauncher = script.dataset.launcher !== 'false'

  // The API lives wherever this script was served from, so nothing is
  // hardcoded and self-hosted deployments need no extra configuration.
  let apiBase = script.dataset.api || ''
  if (!apiBase) {
    const origin = /^https?:\/\/[^/]+/.exec(script.src || '')
    if (!origin) return
    apiBase = origin[0]
  }
  while (apiBase.endsWith('/')) apiBase = apiBase.slice(0, -1)

  // ── State ─────────────────────────────────────────────────────────────────
  let config = null
  let host = null
  let root = null
  let launcher = null
  let badge = null
  let panel = null
  let isOpen = false
  let destroyed = false
  /** An open() that arrived before config did. Replayed once boot finishes. */
  let pendingOpen = false
  /** Inline mounts requested before config arrived. Drained once boot finishes. */
  const inlineQueue = []

  /**
   * Every live chat frame on the page.
   *
   * There can be more than one: the floating panel, plus any number of inline
   * mounts a host component has dropped into its own containers. Each entry is
   * `{ frame, inline, ready }` and messages are routed by matching
   * `event.source` against `frame.contentWindow` — which is why this is a list
   * rather than a single variable.
   */
  const panels = []

  function panelFor(source) {
    return panels.find((entry) => entry.frame?.contentWindow === source)
  }

  /** The floating panel, if the launcher was mounted. */
  function floatingPanel() {
    return panels.find((entry) => !entry.inline)
  }

  // ── Messaging ─────────────────────────────────────────────────────────────
  function sendTo(entry, message) {
    if (!entry?.frame?.contentWindow) return
    message.channel = CHANNEL
    // Targeted at our own origin rather than '*': the session token travels
    // over this channel, and a wildcard target would hand it to whatever
    // document occupied the frame if navigation ever raced us.
    entry.frame.contentWindow.postMessage(message, apiBase)
  }

  function pushInit(entry) {
    if (!config || !entry?.ready) return
    sendTo(entry, {
      type: 'init',
      session: config.session,
      theme: config.theme,
      parentOrigin: window.location.origin,
      // An inline panel is always visible and cannot be dismissed, so it hides
      // its own close control rather than offering one that does nothing.
      inline: entry.inline,
    })
  }

  function pushInitToAll() {
    panels.forEach(pushInit)
  }

  // ── Config ────────────────────────────────────────────────────────────────
  /**
   * The one cross-origin call. It is what proves to the server which site this
   * is — the browser attaches the real Origin header and will not let a page
   * forge it — and it returns the theme plus the signed session that
   * authenticates every message.
   */
  function fetchConfig() {
    return fetch(apiBase + '/api/widget/config?key=' + encodeURIComponent(publicKey), {
      method: 'GET',
      // No cookies: this endpoint is anonymous and origin-authorised, and
      // omitting them keeps it clear of third-party cookie restrictions.
      credentials: 'omit',
      mode: 'cors',
    })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null) // Offline, ad-blocked, CSP-refused. Nothing to say.
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  /**
   * Inherited properties (font, colour, line-height) cross a shadow boundary,
   * so the reset on :host is not optional — without it the launcher inherits
   * whatever the host page set on <body>.
   */
  function styleSheet(theme) {
    const side = theme.position === 'left' ? 'left' : 'right'
    const panelBottom = theme.bottomOffset + 76

    return `
      :host {
        all: initial;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        line-height: 1.5;
        /* Above almost everything. Sticky headers routinely sit at 9999, so
           this clears them without reaching for 2^31 - 1. */
        z-index: 2147483000;
      }
      *, *::before, *::after { box-sizing: border-box; }

      .launcher {
        position: fixed;
        ${side}: ${theme.sideOffset}px;
        bottom: ${theme.bottomOffset}px;
        display: flex; align-items: center; gap: 10px;
        border: 0; margin: 0; padding: 0;
        background: none; cursor: pointer;
        z-index: 2147483000;
      }

      .bubble {
        position: relative;
        display: flex; align-items: center; justify-content: center;
        width: 56px; height: 56px;
        border-radius: 999px;
        background: ${theme.accent};
        color: ${theme.accentForeground};
        box-shadow: 0 6px 24px rgba(0,0,0,.18);
        transition: transform .18s cubic-bezier(.32,1.34,.38,1), box-shadow .18s;
      }
      .launcher:hover .bubble { transform: scale(1.06); box-shadow: 0 10px 28px rgba(0,0,0,.22); }
      .launcher:active .bubble { transform: scale(.97); }
      .launcher:focus-visible .bubble { outline: 2px solid ${theme.accent}; outline-offset: 3px; }
      /* Sizing only — no display here. A '.bubble svg' rule is (0,1,1) and
         outranks a bare '.icon-close' (0,1,0), which left the close icon
         showing next to the message icon while the launcher was shut.
         Specificity beats source order, so reordering would not have fixed it.
         NB: this whole sheet is a JS template literal — no backticks. */
      .bubble svg { width: 26px; height: 26px; }

      /* The open/closed class lives on the host element, so these have to go
         through :host() — a bare descendant selector inside a shadow root can
         never match an ancestor outside it. */
      .icon-open { display: block; }
      .icon-close { display: none; }
      :host(.is-open) .icon-open { display: none; }
      :host(.is-open) .icon-close { display: block; }
      :host(.is-open) .label { display: none; }

      .label {
        order: ${side === 'left' ? 1 : 0};
        padding: 8px 14px;
        border-radius: 999px;
        background: #fff; color: #18181b;
        font-size: 13px; font-weight: 500; white-space: nowrap;
        box-shadow: 0 4px 16px rgba(0,0,0,.12);
      }

      .badge {
        position: absolute; top: -2px; ${side}: -2px;
        min-width: 20px; height: 20px; padding: 0 5px;
        display: none; align-items: center; justify-content: center;
        border-radius: 999px;
        background: #ef4444; color: #fff;
        font-size: 11px; font-weight: 600;
        box-shadow: 0 0 0 2px ${theme.accent};
      }
      .badge.visible { display: flex; }

      .panel {
        position: fixed;
        ${side}: ${theme.sideOffset}px;
        bottom: ${panelBottom}px;
        width: 384px;
        /* Never taller than the viewport allows, so a short window still shows
           the composer instead of pushing it off-screen. */
        height: min(640px, calc(100vh - ${panelBottom + 24}px));
        border-radius: 16px;
        overflow: hidden;
        background: #fff;
        box-shadow: 0 12px 48px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.05);
        opacity: 0; visibility: hidden;
        transform: translateY(12px) scale(.98);
        transform-origin: ${side} bottom;
        transition: opacity .2s ease, transform .2s cubic-bezier(.32,1.34,.38,1), visibility .2s;
        z-index: 2147483000;
      }
      .panel.open { opacity: 1; visibility: visible; transform: translateY(0) scale(1); }
      .panel iframe { width: 100%; height: 100%; border: 0; display: block; }

      /* Full-bleed on phones. A 384px card floating over a 375px viewport is
         unusable, and the on-screen keyboard would cover most of it. */
      @media (max-width: ${MOBILE_BREAKPOINT}px) {
        .panel {
          inset: 0; width: 100%; height: 100%;
          border-radius: 0; transform: translateY(100%);
        }
        .panel.open { transform: translateY(0); }
        :host(.is-open) .launcher { display: none; }
      }

      @media (prefers-reduced-motion: reduce) {
        .panel, .bubble { transition: none; }
      }
    `
  }

  const ICON_OPEN =
    '<svg class="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
  const ICON_CLOSE =
    '<svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

  /**
   * The launcher label is tenant-authored and goes in via innerHTML. The server
   * already caps its length and strips control characters, but the tenant and
   * the site's visitors are different parties — this is the boundary where that
   * distinction has to be enforced.
   */
  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    )
  }

  // ── Mounting ──────────────────────────────────────────────────────────────
  function mount(theme) {
    host = document.createElement('div')
    host.dataset.mtChatbot = ''
    // The host element itself is inert; everything visible is fixed-position
    // inside the shadow root, so this cannot disturb the page's layout.
    host.style.cssText = 'position:relative;width:0;height:0;'

    root = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = styleSheet(theme)
    root.appendChild(style)

    launcher = document.createElement('button')
    launcher.type = 'button'
    launcher.className = 'launcher'
    launcher.setAttribute('aria-label', 'Open chat')
    launcher.setAttribute('aria-expanded', 'false')
    launcher.innerHTML =
      (theme.launcherLabel
        ? '<span class="label">' + escapeHtml(theme.launcherLabel) + '</span>'
        : '') +
      '<span class="bubble">' +
      ICON_OPEN +
      ICON_CLOSE +
      '<span class="badge"></span>' +
      '</span>'

    badge = launcher.querySelector('.badge')
    launcher.addEventListener('click', toggle)

    panel = document.createElement('div')
    panel.className = 'panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', theme.title || 'Chat')

    root.appendChild(launcher)
    root.appendChild(panel)
    document.body.appendChild(host)
  }

  /** Builds a chat frame and registers it so messages can be routed to it. */
  function createPanelFrame(container, inline) {
    const frame = document.createElement('iframe')
    frame.src = config.embedUrl
    frame.title = config.theme?.title || 'Chat assistant'
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;'
    // Enough to run the panel and nothing more. Withholding
    // allow-top-navigation is the point: a compromised panel must not be able
    // to redirect the customer's page out from under their visitor.
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox',
    )
    frame.setAttribute('referrerpolicy', 'origin')
    container.appendChild(frame)

    const entry = { frame, inline, ready: false }
    panels.push(entry)
    return entry
  }

  /**
   * The floating panel's iframe is created on first open, not at mount. That is
   * the difference between the widget costing a customer's page one small
   * script and costing it a whole second document, on every page load, for a
   * panel most visitors never open.
   */
  function ensureIframe() {
    if (floatingPanel()) return
    createPanelFrame(panel, false)
  }

  /**
   * Inline mode: a chat docked into a container the host page lays out itself,
   * with no launcher and no floating panel.
   *
   * Deliberately mounted as an iframe like the floating panel, rather than
   * rendered into the host's DOM — the isolation guarantees are the whole
   * reason this design works, and an inline chat sitting in the middle of
   * someone's page is if anything more exposed to their CSS, not less.
   *
   * Returns a disposer; the host component calls it on unmount.
   */
  function mountInline(target) {
    if (destroyed || !target?.appendChild) return () => {}

    let entry = null
    let disposed = false

    const attach = () => {
      if (disposed || !config) return
      // The container is the host's to size. Filling it is the only layout
      // opinion taken here — everything else is theirs.
      if (!target.style.position) target.style.position = 'relative'
      entry = createPanelFrame(target, true)
    }

    if (config) {
      attach()
    } else {
      // Config is still in flight. Queue the mount the same way open() does,
      // so a component that renders before the round trip finishes still works.
      inlineQueue.push(attach)
    }

    return () => {
      if (disposed) return
      disposed = true

      const queued = inlineQueue.indexOf(attach)
      if (queued !== -1) inlineQueue.splice(queued, 1)

      if (!entry) return
      const index = panels.indexOf(entry)
      if (index !== -1) panels.splice(index, 1)
      entry.frame.remove()
      entry = null
    }
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function open() {
    if (destroyed || isOpen) return

    // The API object is exposed synchronously, but the config round trip that
    // supplies the theme and the iframe URL is not done yet. A "Need help?"
    // button wired to open() and clicked on a cold page therefore lands here
    // with nothing to open — so remember the intent and honour it once boot
    // finishes, rather than silently dropping the visitor's click.
    if (!config) {
      pendingOpen = true
      return
    }

    // Inline-only pages never mount a launcher or a floating panel, so there
    // is nothing here to open. The inline chat is already on screen.
    if (!panel) return

    ensureIframe()

    isOpen = true
    panel.classList.add('open')
    host.classList.add('is-open')
    launcher.setAttribute('aria-label', 'Close chat')
    launcher.setAttribute('aria-expanded', 'true')

    setBadge(0)
    sendTo(floatingPanel(), { type: 'visibility', open: true })

    // Freezing the page behind a full-screen panel stops the body scrolling
    // under it on iOS, which otherwise reads as the widget being broken.
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      document.documentElement.style.overflow = 'hidden'
    }
  }

  function close() {
    // Cancels a queued open too: close() after open() on a cold page must mean
    // "stay shut", not "open anyway once config lands".
    pendingOpen = false
    if (!isOpen) return

    isOpen = false
    panel.classList.remove('open')
    host.classList.remove('is-open')
    launcher.setAttribute('aria-label', 'Open chat')
    launcher.setAttribute('aria-expanded', 'false')

    sendTo(floatingPanel(), { type: 'visibility', open: false })
    document.documentElement.style.overflow = ''
  }

  function toggle() {
    // `pendingOpen` counts as open for toggling: two clicks on a cold page
    // should net to shut, not queue an open that fires a second later.
    if (isOpen || pendingOpen) close()
    else open()
  }

  function setBadge(count) {
    if (!badge) return
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : String(count)
      badge.classList.add('visible')
    } else {
      badge.textContent = ''
      badge.classList.remove('visible')
    }
  }

  // ── Panel messages ────────────────────────────────────────────────────────
  function onMessage(event) {
    // Both checks matter. The origin check stops any other frame on the page
    // from impersonating a panel; matching event.source against a registered
    // frame stops a second frame from our own origin — one the customer also
    // embeds — from driving this widget.
    if (event.origin !== apiBase) return

    const entry = panelFor(event.source)
    if (!entry) return

    const data = event.data
    if (!data || data.channel !== CHANNEL) return

    if (data.type === 'ready') {
      entry.ready = true
      pushInit(entry)
      // An inline panel is permanently visible; the floating one may have been
      // opened before its iframe finished loading.
      if (entry.inline || isOpen) sendTo(entry, { type: 'visibility', open: true })
      return
    }

    if (data.type === 'close') {
      // Only the floating panel can be dismissed. An inline panel's container
      // belongs to the host page, so closing it is not ours to do.
      if (!entry.inline) close()
      return
    }

    if (data.type === 'unread') {
      // The badge belongs to the launcher, so an inline panel has nowhere to
      // put one — and it is visible anyway, so nothing is unread.
      if (!entry.inline && !isOpen) setBadge(data.count || 0)
      return
    }

    if (data.type === 'refresh') {
      // The session aged out mid-conversation. Mint a new one and hand it to
      // every panel — they all share the one session — so the message the
      // visitor already typed can be retried.
      fetchConfig().then((fresh) => {
        if (!fresh || destroyed) return
        config = fresh
        pushInitToAll()
      })
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && isOpen) close()
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // Named so a customer can wire the widget to their own "Need help?" button,
  // and so the npm wrapper has something to call on unmount.
  window.MTChatbot = {
    open,
    close,
    toggle,
    isOpen: () => isOpen,
    /**
     * Whether the widget is actually usable — config fetched and launcher
     * mounted. The API object itself exists from the moment this script runs,
     * so its presence alone says nothing; callers that need to know the widget
     * really loaded (rather than being refused on an unlisted origin) should
     * ask this.
     */
    isReady: () => config !== null,
    /**
     * Docks a chat into a container the host page owns and lays out itself —
     * no launcher, no floating panel. Returns a disposer to call on unmount.
     */
    mountInline,
    destroy() {
      destroyed = true
      pendingOpen = false
      inlineQueue.length = 0
      window.removeEventListener('message', onMessage)
      document.removeEventListener('keydown', onKeydown)
      document.documentElement.style.overflow = ''
      panels.forEach((entry) => entry.frame.remove())
      panels.length = 0
      host?.remove()
      host = root = launcher = badge = panel = null
      window.__mtChatbotLoaded = false
      delete window.MTChatbot
    },
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    fetchConfig().then((result) => {
      // Unknown key, revoked site, or an origin the tenant has not allowed.
      // The dashboard already knows — the attempt was recorded server-side —
      // so there is nothing useful to show a visitor here.
      if (!result || destroyed) return

      config = result

      // Listeners go on before anything mounts, so a frame that loads fast
      // cannot say "ready" into a void.
      window.addEventListener('message', onMessage)
      document.addEventListener('keydown', onKeydown)

      // Inline mounts requested while config was in flight.
      const queued = inlineQueue.splice(0)
      queued.forEach((attach) => attach())

      // Inline-only pages get no launcher, and nothing below applies to them.
      if (!wantsLauncher) return

      mount(result.theme)

      // Someone called open() while the config was still in flight.
      if (pendingOpen) {
        pendingOpen = false
        open()
        return
      }

      if (typeof result.theme.autoOpenAfter === 'number') {
        setTimeout(open, result.theme.autoOpenAfter * 1000)
      }
    })
  }

  // `document.body` is null if the snippet was placed in <head>. Waiting for
  // DOMContentLoaded is what makes the paste location a non-question.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
