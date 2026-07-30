import type { NextRequest } from 'next/server'

import {
  appBaseUrl,
  widgetError,
  widgetJson,
  widgetPreflight,
} from '@/lib/widget/http'
import { clientIp, consume } from '@/lib/widget/rate-limit'
import {
  SESSION_TTL_SECONDS,
  mintFrameToken,
  mintWidgetSession,
} from '@/lib/widget/session'
import { authorizeSite, recordSiteSeen } from '@/lib/widget/site'

/**
 * The loader's first and only cross-origin call.
 *
 * It does three jobs at once, and that overlap is the point:
 *
 *  1. Hands back the theme, so the launcher can paint in the tenant's colours
 *     before any iframe exists.
 *  2. Mints the session token that authenticates every later chat message —
 *     this is the one request where the browser attaches the host page's real
 *     `Origin`, so it is the only place the parent site can be established
 *     (see lib/widget/session.ts).
 *  3. Doubles as the install beacon. Because it runs on every page load, the
 *     dashboard flips a site from "pending" to "connected" on its own, with no
 *     DNS record to add and no verify button to click.
 */

export const dynamic = 'force-dynamic'

/** Generous — a busy page reloads often, and this call is cheap. */
const LIMIT_PER_MINUTE = 60

export function OPTIONS(request: NextRequest) {
  return widgetPreflight(request)
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin')
  const publicKey = request.nextUrl.searchParams.get('key')

  const throttle = consume(`config:${publicKey ?? 'none'}:${clientIp(request.headers)}`, LIMIT_PER_MINUTE, 60)
  if (!throttle.ok) {
    return widgetError('rate_limited', 'Too many requests.', {
      status: 429,
      allowOrigin: origin,
      retryAfter: throttle.retryAfter,
    })
  }

  const auth = await authorizeSite(publicKey, origin)

  if (!auth.ok) {
    // One shape for every denial. A caller must not be able to tell "no such
    // key" from "wrong origin" — that difference is exactly what an enumeration
    // script needs. The loader only needs to know it should stay hidden.
    return widgetError('not_available', 'This widget is not available on this site.', {
      status: auth.status,
      allowOrigin: origin,
    })
  }

  const [session, frameToken] = await Promise.all([
    mintWidgetSession(auth.site.id, auth.origin),
    mintFrameToken(auth.origin),
  ])

  // Not awaited: a telemetry failure must never cost the visitor their widget.
  recordSiteSeen(auth.site.id, auth.origin, false).catch(() => {})

  // The frame token rides in the URL so proxy.ts can build a per-site
  // `frame-ancestors` header without a second database lookup. It authorises
  // nothing on its own — see lib/widget/session.ts.
  const embedUrl = new URL(`${appBaseUrl()}/embed/${auth.site.public_key}`)
  embedUrl.searchParams.set('fa', frameToken)

  return widgetJson(
    {
      siteId: auth.site.id,
      name: auth.site.name,
      theme: auth.theme,
      session,
      expiresIn: SESSION_TTL_SECONDS,
      // Absolute, because the page consuming it is on another domain entirely.
      embedUrl: embedUrl.toString(),
    },
    { allowOrigin: auth.origin },
  )
}
