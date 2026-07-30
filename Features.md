# Features

Everything this project does today, grouped by the surface it lives on.

Scope note: this documents what is **built and in the repository**. The
retrieval and generation steps themselves run in n8n workflows outside this
codebase — see [N8N_INTEGRATION.md](./N8N_INTEGRATION.md) for that contract.

---

## 1. Multi-tenancy

The tenant boundary is a **workspace** (`companies` table). Everything else
hangs off it.

| Feature | Detail |
|---|---|
| Isolated document index | Each workspace has its own documents, chunks and embeddings. Vector search is scoped by `company_id` in `match_documents()`. |
| Per-workspace key | 32 random bytes as hex, from the Web Crypto API — never `Math.random()`. |
| Multiple workspaces per user | One account can own any number, each fully separate. |
| Row Level Security | Every table has RLS policies keyed on `auth.uid()`. A user can only ever reach rows belonging to workspaces they own. |
| Key rotation | Regenerates the workspace key from Admin. Retires every share link already handed out. |
| Cascade delete | Deleting a workspace removes its documents, chunks, conversations and messages. |

## 2. Authentication

| Feature | Detail |
|---|---|
| Email + password sign-up | Supabase Auth, with email confirmation. |
| Sign-in / sign-out | Session refreshed on every request through the proxy layer. |
| OAuth callback | `/auth/callback` exchanges the code for a session. |
| Route protection | `/`, `/documents`, `/admin`, `/dashboard`, `/websites` require a session; unauthenticated requests redirect to login. |
| Public routes stay public | `/chat/[key]`, `/embed/[key]` and `/api/widget/*` never touch auth — a visitor on someone else's website has no session here. |
| Confirmation + error states | Dedicated pages rather than raw error strings. |

## 3. Document ingestion

Three source kinds, one pipeline. A file is one option, not the requirement.

| Source | How it works |
|---|---|
| **File** | The picker accepts `.txt .pdf .doc .docx .png .jpg .jpeg`. Sent as multipart to the n8n ingest webhook. (`classifySource` additionally recognises `.md .csv .json`, so sources ingested by other means still display correctly — they just cannot be chosen in the UI.) |
| **Text** | Paste anything — policies, notes, FAQs, product details. |
| **Website URL** | The workflow fetches the page itself; only the address is sent. |

Supporting behaviour:

- **Source kind recovered from the stored name** — `classifySource()` infers
  file / text / website from `source_name`, so the list shows the right icon
  and badge with no schema change and no backfill.
- **Index health** — live document count, chunk count, and the embedding model
  (MiniLM-L6, 384 dimensions) shown on the Documents page.
- **Delete with cleanup** — removing a source deletes its chunks too;
  `scripts/cleanup-orphaned-chunks.sql` handles anything stranded by n8n.
- **Labels** — a human name per source, used in the assistant's citations.

## 4. Retrieval and chat

| Feature | Detail |
|---|---|
| Vector search | pgvector with an **HNSW** index — chosen over IVFFlat because IVFFlat trains its centroids at index-creation time and has poor recall when built on an empty table. |
| Cosine similarity | `match_documents(query_embedding, company_id, count, threshold)`, `SECURITY INVOKER` so RLS still applies to direct callers. |
| Conversation memory | A `memory_key` of `<visitor>:<thread>` scopes the workflow's memory node to one thread in one browser — stamped once at thread creation so every turn carries the same key. |
| Markdown answers | Full rendering with GFM (tables, strikethrough, task lists). |
| Source attribution | Retrieved chunks surface as a "Context Applied" block. |
| Streaming-style reveal | Answer blocks cascade in; the transcript follows via a `ResizeObserver` rather than a single scroll that would stop short. |
| Failure states | A dropped connection or 500 renders as a retryable failed bubble, not a dead page. |

## 5. Public share link

`/chat/[key]` — a full chat module that needs no sign-in.

| Feature | Detail |
|---|---|
| No session required | Everything it needs is in the URL, which is what makes it shareable. |
| Thread list | Multiple conversations, searchable by title and message content. |
| Browser-local history | Stored in `localStorage`, namespaced per link via an FNV-1a hash so two links in one browser never mix. Nothing is written server-side. |
| Cross-tab sync | Another tab on the same link picks up changes instead of overwriting them. |
| Dead-link states | Distinguishes a truncated link (checked locally, no request made) from a revoked one, without revealing whether a workspace exists. |
| Not indexed | `noindex, nofollow` and `Referrer-Policy: no-referrer`. |

⚠️ This link carries the workspace key, which the ingest webhook also accepts.
Treat it as a credential — hand it to named people, not the public web. The
widget below exists precisely because that trade-off is wrong for a website.

## 6. Embeddable website widget

One workspace → many websites, each independently keyed, themed and revocable.
Full detail in [WIDGET.md](./WIDGET.md).

### Installation

| Feature | Detail |
|---|---|
| One snippet, any stack | A single `<script>` tag. The widget runs only in the browser, so the customer's backend is never in the path. |
| Stack-aware instructions | Picking React / Next / Vue / WordPress / Shopify / GTM changes **where the code goes** — the thing that actually stalls installs — not just the code. |
| npm wrapper | `@shoaibakhter.sysmatixx/chat-widget` for SPAs needing programmatic control. React components plus a framework-agnostic core. |
| Two presentations | **Floating** — a launcher bubble opening an overlay panel. **Inline** — docked into a container the host page sizes and styles itself, for a support tab, sidebar or `/help` route. Both can coexist on one page, or the launcher can be switched off entirely. |
| Self-verifying install | The loader's config call doubles as the install beacon; the dashboard flips **Awaiting install → Connected** on its own. No DNS record, no verify button. |
| Origin auto-learn | A load from an unlisted origin (preview deploy, staging domain) is recorded, not just refused, and becomes a one-click **Approve**. |
| Seed on create | Ticking one box crawls the site being added, so the assistant knows its content before the widget goes live. |

### Runtime

| Feature | Detail |
|---|---|
| Tiny and lazy | ~8 KB gzipped, unminified. The floating panel's iframe is created on first open, so a page whose visitors never click pays for one small script and nothing else. |
| Total style isolation | Launcher in a shadow root, conversation in an iframe. Host CSS cannot reach in, widget CSS cannot leak out, and there is no second copy of React. |
| Mobile full-bleed | Below 480px the panel goes full-screen and the page behind it is frozen, so iOS does not scroll underneath. |
| Unread badge | Answers arriving while the panel is shut raise a count on the launcher. |
| Programmatic control | `window.MTChatbot` — `open` / `close` / `toggle` / `isOpen` / `isReady` / `mountInline` / `destroy`, for wiring to a "Need help?" button. |
| Independent panels | Each mounted chat is tracked separately and messages are routed by frame, so closing or unmounting an inline panel never disturbs the floating one. |
| Cold-click queueing | An `open()` that arrives before the config round trip finishes is queued and honoured, rather than silently dropped. |
| Session recovery | An expired session mid-conversation refreshes transparently and the pending message is retried once. |
| Accessibility | `aria-expanded` / `aria-label` on the launcher, Escape to close, `prefers-reduced-motion` respected. |
| Never breaks the host page | Every failure path is silent. A revoked key, a blocked network or an unlisted origin produces nothing at all — the visitor is not your user and can do nothing about it. |

### Theming

Held server-side, so the snippet is pasted once and never touched again.
Accent colour (with an automatically contrast-correct foreground), left/right
position, offsets, title, subtitle, opening message, launcher label, up to four
starter questions, optional auto-open delay, and a branding toggle.

## 7. Security

| Control | Detail |
|---|---|
| Split credentials | `widget_sites.public_key` is chat-only. The workspace key — which also authorises ingest — never reaches a browser on the widget path. |
| Browser-enforced framing | `frame-ancestors` set per site, so a scraped key embedded on an attacker's own site produces a frame the browser refuses to render. |
| Origin allowlist | Checked server-side on the one request that is genuinely cross-origin, where the browser stamps the true origin and a page cannot forge it. Wildcard subdomains supported; suffix attacks (`evil-acme.com` against `acme.com`) explicitly rejected. |
| Signed sessions | HMAC-SHA256, 2-hour TTL, verified in constant time. A separate, powerless token carries only a verified origin for the CSP, so nothing sensitive lands in URLs or access logs. |
| Live revocation | Site status and origins are re-checked against the database on every message, so disabling a site takes effect immediately rather than when tokens expire. |
| Rate limiting | 12/min per visitor, 240/min per site, 60/min on config. Continuous refill rather than fixed windows, which would allow double the intended rate at a boundary. |
| Theme sanitising | Tenant-authored values are interpolated into CSS on a third party's page, so colours are strictly validated and text is length-capped and stripped of control characters. |
| Uniform denials | "No such key" and "wrong origin" are indistinguishable to a caller, so the endpoint cannot be used to enumerate tenants. |
| Server-side n8n calls | Widget traffic never reaches n8n from a browser; an optional `X-Widget-Secret` lets the workflow reject anything not from this backend. |
| Security headers | `X-Frame-Options: DENY` and `frame-ancestors 'none'` site-wide, with `/chat` and `/embed` exempted deliberately; `nosniff`; restrictive `Permissions-Policy`. |

**Known limitation, stated plainly:** a non-browser client can claim any origin
and obtain a session. This is inherent to any public credential and cannot be
fixed cryptographically. Rate limits and per-site counters are the mitigation.

## 8. Console

| Feature | Detail |
|---|---|
| Workspaces | List, create, and open. Each shows its own key and index. |
| Documents | Add context, browse indexed sources filtered by kind, delete. |
| Websites | Add sites, copy install snippets, approve origins, edit themes, enable/disable, delete. |
| Admin | Index health, share link, key reveal/copy/rotate, workspace record, delete. |
| Responsive shell | A 64px icon rail on desktop; below `md` it becomes a bottom bar, because a fixed rail costs a sixth of a phone's width. |
| Live polling | The Websites page re-checks every 6s while any install is pending, then stops. |
| Optimistic updates | Toggles apply immediately rather than waiting on a round trip. |

## 9. Design system

Defined in [Design.md](./Design.md), implemented as Tailwind v4 theme tokens in
`app/globals.css`.

- Grayscale foundation (an 11-step ink scale) with amber reserved for
  intelligence states and primary actions — never for errors.
- Inter for text, JetBrains Mono for anything derived from a database.
- Light-only by deliberate choice; the spec defines no dark palette.
- Shared primitives in `components/console/` so pages are written at the
  intended density without repeating twenty-class strings.
- Motion with intent: a slight overshoot on message entry reads as "settling
  into place" rather than "appearing".

## 10. Engineering practices

| | |
|---|---|
| Type safety | TypeScript strict; the app and the npm package typecheck independently. |
| Runtime validation | Trust boundaries — origins, themes, keys, tokens — validate rather than assume. |
| Verified logic | ~103 assertions covering origin matching (including suffix and wildcard attacks), theme sanitising and CSS injection, key shape, token signing and cross-kind confusion, rate-limit refill, and the localStorage migration. |
| Data migrations | Renaming the storage prefix falls back to the old key, so a rename never silently discards a visitor's saved conversation. |
| Documented decisions | Comments explain *why* — why HNSW over IVFFlat, why an iframe over shadow DOM alone, why a separate frame token — not what the line does. |

---

## Not built

Honest gaps, so nobody goes looking:

- **Server-side chat history.** Conversations live in the visitor's browser
  only. The `conversations` / `messages` tables exist but the chat surfaces do
  not write to them.
- **Analytics dashboard.** Per-site load and message counters are collected and
  shown as numbers; there are no charts or time series.
- **Signed user identity.** Passing a logged-in user's identity from the host
  site into the widget is designed but not implemented — it is the one feature
  that requires touching the customer's backend.
- **Streaming responses.** Answers arrive whole; the cascade is a reveal
  animation, not token streaming.
- **Team accounts.** A workspace has exactly one owner; there is no sharing or
  role model.
- **CJS build of the npm package.** ESM-only, which is fine for Vite, Next and
  webpack 5 but breaks a bare `require()`.
