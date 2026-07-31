import { NextResponse, type NextRequest } from 'next/server'

import { integrationsResultPath } from '@/lib/admin/routes'
import { requireOwnedCompany } from '@/lib/auth/company'
import { describeError } from '@/lib/errors'
import { saveConnection } from '@/lib/google/connection'
import { GoogleConfigError, exchangeAuthorizationCode } from '@/lib/google/oauth'
import { verifyOAuthState } from '@/lib/google/state'

/**
 * Step two: Google sends the owner back here with an authorization code.
 *
 * This route is a GET the *browser* performs, with everything in the query
 * string, so nothing in it is trusted until it has been checked:
 *
 *   1. `state` must carry our own signature (it names the workspace).
 *   2. The session finishing the flow must be the same user who started it,
 *      and must still own that workspace. Without this second check a signed
 *      state captured from one owner's flow could be replayed by another
 *      person's browser to attach their Google account to a workspace that is
 *      not theirs.
 *   3. Only then is the code exchanged and the result stored.
 *
 * It always ends on the integrations page with a flag, because the person on
 * the other end of this redirect is looking at a browser tab and needs to be
 * told what happened — not at a JSON body.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl

  const state = await verifyOAuthState(searchParams.get('state'))

  // No verified state means no trustworthy workspace to return to — every
  // console destination needs a company_id, and the one in the URL is exactly
  // the value that just failed its check. The generic auth error page is the
  // only honest place left.
  if (!state) {
    return NextResponse.redirect(`${origin}/auth/error?error=oauth_state_invalid`)
  }

  const ownership = await requireOwnedCompany(state.companyId)

  if (!ownership.ok) {
    if (ownership.status === 401) {
      return NextResponse.redirect(`${origin}/auth/login`)
    }
    return NextResponse.redirect(`${origin}/`)
  }

  // Signed by us, for this workspace — but for a different user. Whoever is
  // signed in now did not start this flow.
  if (ownership.userId !== state.userId) {
    console.error('[google] callback session does not match the session that started the flow')
    return NextResponse.redirect(
      `${origin}${integrationsResultPath(state.companyId, 'error', 'forbidden')}`,
    )
  }

  const done = (result: 'connected' | 'error', reason?: Parameters<typeof integrationsResultPath>[2]) =>
    NextResponse.redirect(`${origin}${integrationsResultPath(state.companyId, result, reason)}`)

  // The owner pressed Cancel, or Google refused the request outright.
  const denial = searchParams.get('error')
  if (denial) {
    return done('error', 'denied')
  }

  const code = searchParams.get('code')
  if (!code) return done('error', 'unknown')

  try {
    const tokens = await exchangeAuthorizationCode(code)
    const stored = await saveConnection(state.companyId, tokens)

    if (!stored.ok) {
      console.error('[google] connection not stored:', stored.message)
      return done('error', 'store')
    }

    return done('connected')
  } catch (error) {
    console.error('[google] authorization code exchange failed:', describeError(error))
    return done('error', error instanceof GoogleConfigError ? 'config' : 'exchange')
  }
}
