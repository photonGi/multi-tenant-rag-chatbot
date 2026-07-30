# Embeddable Chat Widget

Put a workspace's assistant on any website with one script tag. One workspace
can have many websites, each with its own key, theme, allowed origins and kill
switch.

---

## 1. Why this is not just the share link

The public share link at `/chat/[key]` posts `companies.api_key` straight from
the browser to n8n. That is acceptable for a link handed to named people, but a
widget puts its credential in the **HTML source of a public website**.

`companies.api_key` also authorises `/webhook/ingest`. Embedding it would let
anyone who views source push poisoned documents into that tenant's vector index.

So the widget uses a second credential — `widget_sites.public_key`, prefixed
`pk_live_` — which:

| | `companies.api_key` | `widget_sites.public_key` |
|---|---|---|
| Can ingest documents | **yes** | no |
| Reaches n8n | directly, from the browser | never — server swaps it |
| Bound to origins | no | yes |
| Rate limited | no | yes |
| Revocable alone | no (rotating kills every link) | yes, per site |

---

## 2. Setup

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Widget routes are anonymous — a visitor on a customer's site has no session — so they resolve `widget_sites` as service_role and authorise in code. Without it the widget cannot start. |
| `NEXT_PUBLIC_APP_URL` | **yes in production** | The stable domain customers paste into their sites, e.g. `https://mt-rag-chatbots.vercel.app`. Falls back to `VERCEL_URL`, which is per-deployment and therefore wrong for a production snippet. |
| `WIDGET_SESSION_SECRET` | recommended | Signs widget session tokens. Falls back to the service-role key, which works but means rotating the database key signs every visitor out mid-conversation. Any long random string. |
| `N8N_WEBHOOK_BASE_URL` | optional | Defaults to the value hardcoded in `lib/n8n/client.ts`. |
| `N8N_SHARED_SECRET` | recommended | Sent as `X-Widget-Secret` on server-to-n8n calls. Add a matching check to the workflow so the webhook only answers this backend. |

```bash
# .env.local
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=https://mt-rag-chatbots.vercel.app
WIDGET_SESSION_SECRET=$(openssl rand -hex 32)
N8N_SHARED_SECRET=$(openssl rand -hex 32)
```

### Database

Run `scripts/widget-schema.sql` in the Supabase SQL editor. It is additive —
it creates `widget_sites` plus two RPCs and touches no existing table.

### n8n

Optional but recommended: in the `/webhook/chat` workflow, add a first node that
rejects requests whose `X-Widget-Secret` header does not match
`N8N_SHARED_SECRET`. The webhook URL is guessable; without this, anyone holding
a workspace key can call it directly.

The chat payload gains one optional field, `site_id`, when the question came
from a widget. Retrieval is still scoped by `api_key` — it is there for
per-site analytics.

---

## 3. Owner flow

1. **Workspace → Websites → Add website.** Enter a domain (`shop.acme.com`).
2. A `pk_live_…` key is generated and the allowlist is derived — both the apex
   and `www` form, because those are different origins to a browser but the
   same site to a person.
3. Optionally tick **Crawl this site to seed the assistant**, which runs the
   existing `kind: 'url'` ingest against the domain so the bot knows the site
   before the widget is live.
4. **Install** shows the snippet with a stack picker. Picking React or Shopify
   changes *where the code goes*, which is what actually stalls installs.
5. They paste and deploy.
6. The status flips **Awaiting install → Connected** on its own. The loader's
   config call doubles as the install beacon, so there is no DNS record to add
   and no verify button. The dashboard polls every 6s while anything is pending.
7. Deployed to a preview URL first? The widget stays inert there, but the
   origin is recorded and appears in the card with a one-click **Approve**.
8. Theme changes go live on the next page load. **The snippet never changes.**

---

## 4. Install snippets

The same tag works everywhere HTML is rendered — the widget only runs in the
browser, so the customer's backend is never in the path.

```html
<script src="https://mt-rag-chatbots.vercel.app/widget.js" data-key="pk_live_..." async></script>
```

| Stack | Where |
|---|---|
| Plain HTML / PHP / Rails / Django / Laravel | before `</body>` in the layout |
| React (CRA) | `public/index.html` |
| React (Vite) | `index.html` |
| Next.js | `<Script strategy="afterInteractive">` in the root layout |
| Vue / Nuxt | `index.html`, or `app.head.script` |
| WordPress | `wp_footer` hook in `functions.php` |
| Shopify | `layout/theme.liquid` |
| Google Tag Manager | Custom HTML tag, All Pages |

For SPAs that need programmatic control, `packages/chat-widget` wraps the same
script — see its README.

---

## 5. Architecture

```
Customer's page (any stack)
  │
  ├─ widget.js  ── shadow root: launcher bubble only (~4KB, no iframe yet)
  │     │
  │     └─ GET /api/widget/config?key=pk_live_…
  │            ├─ Origin header checked against allowed_origins
  │            ├─ records the load → flips pending → active
  │            └─ returns { theme, session, frameToken, embedUrl }
  │
  └─ on first click → iframe → /embed/<key>?fa=<frameToken>
          │     proxy.ts sets frame-ancestors from the frame token
          │
          ├─ postMessage handshake: panel says "ready", loader sends "init"
          │
          └─ POST /api/widget/chat  (Authorization: Bearer <session>)
                 ├─ HMAC verified, site + origin re-checked against the live row
                 ├─ rate limited per visitor and per site
                 └─ server calls n8n with companies.api_key
```

### Why an iframe rather than injecting the UI

Total CSS isolation both ways, no second copy of React on the host page, and
the host's CSP cannot break the panel. Shadow DOM alone shares JS globals and
CSP. The launcher lives in the parent's shadow root because an iframe cannot
overflow its own bounds.

### Why the session token exists

The panel runs on **our** origin, so when it POSTs to `/api/widget/chat` the
browser sends *our* origin — not the customer's. The allowlist check that works
for the loader is worthless there.

The loader's config call is the one request that is genuinely cross-origin, so
it is the only place the true parent origin can be established. The server mints
an HMAC-signed token bound to (site, origin) at that moment; the token travels
into the iframe over postMessage and authenticates every message.

### Why a separate frame token

`frame-ancestors` must be set per-site, cannot be set from an App Router page,
and varies per tenant — so it lives in `proxy.ts`. Passing a signed
*origin-only* token in the iframe URL means no database lookup on the path a
visitor waits for. It authorises nothing, which matters because URLs land in
access logs; the worst a leaked one allows is framing the panel from an origin
that could already frame it.

---

## 6. Security model

**Enforced by the browser, cannot be bypassed:**

- `frame-ancestors`, set per site. An attacker who scrapes a key and embeds the
  snippet on their own site gets a frame the browser refuses to render.
- The `Origin` header on the config call. A page cannot forge its own origin.

**Enforced by us:**

- Public key is chat-only. `companies.api_key` never leaves the server.
- Origin and status re-checked against the live row on every message, so
  disabling a site takes effect immediately rather than when tokens expire.
- HMAC-signed sessions, 2h TTL, with a transparent refresh on 401.
- Rate limits: 12/min per visitor, 240/min per site, 60/min on config.
- Theme values are sanitised before they reach CSS — `sanitizeHexColor` is a
  trust boundary, since a tenant-authored accent is interpolated into a
  stylesheet on a third party's page.
- Denial responses are uniform. "No such key" and "wrong origin" look identical
  so the endpoint cannot be used to enumerate tenants.

**Known limitation, stated plainly:** a non-browser client (curl) can claim any
`Origin` it likes and obtain a session. This is inherent to any public
credential — every widget vendor has it — and cannot be fixed cryptographically.
The mitigations are the rate limits above plus the per-site counters in the
dashboard. If a site's message count looks wrong, disable it and rotate.

The in-process rate limiter is per-instance on Vercel, so the effective ceiling
is `limit × warm instances`. It stops the realistic abuse case; it is not a
defence against a distributed attacker. Every caller goes through
`consume()` in `lib/widget/rate-limit.ts` so swapping in Upstash or Vercel KV
stays a one-file change.

---

## 7. Files

| Path | Role |
|---|---|
| `scripts/widget-schema.sql` | Table, RLS, telemetry RPCs |
| `public/widget.js` | The loader customers paste. Ship minified. |
| `app/embed/[key]/` | The panel inside the iframe |
| `app/api/widget/config/` | Origin check, theme, session, install beacon |
| `app/api/widget/chat/` | Session-authenticated proxy to n8n |
| `app/websites/` | Owner dashboard |
| `lib/widget/origins.ts` | Sole authority on origin matching |
| `lib/widget/session.ts` | HMAC session and frame tokens |
| `lib/widget/theme.ts` | Theme sanitising — a trust boundary |
| `lib/widget/site.ts` | Resolution and authorisation |
| `lib/widget/protocol.ts` | The postMessage contract, shared by both sides |
| `packages/chat-widget/` | npm wrapper for SPAs |

---

## 8. Local testing

The allowlist is origin-based, so a local page needs its origin registered:

1. Add a website in the dashboard with the domain `http://localhost:8080`.
2. Serve a test page from that exact port:

```bash
mkdir -p /tmp/widget-test && cd /tmp/widget-test
cat > index.html <<'HTML'
<!doctype html><html><body>
  <h1>Host page</h1>
  <script src="http://localhost:3000/widget.js" data-key="pk_live_..." async></script>
</body></html>
HTML
python3 -m http.server 8080
```

3. Open `http://localhost:8080`. The launcher should appear, and the dashboard
   should flip to **Connected** within a few seconds.

If nothing appears, open the console: the loader is silent by design, so check
the Network tab for the `/api/widget/config` response. A 403 means the origin
is not allowed — and it will now be listed in the dashboard, ready to approve.
