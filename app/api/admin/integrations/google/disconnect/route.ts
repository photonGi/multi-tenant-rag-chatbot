import { NextResponse, type NextRequest } from 'next/server'

import { requireOwnedCompany } from '@/lib/auth/company'
import { describeError } from '@/lib/errors'
import { disconnectConnection } from '@/lib/google/connection'

/**
 * Disconnects a workspace's Google account.
 *
 * POST rather than GET, and not a direct Supabase call from the console,
 * because both halves of "disconnect" need the server: revoking the grant with
 * Google needs the refresh token, and reading the refresh token needs the
 * encryption key. A client-side status update would leave a live grant on the
 * owner's Google account with only this app's UI claiming otherwise.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let body: { company_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const companyId = typeof body.company_id === 'string' ? body.company_id : null

  const ownership = await requireOwnedCompany(companyId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.status === 401 ? 'unauthenticated' : 'forbidden' },
      { status: ownership.status },
    )
  }

  try {
    const { revokedRemotely } = await disconnectConnection(ownership.company.id)

    // `revoked_remotely: false` is reported rather than treated as a failure.
    // Google returns 400 for a token it has already forgotten, and the local
    // row is cleared either way — the owner is disconnected, and the honest
    // thing is to say whether Google confirmed it.
    return NextResponse.json({ disconnected: true, revoked_remotely: revokedRemotely })
  } catch (error) {
    console.error('[google] disconnect failed:', describeError(error))
    return NextResponse.json({ error: 'disconnect_failed' }, { status: 500 })
  }
}
