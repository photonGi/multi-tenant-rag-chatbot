/**
 * Public embed keys.
 *
 * Deliberately a different credential from `companies.api_key`. The workspace
 * key authorises ingest as well as chat, so it can never appear in a public
 * website's HTML — see scripts/widget-schema.sql for the full reasoning. A
 * public key only ever names a `widget_sites` row; what it is allowed to do is
 * decided server-side, by origin and status, not by the key itself.
 *
 * The `pk_live_` prefix is not decoration: it makes the value recognisable on
 * sight in a customer's source and greppable by secret scanners, so nobody
 * mistakes it for the credential that does need hiding.
 */

const PUBLIC_KEY_PREFIX = 'pk_live_'
const PUBLIC_KEY_BYTES = 24

/**
 * Same shape rule as the workspace key: hex only, fixed length. Anything else
 * cannot match a row, so a truncated snippet is rejected before it costs a
 * database round trip.
 */
const PUBLIC_KEY_SHAPE = new RegExp(`^${PUBLIC_KEY_PREFIX}[0-9a-f]{${PUBLIC_KEY_BYTES * 2}}$`)

export function generatePublicKey(): string {
  const bytes = new Uint8Array(PUBLIC_KEY_BYTES)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${PUBLIC_KEY_PREFIX}${hex}`
}

export function isWellFormedPublicKey(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_KEY_SHAPE.test(value)
}

/** Dashboard display — enough to tell two keys apart, not enough to use. */
export function maskPublicKey(key: string): string {
  if (!isWellFormedPublicKey(key)) return key
  return `${key.slice(0, PUBLIC_KEY_PREFIX.length + 6)}…${key.slice(-4)}`
}
