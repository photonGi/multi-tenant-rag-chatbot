import { describeError } from '@/lib/errors'
import { createAdminClient } from '@/lib/supabase/admin'

import type { ConnectionStatus, OAuthConnectionRow } from './connection-shape'
import {
  GoogleTokenError,
  refreshAccessToken,
  revokeGoogleToken,
  type GoogleTokens,
} from './oauth'
import { decryptToken, encryptToken } from './tokens'

/**
 * The stored Google connection: reading it, writing it, and keeping its access
 * token fresh.
 *
 * Everything here goes through the service-role client. Not for convenience —
 * the encrypted columns are deliberately outside `authenticated`'s grant (see
 * scripts/meetings-schema.sql), and the one caller that matters most, the
 * internal token endpoint, is invoked by n8n with no Supabase session at all.
 */

const PROVIDER = 'google'

/**
 * Refresh this far ahead of the stated expiry.
 *
 * A token that is technically still valid for ten seconds is not valid enough:
 * the workflow that receives it still has to create a calendar event and send a
 * mail, and a 401 halfway through that is a half-booked meeting.
 */
const REFRESH_SKEW_SECONDS = 120

export async function loadConnection(companyId: string): Promise<OAuthConnectionRow | null> {
  const { data, error } = await createAdminClient()
    .from('oauth_connections')
    .select('*')
    .eq('company_id', companyId)
    .eq('provider', PROVIDER)
    .maybeSingle<OAuthConnectionRow>()

  if (error) {
    console.error('[google] connection lookup failed:', describeError(error))
    return null
  }

  return data
}

/**
 * Writes the result of a consent flow.
 *
 * Upsert on (company_id, provider) so reconnecting replaces the grant instead
 * of stacking rows — but two fields are carried forward from the existing row
 * rather than overwritten:
 *
 *   refresh_token — Google returns one only when it feels like it. Writing
 *                   null on a re-consent that omitted it would throw away the
 *                   only durable credential we have.
 *   calendar_id   — a tenant who pointed bookings at a shared calendar should
 *                   not silently be moved back to 'primary' by a reconnect.
 */
export async function saveConnection(
  companyId: string,
  tokens: GoogleTokens,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const existing = await loadConnection(companyId)

  const refreshToken = tokens.refreshToken
  if (!refreshToken && !existing?.refresh_token_encrypted) {
    // Nothing durable to store. Better to fail the connect loudly than to
    // record a connection that stops working in an hour.
    return {
      ok: false,
      message:
        'Google did not return a refresh token. Remove this app from the account’s third-party access and connect again.',
    }
  }

  try {
    const refresh_token_encrypted = refreshToken
      ? await encryptToken(refreshToken)
      : existing!.refresh_token_encrypted

    const { error } = await createAdminClient().from('oauth_connections').upsert(
      {
        company_id: companyId,
        provider: PROVIDER,
        connected_email: tokens.email ?? existing?.connected_email ?? null,
        refresh_token_encrypted,
        access_token_encrypted: await encryptToken(tokens.accessToken),
        token_expiry: tokens.expiresAt,
        calendar_id: existing?.calendar_id ?? 'primary',
        status: 'connected',
      },
      { onConflict: 'company_id,provider' },
    )

    if (error) throw error

    return { ok: true }
  } catch (error) {
    console.error('[google] connection write failed:', describeError(error))
    return { ok: false, message: 'The connection could not be stored.' }
  }
}

export async function markConnectionStatus(
  companyId: string,
  status: ConnectionStatus,
  options: { clearTokens?: boolean } = {},
): Promise<void> {
  const patch: Record<string, unknown> = { status }

  // On disconnect the ciphertext is dropped rather than kept beside a 'revoked'
  // flag. A revoked row that still holds a credential is a credential nobody is
  // watching any more.
  if (options.clearTokens) {
    patch.refresh_token_encrypted = null
    patch.access_token_encrypted = null
    patch.token_expiry = null
  }

  const { error } = await createAdminClient()
    .from('oauth_connections')
    .update(patch)
    .eq('company_id', companyId)
    .eq('provider', PROVIDER)

  if (error) {
    console.error('[google] connection status write failed:', describeError(error))
  }
}

export type AccessTokenResult =
  | {
      ok: true
      accessToken: string
      calendarId: string
      connectedEmail: string | null
    }
  /** No usable connection. The caller answers 404 { connected: false }. */
  | { ok: false; reason: 'not_connected' }
  /** A connection exists but Google refused; already marked in the database. */
  | { ok: false; reason: 'refresh_failed'; message: string }

function expired(tokenExpiry: string | null): boolean {
  if (!tokenExpiry) return true

  const expiresAt = Date.parse(tokenExpiry)
  if (Number.isNaN(expiresAt)) return true

  return expiresAt - REFRESH_SKEW_SECONDS * 1000 <= Date.now()
}

/**
 * Hands back an access token that will still be valid when the caller uses it,
 * refreshing and persisting first if it will not.
 *
 * Persisting the refreshed token matters more than it looks: without it every
 * booking would burn a refresh call, and Google rate-limits those per account.
 */
export async function ensureAccessToken(companyId: string): Promise<AccessTokenResult> {
  const connection = await loadConnection(companyId)

  if (connection?.status !== 'connected') {
    return { ok: false, reason: 'not_connected' }
  }

  if (!expired(connection.token_expiry)) {
    const accessToken = await decryptToken(connection.access_token_encrypted)
    if (accessToken) {
      return {
        ok: true,
        accessToken,
        calendarId: connection.calendar_id,
        connectedEmail: connection.connected_email,
      }
    }
    // Undecryptable — the key rotated, or the row was tampered with. Fall
    // through and mint a new one from the refresh token rather than failing.
  }

  const refreshToken = await decryptToken(connection.refresh_token_encrypted)
  if (!refreshToken) {
    // The stored grant cannot be read at all. Nothing here is recoverable
    // without the owner reconnecting, so say so instead of retrying forever.
    await markConnectionStatus(companyId, 'error')
    return {
      ok: false,
      reason: 'refresh_failed',
      message: 'The stored Google credentials could not be read. Reconnect the account.',
    }
  }

  let refreshed: GoogleTokens
  try {
    refreshed = await refreshAccessToken(refreshToken)
  } catch (error) {
    const invalidGrant = error instanceof GoogleTokenError && error.invalidGrant

    // invalid_grant is the account itself saying no — revoked from Google's
    // security page, password changed, or six months idle. That is a permanent
    // state and is recorded as one; anything else might be transient, so it is
    // flagged for attention without claiming the grant is gone.
    await markConnectionStatus(companyId, invalidGrant ? 'revoked' : 'error', {
      clearTokens: invalidGrant,
    })

    console.error('[google] token refresh failed:', describeError(error))

    return invalidGrant
      ? { ok: false, reason: 'not_connected' }
      : {
          ok: false,
          reason: 'refresh_failed',
          message: 'Google refused to refresh the access token.',
        }
  }

  const { error: writeError } = await createAdminClient()
    .from('oauth_connections')
    .update({
      access_token_encrypted: await encryptToken(refreshed.accessToken),
      token_expiry: refreshed.expiresAt,
      // A refresh that succeeds is also proof the connection is healthy again.
      status: 'connected',
    })
    .eq('id', connection.id)

  if (writeError) {
    // The token in hand is still good, so the caller is served — but the next
    // call will refresh again, which is worth knowing about.
    console.error('[google] refreshed token not persisted:', describeError(writeError))
  }

  return {
    ok: true,
    accessToken: refreshed.accessToken,
    calendarId: connection.calendar_id,
    connectedEmail: refreshed.email ?? connection.connected_email,
  }
}

/**
 * Disconnects: tells Google to drop the grant, then clears the row.
 *
 * The refresh token is revoked rather than the access token — revoking a
 * refresh token invalidates every access token derived from it, while doing it
 * the other way round leaves the standing grant intact.
 */
export async function disconnectConnection(
  companyId: string,
): Promise<{ revokedRemotely: boolean }> {
  const connection = await loadConnection(companyId)
  if (!connection) return { revokedRemotely: false }

  const refreshToken = await decryptToken(connection.refresh_token_encrypted)
  const revokedRemotely = refreshToken ? await revokeGoogleToken(refreshToken) : false

  await markConnectionStatus(companyId, 'revoked', { clearTokens: true })

  return { revokedRemotely }
}
