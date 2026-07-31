/**
 * The shape of an `oauth_connections` row, split out from the code that reads
 * it so the console can import the type and the column list without pulling the
 * service-role client and the encryption key handling into the browser bundle.
 *
 * The two ciphertext columns are absent from `PublicConnection` deliberately —
 * that is the same boundary the column-level GRANT draws in
 * scripts/meetings-schema.sql, expressed in the type system so a client
 * component cannot even ask for them.
 */

export type ConnectionStatus = 'connected' | 'revoked' | 'error'

export interface PublicConnection {
  id: string
  company_id: string
  provider: string
  connected_email: string | null
  token_expiry: string | null
  calendar_id: string
  status: ConnectionStatus
  created_at: string
  updated_at: string
}

export interface OAuthConnectionRow extends PublicConnection {
  refresh_token_encrypted: string | null
  access_token_encrypted: string | null
}

/** Everything a browser session is granted on this table. Never the ciphertext. */
export const CONNECTION_PUBLIC_COLUMNS =
  'id, company_id, provider, connected_email, token_expiry, calendar_id, status, created_at, updated_at'
