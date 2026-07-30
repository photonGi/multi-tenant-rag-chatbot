# @shoaibakhter.sysmatixx/chat-widget

Embed a Multi-Tenant Chatbot RAG assistant into a JavaScript app.

**You probably don't need this package.** The supported install for every stack
is one script tag, and it works in React, Vue, WordPress, Rails, Shopify and
plain HTML alike:

```html
<script src="https://mt-rag-chatbots.vercel.app/widget.js" data-key="pk_live_..." async></script>
```

In a React or Vue app that means `public/index.html` (CRA) or `index.html`
(Vite) — outside the app root, where route changes can never disturb it.

Reach for this package only when you need to **control** the widget from code:
hide it on certain routes, or open it from your own button.

## Install

```bash
npm i @shoaibakhter.sysmatixx/chat-widget
```

## React

Mount once, above your router:

```tsx
import { ChatWidget } from '@shoaibakhter.sysmatixx/chat-widget/react'

export default function App() {
  return (
    <>
      <BrowserRouter>{/* routes */}</BrowserRouter>
      <ChatWidget publicKey="pk_live_..." />
    </>
  )
}
```

Mounting it *inside* a routed component makes it tear down and re-inject on
every navigation — a config request each time, and the panel closes under
whoever was typing.

### Hide it on some routes

```tsx
const { pathname } = useLocation()

<ChatWidget publicKey="pk_live_..." enabled={!pathname.startsWith('/admin')} />
```

### Open it from your own button

```tsx
import { openChat } from '@shoaibakhter.sysmatixx/chat-widget'

<button onClick={openChat}>Need help?</button>
```

`openChat` is safe to call before the script has finished loading — the intent
is queued, so the first click works even on a cold page.

## Inline mode — the chat as part of your page

Instead of a bubble floating over everything, dock the chat into a container
you own and lay out yourself. Good for a support tab, a sidebar, or a dedicated
`/help` route.

```tsx
import { InlineChatWidget } from '@shoaibakhter.sysmatixx/chat-widget/react'

<InlineChatWidget
  publicKey="pk_live_..."
  style={{ height: 600, maxWidth: 420, borderRadius: 16, overflow: 'hidden' }}
/>
```

It renders one `<div>` and fills it. **Give it a height** — a bare div collapses
to zero and the chat will look like it never loaded. There is a 520px default
so an unstyled container still shows something.

No launcher appears in this mode. Pass `launcher` if you want both:

```tsx
<InlineChatWidget publicKey="pk_live_..." launcher />
```

In inline mode the panel drops its close button — the container is yours, so
dismissing it is your call, not the widget's.

Vanilla equivalent:

```ts
import { mountInlineChat } from '@shoaibakhter.sysmatixx/chat-widget'

const dispose = mountInlineChat({
  publicKey: 'pk_live_...',
  target: document.getElementById('chat')!,
})
```

Both are still iframes, exactly like the floating panel. An inline chat sits in
the middle of your layout, so it is if anything *more* exposed to your CSS —
keeping the isolation is what stops your stylesheet and the panel's interfering
with each other.

## Vue, Svelte, Angular, vanilla

```ts
import { loadChatWidget } from '@shoaibakhter.sysmatixx/chat-widget'

// Returns a cleanup function.
const dispose = loadChatWidget({ publicKey: 'pk_live_...' })

onUnmounted(dispose)
```

## Next.js

Prefer `next/script` — no package needed:

```tsx
import Script from 'next/script'

<Script
  src="https://mt-rag-chatbots.vercel.app/widget.js"
  data-key="pk_live_..."
  strategy="afterInteractive"
/>
```

## API

| Export | Description |
| --- | --- |
| `ChatWidget` | React component (from `…/react`). Floating launcher. Renders nothing. |
| `InlineChatWidget` | React component (from `…/react`). Docks the chat into a div you style. |
| `loadChatWidget(options)` | Injects the loader. Returns a cleanup function. |
| `mountInlineChat(options)` | Docks a chat into `options.target`. Returns a disposer. |
| `openChat()` / `closeChat()` / `toggleChat()` | Controls. Queue until the widget is ready. |
| `isChatOpen()` | Synchronous. `false` until the widget has loaded. |
| `whenChatReady(timeoutMs?)` | Resolves with the widget API, or rejects if it never loads. |
| `destroyChat()` | Removes the widget entirely. |

### Options

| Option | Default | Description |
| --- | --- | --- |
| `publicKey` | — | Required. From the workspace's **Websites** tab. |
| `appUrl` | `https://mt-rag-chatbots.vercel.app` | Override when self-hosting. |
| `enabled` | `true` | `ChatWidget` only. `false` unmounts the widget. |
| `launcher` | `true`, or `false` for inline | Show the floating bubble. Only the first call on a page decides this — the loader is a singleton. |
| `target` | — | `mountInlineChat` only. The element to fill. |
| `className` / `style` | — | `InlineChatWidget` only. Applied to the container div. |

## Why the widget stays out of the React tree

It renders into its own shadow root appended to `document.body`, and the
conversation itself runs in an iframe. Your CSS cannot leak into it, its CSS
cannot leak into your page, and there is no second copy of React involved.

## Origins

A widget only runs on the origins its site has been given in the dashboard. If
nothing appears, check the **Websites** tab — an unlisted origin (a preview
deploy, a staging domain) is recorded there and can be approved in one click.
