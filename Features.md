# Features

Everything this project does today, grouped by the surface it lives on.

Scope note: this documents what is **built and in the repository**. The
retrieval and generation steps themselves run in n8n workflows outside this
codebase — as does the meeting booking in §7 — see
[N8N_INTEGRATION.md](./N8N_INTEGRATION.md) for both contracts.

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

| Control | Notes |
|---|---|
| Accent colour | Header, launcher and send button. Its foreground is derived so text stays legible on any accent. |
| Background colour | The whole neutral ramp — bubbles, borders, muted text — is blended from this and the text colour, so a dark value yields a coherent dark panel rather than dark-on-light wreckage. |
| Text colour | Auto by default (black or white, whichever reads better). Overridable for brands that need a specific ink. |
| Contrast warning | The editor computes the WCAG ratio live and warns below 4.5:1 — including the mid-tone case, where *no* automatic foreground can clear AA. It reports the limit rather than pretending to fix it. |
| Live preview | A miniature panel and launcher render from the unsaved draft, marked **Unsaved** until written. It runs the same `derivePalette` the widget does, so the colours shown are the real arithmetic, not an approximation. |
| Layout and copy | Left/right position, offsets, title, subtitle, opening message, launcher label, up to four starter questions, optional auto-open delay, branding toggle. |

## 7. Meeting booking

The assistant can put a meeting on the tenant's own calendar and confirm it by
email from the tenant's own address — so the lead hears from a name they
recognise rather than from an unfamiliar sender.

⚠️ The booking itself happens in an n8n workflow. What lives here is everything
around it: the connection, the credentials, the template, and the record. The
app never creates a calendar event or sends a message.

### Google connection

| Feature | Detail |
|---|---|
| One account per workspace | `UNIQUE (company_id, provider)`, so reconnecting re-consents the same row instead of accumulating grants nobody is tracking. |
| Narrow scopes | `calendar.events` creates the meeting but cannot delete a calendar; `calendar.freebusy` sees only whether a span is busy, never what the event is; `gmail.send` sends the confirmation and cannot read a single message. `openid email` buys no access at all — it is the only way to learn *which* mailbox consented, since `gmail.send` does not grant `users.getProfile`. |
| Tokens encrypted at rest | AES-256-GCM in the app, key from the environment. A copy of the database is not a copy of the tenant's mailbox. GCM authenticates as well as encrypts, so a tampered row fails to decrypt rather than yielding a token pointed somewhere else. |
| Ciphertext never reaches a browser | The two encrypted columns sit outside `authenticated`'s GRANT, so PostgREST refuses to return them even when RLS would allow the row. |
| Signed OAuth `state` | HMAC over (workspace, user, nonce, expiry), and the callback additionally requires the same session that started the flow. A bare workspace id in `state` would let anyone bind *their* Google account to *someone else's* workspace. |
| Refresh ahead of expiry | The token is renewed 120s before it lapses and the new one persisted, so a workflow never receives a credential that dies between creating the event and sending the mail. |
| Honest failure states | `invalid_grant` — the account itself saying no — marks the connection revoked and clears the tokens. Anything else marks it `error`, because a transient failure is not a revocation. |
| Disconnect means disconnect | Revokes the refresh token with Google (which invalidates every access token derived from it), then clears the ciphertext. A revoked row holding a live credential is a credential nobody is watching. |

### Availability

| Feature | Detail |
|---|---|
| Weekly hours | Open ranges per weekday, as wall-clock times. Several ranges in a day is how a lunch break is said — 09:00–12:30 and 13:30–17:00 — rather than one span with a hole in it. An empty day is a day off. |
| Wall-clock, never offsets | "I work 9 to 5" has to stay true across a daylight-saving change. An offset resolved at save time silently moves every meeting by an hour twice a year. |
| Its own time zone, never null | Separate from the display zone in Overview, and `NOT NULL` where that one is nullable. "Follow the viewer's browser" is a coherent answer to *how should this be shown to you* and an incoherent one to *what does 09:00 mean to a lead in Toronto*. Seeded from the display zone, independent afterwards. |
| Slot rules | Meeting length, buffer kept clear after each booking, and minimum notice. The buffer is charged after a slot and not at the end of a range — a 60-minute window with a 30-minute meeting and a 15-minute buffer holds one meeting, not none. |
| Validation that says what is wrong | Overlapping ranges, an end before its start, a half-typed time — each reported inline on the day it belongs to, and Save stays disabled until they are gone. Ranges that merely touch (17:00 then 17:00) are one block written as two, not a conflict. |
| Reads back defensively | The column is jsonb, so it can hold whatever a hand-run statement or a future workflow puts there. Anything unrecognised is dropped on read rather than repaired, so the editor never renders — or re-saves — a shape it does not understand. |
| Never blank | Seeded weekdays 9–5 on first visit, like the email template. A workspace with no schedule row would otherwise mean "no availability at all", which is not what "never opened this page" should mean. |
| Copy a day across | One click to apply a day's hours to the whole week, which is the friction every schedule editor of this kind has. |

### Email template

| Feature | Detail |
|---|---|
| Never blank | A default is seeded at workspace creation *and* lazily on first visit — the second is what covers workspaces that existed before this feature did. |
| One list of variables | `{{lead_name}}`, `{{lead_email}}`, `{{meeting_date}}`, `{{meeting_time}}`, `{{meet_link}}`, `{{company_name}}`. The editor, the preview and the default all read `lib/email/templates.ts`, so there is no second list to drift. |
| Unknown tokens survive | A misspelled `{{meting_time}}` is left exactly as written rather than replaced with nothing, and the editor warns about it. Silently deleting it would hide the mistake until a lead received a sentence with a hole in it. |
| Visual and HTML modes | Both edit the same `body_html` string — the source view is authoritative and the visual view is a convenience over it, so switching modes cannot lose anything. |
| Paste is plain text | A paste out of Word or a webmail thread otherwise drops kilobytes of `mso-` markup into a template that has to render in clients this app cannot test against. |
| Live preview | Rendered against dummy data in a `sandbox=""` iframe. Isolation in the honest direction: Tailwind's preflight would repaint the template into something no mail client produces, and tenant-authored HTML has no business executing in an authenticated console. |

### Meetings record

| Feature | Detail |
|---|---|
| Read-only by design | These rows describe events that exist in Google. Editing one here would change the app's record without changing the meeting the lead was invited to. The calendar is the system of record. |
| Traceable to a conversation | `memory_key` is the same `<visitor>:<thread>` value the chat workflow scopes its memory to, so a booking can be tied back to the exchange that produced it. |
| One zone for the whole list | Set in Admin → Overview, defaulting to the viewer's browser. `meetings.timezone` records whatever the booking workflow sent — `Asia/Kolkata` on one row, the legacy alias `IST` on the next, null on the one after — and ICU accepts most of it, so rendering each row in its own recorded zone produced a list where no two rows were comparable and none were in the reader's zone. `starts_at` is a `timestamptz` and already names the exact moment, so the zone is purely a rendering choice and the owner's is the useful one. |
| The picker offers current names | `Intl.supportedValuesOf` returns ICU's canonical list, which keeps the *older* half of a renamed pair — so it offers `Asia/Calcutta`, never `Asia/Kolkata`, and `UTC` not at all. Both names format identically, so the modern one is substituted for the handful of renames someone would notice missing. |
| Online and in-person | A Meet link when there is one, and no dangling "Join here" when there is not. |

### Server-to-server token endpoint

`GET /api/internal/google/token?company_id=…`, authenticated by
`X-Internal-Secret` and nothing else — there is no session on a call from a
workflow. It hands back a checked-for-freshness access token, so the refresh
token never leaves this app for a credential store with no revocation story.
Unset secret means every request is refused; the endpoint fails closed.

## 8. Security

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

The controls protecting the tenant's Google credentials — encryption at rest, a
signed OAuth `state`, a session-bound callback, and an internal endpoint that
fails closed when its secret is unset — are described in §7 rather than repeated
here.

## 9. Console

| Feature | Detail |
|---|---|
| Workspaces | List, create, and open. Each shows its own key and index. |
| Documents | Add context, browse indexed sources filtered by kind, delete. |
| Websites | Add sites, copy install snippets, approve origins, edit themes, enable/disable, delete. |
| Admin | Five tabs behind one rail destination — **Overview** (index health, share link, key reveal/copy/rotate, display time zone, workspace record, delete), **Integrations**, **Availability**, **Email Templates**, **Meetings**, in roughly the order a workspace is set up. They are tabs and not five more rail icons because nine entries in a 64px column, or in a phone's bottom bar, stops being scannable. |
| Responsive shell | A 64px icon rail on desktop; below `md` it becomes a bottom bar, because a fixed rail costs a sixth of a phone's width. |
| Live polling | The Websites page re-checks every 6s while any install is pending, then stops. |
| Optimistic updates | Toggles apply immediately rather than waiting on a round trip. |

## 10. Design system

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

## 11. Engineering practices

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
- **The booking step itself.** The app connects the account, holds the
  credentials, stores the template and shows the result. Creating the calendar
  event and sending the mail is the n8n workflow's job.
- **Slot computation.** The console stores the hours and the rules; turning them
  into "here are three times on Thursday" — and checking them against the
  calendar's existing events — is the workflow's job.
- **Date overrides.** No way to say "closed on the 25th" or "half day on
  Friday the 3rd" without editing the weekly hours and putting them back.
- **Overnight ranges.** A range must end after it starts, so hours crossing
  midnight have to be written as two days.
- **Reminder and cancellation emails.** `email_templates.template_key` exists to
  hold them, but `meeting_confirmation` is the only key the console writes.
- **Rescheduling or cancelling from the console.** The Meetings list is
  read-only; changes have to happen in the calendar.
- **Choosing a calendar.** `oauth_connections.calendar_id` is stored and
  honoured, but there is no UI to point it at anything other than `primary`.
- **Providers other than Google.** `provider` is a column rather than an
  assumption, so Microsoft is a new value — but only Google is implemented.
