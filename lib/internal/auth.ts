import { timingSafeEqual } from '@/lib/crypto/encoding'

/**
 * The gate on /api/internal/*.
 *
 * These routes exist for one caller: the n8n workflows, server to server. They
 * have no Supabase session to authenticate with and they take `company_id` as a
 * parameter, so without a shared secret in front of them anyone who could guess
 * a workspace id could pull that tenant's Google access token.
 *
 * Same idea as the `X-Widget-Secret` this backend sends to n8n (see
 * lib/n8n/server.ts), pointed the other way: that one proves a webhook call
 * came from here, this one proves a call came from the workflow.
 *
 * A shared secret is the whole of the security here, which is why the secret is
 * required rather than optional: an unset variable must fail closed, not
 * silently open the endpoint to the internet.
 */

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'rejected' }

export const INTERNAL_SECRET_HEADER = 'x-internal-secret'

export function verifyInternalSecret(headers: Headers): InternalAuthResult {
  const expected = process.env.INTERNAL_API_SECRET?.trim()

  if (!expected) {
    console.error(
      '[internal] INTERNAL_API_SECRET is not set — refusing every request to /api/internal/*.',
    )
    return { ok: false, reason: 'not_configured' }
  }

  const presented = headers.get(INTERNAL_SECRET_HEADER)?.trim()
  if (!presented) return { ok: false, reason: 'rejected' }

  // Constant time: a plain === returns early on the first wrong character, and
  // the timing difference is enough to recover the secret one character at a
  // time given enough attempts.
  return timingSafeEqual(presented, expected) ? { ok: true } : { ok: false, reason: 'rejected' }
}
