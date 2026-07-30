/**
 * Widget session tokens — the piece that makes origin checking actually mean
 * something once the chat UI is inside an iframe.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The panel runs at /embed/<key> on *our* origin. So when it POSTs to
 * /api/widget/chat the browser sends `Origin: https://app.sysmatixx.com` — our
 * own origin, not the customer's site. The allowlist check that works for the
 * loader is therefore worthless on the chat route, and a scraped public key
 * could be replayed with curl from anywhere.
 *
 * THE FIX
 * -------
 * The one moment we can see the true parent origin is the loader's config
 * request: that call *is* cross-origin, so the browser attaches the host page's
 * real `Origin`, and a browser cannot be talked into forging it. At that point
 * the server mints a short-lived token bound to (site, origin) and signs it.
 * The token rides into the iframe over postMessage and authenticates every
 * subsequent chat call.
 *
 * curl can still fetch a config token — it can claim any Origin it likes — but
 * it gains nothing it did not already have, and the per-key rate limit bounds
 * that. What this does buy is that the *chat* endpoint no longer accepts a bare
 * public key from anywhere on the internet, and every request carries a
 * server-attested site id that cannot be swapped for another tenant's.
 */

const encoder = new TextEncoder()

/** Two hours. Long enough for a real session, short enough that a leaked token rots. */
export const SESSION_TTL_SECONDS = 2 * 60 * 60

export interface WidgetSession {
  siteId: string
  origin: string
}

/**
 * Two token kinds share this machinery, and `t` is what keeps them apart.
 *
 *   's' — the session: authenticates chat requests. Bearer credential.
 *   'f' — the frame token: carries nothing but a verified origin, and is used
 *         only to build the `frame-ancestors` header for the embed page.
 *
 * Without the discriminator a frame token — which travels in a URL, and so
 * ends up in server logs and browser history — would be accepted as a session.
 */
type TokenKind = 's' | 'f'

/** Compact on purpose — the session travels in a header on every message. */
interface SessionPayload {
  t?: TokenKind
  s: string
  o: string
  /** Expiry, epoch seconds. */
  e: number
}

/**
 * `WIDGET_SESSION_SECRET` is preferred so that rotating the database key does
 * not sign every visitor out of a chat mid-conversation. Falling back to the
 * service-role key keeps deployments that have not set it working, since it is
 * already high-entropy and already secret.
 */
function secretMaterial(): string {
  const secret =
    process.env.WIDGET_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!secret) {
    throw new Error(
      'Missing WIDGET_SESSION_SECRET (and no SUPABASE_SERVICE_ROLE_KEY to fall back to) — widget sessions cannot be signed.',
    )
  }

  return secret
}

let cachedKey: Promise<CryptoKey> | null = null

function signingKey(): Promise<CryptoKey> {
  cachedKey ??= crypto.subtle
    .importKey(
      'raw',
      encoder.encode(secretMaterial()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    )
    .catch((error: unknown) => {
      // A cached rejected promise would be returned forever, turning one bad
      // import into permanent failure for the life of the instance. Clearing
      // it means the next call retries.
      cachedKey = null
      throw error
    })

  return cachedKey
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCodePoint(byte)
  // '=' only ever appears as trailing padding in base64, so stripping every
  // occurrence is the same as stripping the suffix — and avoids an anchored
  // quantifier that a hostile input could make backtrack.
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0)
  } catch {
    return null
  }
}

async function mint(payload: SessionPayload): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    encoder.encode(body),
  )

  return `${body}.${toBase64Url(new Uint8Array(signature))}`
}

async function open(
  token: string | null | undefined,
  expectedKind: TokenKind,
): Promise<SessionPayload | null> {
  if (!token) return null

  const separator = token.indexOf('.')
  if (separator <= 0) return null

  const body = token.slice(0, separator)
  const signature = fromBase64Url(token.slice(separator + 1))
  if (!signature) return null

  // subtle.verify rather than re-signing and comparing strings: it compares in
  // constant time, so the check leaks nothing about the expected signature.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(),
    signature as unknown as ArrayBuffer,
    encoder.encode(body),
  )
  if (!valid) return null

  const decoded = fromBase64Url(body)
  if (!decoded) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(decoded)) as SessionPayload
    if (typeof payload.e !== 'number' || payload.e * 1000 < Date.now()) return null
    // Tokens minted before `t` existed are sessions; anything else must match.
    if ((payload.t ?? 's') !== expectedKind) return null

    return payload
  } catch {
    return null
  }
}

export async function mintWidgetSession(
  siteId: string,
  origin: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  return mint({
    t: 's',
    s: siteId,
    o: origin,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  })
}

export async function verifyWidgetSession(
  token: string | null | undefined,
): Promise<WidgetSession | null> {
  const payload = await open(token, 's')
  if (!payload || typeof payload.s !== 'string') return null

  return { siteId: payload.s, origin: typeof payload.o === 'string' ? payload.o : '' }
}

/**
 * A token that says nothing except "this origin was verified", used to build
 * the embed page's `frame-ancestors` header.
 *
 * It rides in the iframe URL, which means it lands in access logs and browser
 * history — so it deliberately grants nothing. The worst a leaked frame token
 * allows is framing the panel from the origin that was already allowed to
 * frame it. Keeping this separate from the session is what lets middleware set
 * a per-site CSP with no database round trip on every panel open.
 */
export async function mintFrameToken(
  origin: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  return mint({
    t: 'f',
    s: '',
    o: origin,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  })
}

export async function verifyFrameToken(
  token: string | null | undefined,
): Promise<string | null> {
  const payload = await open(token, 'f')
  return payload && typeof payload.o === 'string' && payload.o ? payload.o : null
}

/** Reads the token from either the Authorization header or an explicit header. */
export function readSessionToken(headers: Headers): string | null {
  const authorization = headers.get('authorization')
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim() || null
  }

  return headers.get('x-widget-session')?.trim() || null
}
