import { NextResponse } from 'next/server'

import { normalizeOrigin } from './origins'

/**
 * Shared response shaping for the anonymous widget routes.
 *
 * The recurring mistake these helpers exist to prevent is a wildcard
 * `Access-Control-Allow-Origin`. These endpoints are per-tenant, so the header
 * must echo the one origin that was actually authorised — never `*`, and never
 * the request's origin without checking it first.
 */

export interface CorsOptions {
  /** The origin that passed the allowlist. Omit to send no CORS headers at all. */
  allowOrigin?: string | null
  /** Extra request headers the browser may send on the preflighted call. */
  allowHeaders?: string
  methods?: string
}

export function corsHeaders({
  allowOrigin,
  allowHeaders = 'content-type, authorization, x-widget-session',
  methods = 'GET, POST, OPTIONS',
}: CorsOptions): Record<string, string> {
  const headers: Record<string, string> = {
    // Responses differ per origin, so shared caches must key on it. Without
    // this, a CDN can serve one tenant's CORS header to another tenant's page.
    Vary: 'Origin',
  }

  const origin = normalizeOrigin(allowOrigin)
  if (!origin) return headers

  headers['Access-Control-Allow-Origin'] = origin
  headers['Access-Control-Allow-Methods'] = methods
  headers['Access-Control-Allow-Headers'] = allowHeaders
  headers['Access-Control-Max-Age'] = '86400'

  return headers
}

export function widgetJson(
  body: unknown,
  init: { status?: number; allowOrigin?: string | null; headers?: Record<string, string> } = {},
): NextResponse {
  return NextResponse.json(body as Record<string, unknown>, {
    status: init.status ?? 200,
    headers: {
      ...corsHeaders({ allowOrigin: init.allowOrigin }),
      // Per-visitor, per-origin, and carrying a signed token. Never cacheable.
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  })
}

/**
 * Error bodies stay generic on purpose.
 *
 * `code` distinguishes the cases the *loader* has to act on differently
 * (retry vs. give up quietly), but nothing here reveals whether a key exists or
 * which origins a site allows — otherwise the endpoint becomes an oracle for
 * enumerating tenants.
 */
export function widgetError(
  code: 'invalid_request' | 'not_available' | 'rate_limited' | 'upstream_error',
  message: string,
  init: { status: number; allowOrigin?: string | null; retryAfter?: number } = { status: 400 },
): NextResponse {
  const headers: Record<string, string> = {}
  if (init.retryAfter) headers['Retry-After'] = String(init.retryAfter)

  return widgetJson(
    { error: code, message },
    { status: init.status, allowOrigin: init.allowOrigin, headers },
  )
}

/** Preflight. Answered for any origin — the real check happens on the actual call. */
export function widgetPreflight(request: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders({ allowOrigin: request.headers.get('origin') }),
  })
}

/**
 * Public base URL of this deployment, used to build snippets and iframe URLs.
 *
 * Order matters: an explicit setting always wins, then Vercel's own project
 * URL, then localhost. `VERCEL_URL` is the per-deployment hostname, so it is
 * only a sane default for previews — production should set
 * NEXT_PUBLIC_APP_URL to the stable domain customers paste into their sites.
 */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
  if (explicit) return explicit

  const vercel =
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`

  return 'http://localhost:3000'
}
