import { NextResponse, type NextRequest } from 'next/server'

import { describeError } from '@/lib/errors'

import { verifyFrameToken } from './session'

/**
 * Framing rules for /embed/[key].
 *
 * `frame-ancestors` is the strongest control in the whole widget design,
 * because it is the only one the *browser* enforces rather than us. An
 * attacker who scrapes a public key out of a customer's HTML and drops the
 * snippet on their own site gets a frame the browser refuses to render — no
 * request of ours has to recognise the abuse for it to fail.
 *
 * It cannot be set from the page itself (App Router pages do not emit response
 * headers), and it varies per tenant, so it belongs in the proxy layer. The
 * origin comes from a signed frame token minted by /api/widget/config, which
 * means no database lookup on the path a visitor waits for.
 */
export async function embedFrameResponse(request: NextRequest): Promise<NextResponse> {
  let origin: string | null = null

  try {
    origin = await verifyFrameToken(request.nextUrl.searchParams.get('fa'))
  } catch (error) {
    // Signing is unavailable — no secret configured, or a bad key. Throwing
    // here would 500 the page from middleware; refusing to be framed is both
    // the safe answer and the one that leaves the panel readable when opened
    // directly. The cause is logged because it is a deployment fault, not a
    // visitor's.
    console.error('[widget] frame token verification failed:', describeError(error))
  }

  const response = NextResponse.next()

  // No valid token means the page was opened directly, or framed by someone
  // who never went through config. Refusing to be framed is the safe answer
  // for both: a direct visit renders fine, since frame-ancestors only governs
  // embedding.
  response.headers.set(
    'Content-Security-Policy',
    `frame-ancestors ${origin ?? "'none'"}`,
  )

  // X-Frame-Options has no per-origin form, so it is deliberately NOT set
  // here. Sending DENY alongside a permissive frame-ancestors would break the
  // widget in browsers that honour the older header first. vercel.json exempts
  // this path from the site-wide DENY for the same reason.
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')

  return response
}
