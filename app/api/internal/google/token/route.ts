import { NextResponse, type NextRequest } from 'next/server'

import { describeError } from '@/lib/errors'
import { ensureAccessToken } from '@/lib/google/connection'
import { verifyInternalSecret } from '@/lib/internal/auth'

/**
 * The booking workflow's one call into this app.
 *
 * n8n needs a Google access token for a workspace to create the calendar event
 * and send the confirmation mail. It cannot hold the refresh token itself —
 * that credential is encrypted with a key this app owns, and spreading it into
 * a workflow's credential store would put it somewhere with no revocation story
 * and no audit trail. So the workflow asks here, gets a token that is already
 * checked for freshness, and never sees anything longer-lived.
 *
 * Authentication is the shared secret in X-Internal-Secret and nothing else:
 * there is no session on a server-to-server call. That is why the response is
 * `no-store` and why the secret check fails closed when unconfigured.
 */

export const dynamic = 'force-dynamic'

/** Carries an access token. Never cached, by us or by anything in front of us. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const auth = verifyInternalSecret(request.headers)

  if (!auth.ok) {
    // One shape for both "no secret configured on the server" and "wrong secret
    // presented". A caller must not be able to discover that the endpoint is
    // sitting there unprotected-but-refusing.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const companyId = request.nextUrl.searchParams.get('company_id')?.trim()

  // Shape-checked before it reaches the database: a malformed id cannot match a
  // row, so this is a cheap rejection rather than a round trip.
  if (!companyId || !UUID_SHAPE.test(companyId)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: NO_STORE })
  }

  try {
    const result = await ensureAccessToken(companyId)

    if (!result.ok) {
      if (result.reason === 'not_connected') {
        // 404 with an explicit flag, so the workflow can branch on the body
        // without inspecting status codes: this workspace has not connected
        // Google, or the grant is gone. Either way there is nothing to retry.
        return NextResponse.json({ connected: false }, { status: 404, headers: NO_STORE })
      }

      // A connection exists but Google would not renew it right now. 502
      // rather than 404 — this one may well succeed on the next attempt, and
      // the workflow should treat it as an upstream failure, not as "no
      // integration".
      return NextResponse.json(
        { connected: false, error: 'refresh_failed', message: result.message },
        { status: 502, headers: NO_STORE },
      )
    }

    return NextResponse.json(
      {
        connected: true,
        access_token: result.accessToken,
        calendar_id: result.calendarId,
        connected_email: result.connectedEmail,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    // Logged in full, answered in general terms. A stack trace or a Supabase
    // error string in the body would leak schema detail to whoever holds the
    // secret next.
    console.error('[internal] google token lookup failed:', describeError(error))

    return NextResponse.json(
      { connected: false, error: 'internal_error' },
      { status: 500, headers: NO_STORE },
    )
  }
}
