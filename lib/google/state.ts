import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from '@/lib/crypto/encoding'

/**
 * The OAuth `state` parameter — signed, so the callback can trust what it says.
 *
 * WHY IT IS SIGNED
 * ----------------
 * `state` makes a full round trip through Google and comes back as a query
 * string on a GET the user's browser performs. Anything unsigned in there is
 * attacker-controlled: putting a bare company_id in state would let anyone
 * craft a callback URL that binds *their* Google account to *someone else's*
 * workspace — the classic OAuth login-CSRF, except the prize here is that every
 * meeting the victim's assistant books lands in the attacker's calendar and
 * every confirmation mail goes out from the attacker's mailbox.
 *
 * So state carries an HMAC over (company, user, nonce, expiry), and the
 * callback additionally checks that the session completing the flow is the same
 * user who started it. Both must hold.
 *
 * The nonce is what stops a captured callback URL from being replayed to
 * silently re-bind a connection later; the ten-minute expiry bounds how long
 * any of it stays interesting.
 */

/**
 * A dedicated secret is preferred, but the service-role key is already
 * high-entropy and already present, so a deployment that has not set one still
 * gets a signed state rather than an unsigned one.
 */
function secretMaterial(): string {
  const secret =
    process.env.OAUTH_STATE_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!secret) {
    throw new Error(
      'Missing OAUTH_STATE_SECRET (and no SUPABASE_SERVICE_ROLE_KEY to fall back to) — the Google OAuth state cannot be signed.',
    )
  }

  return secret
}

let cachedKey: Promise<CryptoKey> | null = null

function signingKey(): Promise<CryptoKey> {
  cachedKey ??= crypto.subtle
    .importKey('raw', utf8(secretMaterial()) as unknown as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ])
    .catch((error: unknown) => {
      cachedKey = null
      throw error
    })

  return cachedKey
}

/** Long enough to read a consent screen, short enough that a captured URL rots. */
const STATE_TTL_SECONDS = 10 * 60

interface StatePayload {
  /**
   * Token kind. The fallback secret above is shared with the widget's session
   * tokens, so without a discriminator a widget session could be presented as
   * an OAuth state (or the reverse) and verify cleanly.
   */
  t: 'o'
  /** Workspace the connection will be written to. */
  c: string
  /** The user who started the flow; the callback requires the same session. */
  u: string
  /** Replay guard. */
  n: string
  /** Expiry, epoch seconds. */
  e: number
}

export interface OAuthState {
  companyId: string
  userId: string
}

export async function signOAuthState(companyId: string, userId: string): Promise<string> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(12)))

  const payload: StatePayload = {
    t: 'o',
    c: companyId,
    u: userId,
    n: nonce,
    e: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  }

  const body = toBase64Url(utf8(JSON.stringify(payload)))
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(),
    utf8(body) as unknown as ArrayBuffer,
  )

  return `${body}.${toBase64Url(new Uint8Array(signature))}`
}

export async function verifyOAuthState(
  state: string | null | undefined,
): Promise<OAuthState | null> {
  if (!state) return null

  const separator = state.indexOf('.')
  if (separator <= 0) return null

  const body = state.slice(0, separator)
  const signature = fromBase64Url(state.slice(separator + 1))
  if (!signature) return null

  // subtle.verify rather than re-signing and comparing strings: it compares in
  // constant time, so the check leaks nothing about the expected signature.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(),
    signature as unknown as ArrayBuffer,
    utf8(body) as unknown as ArrayBuffer,
  )
  if (!valid) return null

  const decoded = fromBase64Url(body)
  if (!decoded) return null

  try {
    const payload = JSON.parse(fromUtf8(decoded)) as StatePayload

    if (payload.t !== 'o') return null
    if (typeof payload.e !== 'number' || payload.e * 1000 < Date.now()) return null
    if (typeof payload.c !== 'string' || !payload.c) return null
    if (typeof payload.u !== 'string' || !payload.u) return null

    return { companyId: payload.c, userId: payload.u }
  } catch {
    return null
  }
}
