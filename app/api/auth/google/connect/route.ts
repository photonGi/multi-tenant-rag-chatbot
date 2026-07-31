import { NextResponse, type NextRequest } from 'next/server'

import { requireOwnedCompany } from '@/lib/auth/company'
import { describeError } from '@/lib/errors'
import { integrationsResultPath } from '@/lib/admin/routes'
import { GoogleConfigError, buildConsentUrl, googleOAuthConfig } from '@/lib/google/oauth'
import { signOAuthState } from '@/lib/google/state'
import { tokenEncryptionProblem } from '@/lib/google/tokens'

/**
 * Step one of connecting a workspace's Google account: send the owner to
 * Google's consent screen.
 *
 * The only interesting work here is establishing *which* workspace the consent
 * is for, and doing it in a way the callback can still trust after a round trip
 * through a third party. company_id arrives as a query parameter, is checked
 * against the session's ownership, and then travels on inside a signed state
 * parameter — never as a bare id the callback would have to take at face value
 * (see lib/google/state.ts for what that would cost).
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl
  const companyId = request.nextUrl.searchParams.get('company_id')

  const ownership = await requireOwnedCompany(companyId)

  if (!ownership.ok) {
    // Same split the proxy makes: no session is a sign-in problem, a session
    // without this workspace is a wrong-workspace problem.
    if (ownership.status === 401) {
      return NextResponse.redirect(`${origin}/auth/login`)
    }
    return NextResponse.redirect(`${origin}/`)
  }

  const workspaceId = ownership.company.id

  // Checked before the redirect rather than in the callback. Sending someone
  // through a Google consent screen and only then discovering we cannot store
  // what they granted is a worse experience than saying so up front — and it
  // would leave a live grant on their account that nothing here can use.
  const encryptionProblem = tokenEncryptionProblem()
  if (encryptionProblem) {
    console.error(
      `[google] refusing to start a consent flow that could not be stored: ${encryptionProblem}`,
    )
    return NextResponse.redirect(
      `${origin}${integrationsResultPath(workspaceId, 'error', 'config')}`,
    )
  }

  try {
    // Resolves the client id and redirect URI, and throws if either is missing.
    googleOAuthConfig()

    const state = await signOAuthState(workspaceId, ownership.userId)

    return NextResponse.redirect(buildConsentUrl(state))
  } catch (error) {
    console.error('[google] could not start the consent flow:', describeError(error))

    return NextResponse.redirect(
      `${origin}${integrationsResultPath(
        workspaceId,
        'error',
        error instanceof GoogleConfigError ? 'config' : 'unknown',
      )}`,
    )
  }
}
