import { fromBase64Url, fromUtf8 } from '@/lib/crypto/encoding'
// Deployment-wide, despite living under lib/widget — it resolves the public
// base URL of this app, which is what the OAuth redirect URI has to be built
// from. Duplicating that precedence order is how the two drift apart.
import { appBaseUrl } from '@/lib/widget/http'

/**
 * Google OAuth, as the meeting-booking feature needs it: consent once per
 * workspace, then hold a refresh token that lets the booking workflow write a
 * calendar event and send the confirmation mail as the tenant.
 *
 * Everything here is server-only — it uses the client secret.
 */

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

/**
 * The two scopes the feature actually uses, plus the identity pair.
 *
 * `calendar.events` — create and update the meeting itself. Narrower than
 * `calendar`, which would also hand over the ability to delete whole calendars.
 * `gmail.send` — send the confirmation. Send-only: it cannot read a single
 * message in the tenant's mailbox, which is the difference that makes this
 * consent screen defensible.
 *
 * `openid email` is the third thing, and it is not decoration. Neither scope
 * above can tell us *which* account consented — `gmail.send` does not grant
 * users.getProfile — so without it `connected_email` could never be filled in
 * and the console could only say "connected to some Google account". With
 * `openid` the token response carries an id_token we read the address out of,
 * at the cost of no additional access whatsoever.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/gmail.send'
] as const

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

/**
 * Thrown when the environment cannot support the flow at all. Distinct from a
 * rejected exchange: this one is a deployment mistake, not a user's decision.
 */
export class GoogleConfigError extends Error {}

export function googleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()

  if (!clientId || !clientSecret) {
    throw new GoogleConfigError(
      'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET — the Google integration cannot start a consent flow.',
    )
  }

  // Overridable because the value has to match an entry in the Google Cloud
  // console character for character, and a preview deployment's URL will not.
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${appBaseUrl()}/api/auth/google/callback`

  return { clientId, clientSecret, redirectUri }
}

/** True when a consent flow could be started. Used by the console to explain itself. */
export function googleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim())
}

export function buildConsentUrl(state: string): string {
  const { clientId, redirectUri } = googleOAuthConfig()

  const url = new URL(AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  // Without access_type=offline there is no refresh token, and the whole
  // integration would stop working an hour after the owner closed the tab.
  url.searchParams.set('access_type', 'offline')
  // Google issues a refresh token only on the *first* consent for a
  // (client, account) pair. A tenant reconnecting after a disconnect would
  // otherwise get an access token and nothing durable behind it, so consent is
  // forced every time rather than sometimes.
  url.searchParams.set('prompt', 'consent')
  // Lets Google widen the grant later without invalidating what we already
  // have, instead of failing the exchange outright.
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)

  return url.toString()
}

export interface GoogleTokens {
  accessToken: string
  /** Absent when Google declines to re-issue one; callers must keep the old one. */
  refreshToken: string | null
  /** ISO timestamp. */
  expiresAt: string
  /** From the id_token, when the identity scopes were granted. */
  email: string | null
  scope: string | null
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

/**
 * A rejection from Google's token endpoint.
 *
 * `invalidGrant` is called out because it is the only one with a distinct
 * meaning downstream: the refresh token is dead — revoked from the Google
 * account page, expired after six months idle, or invalidated by a password
 * change — and the connection should be marked revoked rather than retried.
 */
export class GoogleTokenError extends Error {
  readonly code: string
  readonly invalidGrant: boolean

  constructor(code: string, description?: string) {
    super(description ? `${code}: ${description}` : code)
    this.name = 'GoogleTokenError'
    this.code = code
    this.invalidGrant = code === 'invalid_grant'
  }
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })

  let payload: TokenResponse
  try {
    payload = (await response.json()) as TokenResponse
  } catch {
    throw new GoogleTokenError('invalid_response', `Google returned ${response.status}`)
  }

  if (!response.ok || payload.error) {
    throw new GoogleTokenError(payload.error ?? `http_${response.status}`, payload.error_description)
  }

  if (!payload.access_token) {
    throw new GoogleTokenError('invalid_response', 'No access_token in the token response')
  }

  return payload
}

/**
 * Reads the email out of an id_token without verifying its signature.
 *
 * That is safe *here* and nowhere else: this JWT came back over TLS on a direct
 * server-to-server call to Google's token endpoint, which is exactly the case
 * Google's own documentation exempts from verification. The same shortcut on an
 * id_token arriving from a browser would be a straightforward auth bypass.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null

  const parts = idToken.split('.')
  if (parts.length !== 3) return null

  const decoded = fromBase64Url(parts[1])
  if (!decoded) return null

  try {
    const claims = JSON.parse(fromUtf8(decoded)) as { email?: unknown }
    return typeof claims.email === 'string' && claims.email ? claims.email : null
  } catch {
    return null
  }
}

function expiresAtFrom(expiresIn: number | undefined): string {
  // Google's access tokens are an hour; fall back to that rather than treating
  // a missing expires_in as "never expires", which would strand the connection
  // on a token that stopped working.
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export async function exchangeAuthorizationCode(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig()

  const payload = await postToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  )

  return {
    accessToken: payload.access_token!,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAtFrom(payload.expires_in),
    email: emailFromIdToken(payload.id_token),
    scope: payload.scope ?? null,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = googleOAuthConfig()

  const payload = await postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  )

  return {
    accessToken: payload.access_token!,
    // A refresh never returns a new refresh token; the caller keeps the one it
    // already has rather than overwriting it with null.
    refreshToken: payload.refresh_token ?? null,
    expiresAt: expiresAtFrom(payload.expires_in),
    email: emailFromIdToken(payload.id_token),
    scope: payload.scope ?? null,
  }
}

/**
 * Tells Google to drop the grant.
 *
 * Returns whether Google accepted it, but the caller marks the row revoked
 * either way: a token Google no longer recognises produces a 400 here, and
 * refusing to disconnect locally because the remote revoke "failed" would leave
 * an owner staring at a connection they cannot get rid of.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      cache: 'no-store',
    })

    return response.ok
  } catch {
    return false
  }
}
