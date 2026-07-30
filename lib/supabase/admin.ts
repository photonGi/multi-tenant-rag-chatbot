import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS entirely — never import this from a file
 * that ships to the browser.
 *
 * The widget routes need it because they are genuinely anonymous: a visitor on
 * a customer's website has no Supabase session, so there is no `auth.uid()` for
 * a policy to key on. Rather than opening a `widget_sites` SELECT policy to
 * `anon` — which would let anyone enumerate every tenant's public keys — those
 * routes read the table as service_role and do the authorisation themselves in
 * lib/widget/site.ts.
 */

let cached: SupabaseClient | null = null

export function createAdminClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      'createAdminClient() was called in the browser. The service-role key must never reach the client.',
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — the widget API cannot resolve sites without them.',
    )
  }

  // Reused across invocations on a warm instance. Safe here in a way it is not
  // for the SSR client: this one carries no per-request cookie state, so there
  // is nothing to leak between requests.
  if (cached) return cached

  cached = createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return cached
}
