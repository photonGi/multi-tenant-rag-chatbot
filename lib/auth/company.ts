import { createClient } from '@/lib/supabase/server'

/**
 * "Does the session behind this request own that workspace?"
 *
 * The lookup runs on the session-scoped client rather than the service-role
 * one, so `companies_select_own` answers the question for us — a workspace the
 * caller does not own simply does not exist from here. That means there is no
 * second copy of the ownership rule in application code to drift from the
 * policy, which is the failure mode this helper exists to avoid.
 */

export interface OwnedCompany {
  id: string
  name: string
}

export type OwnershipResult =
  | { ok: true; userId: string; company: OwnedCompany }
  /** No session at all — the caller should sign in. */
  | { ok: false; status: 401 }
  /** Signed in, but not for this workspace. Indistinguishable from "no such workspace". */
  | { ok: false; status: 403 }

export async function requireOwnedCompany(
  companyId: string | null | undefined,
): Promise<OwnershipResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { ok: false, status: 401 }
  if (!companyId) return { ok: false, status: 403 }

  const { data } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle<OwnedCompany>()

  if (!data) return { ok: false, status: 403 }

  return { ok: true, userId: user.id, company: data }
}
