# @sysmatixx/chat-widget

Embed a CerebrOS RAG assistant into a JavaScript app.

**You probably don't need this package.** The supported install for every stack
is one script tag, and it works in React, Vue, WordPress, Rails, Shopify and
plain HTML alike:

```html
<script src="https://app.sysmatixx.com/widget.js" data-key="pk_live_..." async></script>
```

In a React or Vue app that means `public/index.html` (CRA) or `index.html`
(Vite) — outside the app root, where route changes can never disturb it.

Reach for this package only when you need to **control** the widget from code:
hide it on certain routes, or open it from your own button.

## Install

```bash
npm i @sysmatixx/chat-widget
```

## React

Mount once, above your router:

```tsx
import { ChatWidget } from '@sysmatixx/chat-widget/react'

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
import { openChat } from '@sysmatixx/chat-widget'

<button onClick={openChat}>Need help?</button>
```

`openChat` is safe to call before the script has finished loading — the intent
is queued, so the first click works even on a cold page.

## Vue, Svelte, Angular, vanilla

```ts
import { loadChatWidget } from '@sysmatixx/chat-widget'

// Returns a cleanup function.
const dispose = loadChatWidget({ publicKey: 'pk_live_...' })

onUnmounted(dispose)
```

## Next.js

Prefer `next/script` — no package needed:

```tsx
import Script from 'next/script'

<Script
  src="https://app.sysmatixx.com/widget.js"
  data-key="pk_live_..."
  strategy="afterInteractive"
/>
```

## API

| Export | Description |
| --- | --- |
| `ChatWidget` | React component (from `@sysmatixx/chat-widget/react`). Renders nothing. |
| `loadChatWidget(options)` | Injects the loader. Returns a cleanup function. |
| `openChat()` / `closeChat()` / `toggleChat()` | Controls. Queue until the widget is ready. |
| `isChatOpen()` | Synchronous. `false` until the widget has loaded. |
| `whenChatReady(timeoutMs?)` | Resolves with the widget API, or rejects if it never loads. |
| `destroyChat()` | Removes the widget entirely. |

### Options

| Option | Default | Description |
| --- | --- | --- |
| `publicKey` | — | Required. From the workspace's **Websites** tab. |
| `appUrl` | `https://app.sysmatixx.com` | Override when self-hosting. |
| `enabled` | `true` | React only. `false` unmounts the widget. |

## Why the widget stays out of the React tree

It renders into its own shadow root appended to `document.body`, and the
conversation itself runs in an iframe. Your CSS cannot leak into it, its CSS
cannot leak into your page, and there is no second copy of React involved.

## Origins

A widget only runs on the origins its site has been given in the dashboard. If
nothing appears, check the **Websites** tab — an unlisted origin (a preview
deploy, a staging domain) is recorded there and can be approved in one click.
