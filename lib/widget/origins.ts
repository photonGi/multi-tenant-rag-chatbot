/**
 * Origin normalisation and matching — the sole authority on whether a browser
 * is allowed to run a given widget.
 *
 * An `Origin` header is trivially forged with curl, so this is not a security
 * boundary on its own; the rate limiter in ./rate-limit.ts is what bounds abuse
 * from a non-browser client. What origin checking *does* buy is the thing that
 * actually matters here: a key lifted from one customer's page cannot be pasted
 * into an attacker's own site and used there, because a real browser always
 * sends its true origin and cannot be talked out of it.
 */

/** Cap on `pending_origins`, mirrored by the SQL function's default. */
export const ORIGIN_OBSERVATION_LIMIT = 10

/**
 * Canonical form: `scheme://host[:port]`, lowercase, no path, no trailing
 * slash, default ports dropped. Bare hostnames are assumed https, since that
 * is what a customer types when the dashboard asks for their domain.
 *
 * Returns null for anything unusable — a sandboxed iframe sends the literal
 * string "null", and file:// pages send nothing at all.
 */
export function normalizeOrigin(input: string | null | undefined): string | null {
  if (!input) return null

  const trimmed = input.trim().toLowerCase()
  if (!trimmed || trimmed === 'null') return null

  // A bare hostname is assumed https, because that is what a customer types
  // when the dashboard asks for their domain. But that assumption must not be
  // applied to a value that already declares a scheme: prefixing `file:///x`
  // would silently produce the origin `https://file`, which is nonsense that
  // then flows into an allowlist.
  const declaredScheme = /^[a-z][a-z0-9+.-]*:/.exec(trimmed)
  if (declaredScheme && !/^https?:\/\//.test(trimmed)) return null

  const withScheme = declaredScheme ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    // URL#origin already drops the default port and everything after the host.
    return url.origin
  } catch {
    return null
  }
}

/**
 * Same, but tolerant of a leading `*.` wildcard label so allowlists can be
 * stored in the one canonical shape as everything else.
 */
export function normalizeOriginPattern(input: string | null | undefined): string | null {
  if (!input) return null

  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  // Swap the star for a placeholder label before parsing. `*` is not a
  // forbidden host code point, so most parsers accept it — but relying on that
  // would make this depend on runtime quirks.
  const starred = /(^|\/\/)\*\./.test(trimmed)
  const parsed = normalizeOrigin(starred ? trimmed.replace('*.', 'wildcard-placeholder.') : trimmed)
  if (!parsed) return null

  return starred ? parsed.replace('wildcard-placeholder.', '*.') : parsed
}

/**
 * `https://*.acme.com` matches any subdomain of acme.com over https — including
 * nested ones like `https://a.b.acme.com`, which is what a customer means when
 * they ask for "all our subdomains".
 *
 * It deliberately does NOT match the apex `https://acme.com`, and the suffix
 * test always includes the leading dot, so `https://evil-acme.com` cannot slip
 * through on a bare string ending.
 */
function patternMatches(origin: string, pattern: string): boolean {
  if (pattern === origin) return true

  const marker = pattern.indexOf('://*.')
  if (marker === -1) return false

  const prefix = `${pattern.slice(0, marker)}://`
  if (!origin.startsWith(prefix)) return false

  // Keeps the dot: '.acme.com', never 'acme.com'.
  const suffix = pattern.slice(marker + 4)
  const host = origin.slice(prefix.length)
  if (!host.endsWith(suffix)) return false

  return host.length > suffix.length
}

export function originMatches(
  origin: string | null | undefined,
  allowed: readonly string[] | null | undefined,
): boolean {
  const candidate = normalizeOrigin(origin)
  if (!candidate || !allowed?.length) return false

  return allowed.some((pattern) => {
    const normalized = normalizeOriginPattern(pattern)
    return normalized ? patternMatches(candidate, normalized) : false
  })
}

/**
 * Turns what the customer typed into the allowlist they meant.
 *
 * Adding the www/apex counterpart is the whole point: `acme.com` and
 * `www.acme.com` are different origins to a browser but the same site to a
 * human, and getting a blank widget because you registered the wrong one is
 * the single most predictable way for this install to fail.
 */
export function deriveAllowedOrigins(input: string): string[] {
  const origin = normalizeOriginPattern(input)
  if (!origin) return []

  // Wildcards are taken literally — they already cover every subdomain, and a
  // www counterpart of a wildcard is meaningless.
  if (origin.includes('://*.')) return [origin]

  const url = new URL(origin)
  const origins = [origin]

  // An explicit port means a dev or self-hosted setup, where the www
  // counterpart is almost never a real second origin.
  if (url.port) return origins

  const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)
  const isSingleLabel = !url.hostname.includes('.')
  if (isIpLiteral || isSingleLabel) return origins

  const counterpart = url.hostname.startsWith('www.')
    ? url.hostname.slice(4)
    : `www.${url.hostname}`

  origins.push(`${url.protocol}//${counterpart}`)
  return origins
}

/** Localhost and private ranges — surfaced in the UI, never auto-allowed. */
export function isLocalOrigin(origin: string | null | undefined): boolean {
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false

  const { hostname } = new URL(normalized)
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}

/** Host without scheme or port, for compact display in the dashboard. */
export function displayHost(origin: string): string {
  const normalized = normalizeOrigin(origin) ?? normalizeOriginPattern(origin)
  if (!normalized) return origin
  return new URL(normalized).host
}
