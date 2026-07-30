import { createAdminClient } from '@/lib/supabase/admin'
import { describeError } from '@/lib/errors'

import { isWellFormedPublicKey } from './keys'
import { ORIGIN_OBSERVATION_LIMIT, normalizeOrigin, originMatches } from './origins'
import { resolveTheme, type WidgetTheme } from './theme'

/**
 * Server-side resolution of a public key into the site it names, plus the
 * decision about whether the calling page is allowed to use it.
 *
 * Every anonymous widget route funnels through `authorizeSite` so the rules
 * live in exactly one place — there is no second implementation to drift.
 */

export type SiteStatus = 'pending' | 'active' | 'disabled'

export interface WidgetSiteRow {
  id: string
  company_id: string
  name: string
  public_key: string
  allowed_origins: string[]
  pending_origins: string[]
  theme: unknown
  status: SiteStatus
  verified_at: string | null
  last_seen_at: string | null
  last_seen_origin: string | null
  load_count: number
  message_count: number
  created_at: string
  updated_at: string
}

interface SiteWithCompany extends WidgetSiteRow {
  /** Joined so the chat route can swap the public key for the internal one. */
  companies: { api_key: string; name: string } | null
}

/**
 * Why a request was turned away. These are for logging and for the dashboard —
 * the responses themselves stay deliberately vague, so probing a key with a
 * guessed origin cannot be used to discover which origins are allowed.
 */
export type DenialReason = 'malformed' | 'unknown' | 'disabled' | 'origin'

export type SiteAuthorization =
  | {
      ok: true
      site: SiteWithCompany
      theme: WidgetTheme
      /** Normalised host-page origin. Verified against the allowlist. */
      origin: string
      companyApiKey: string
    }
  | { ok: false; reason: DenialReason; status: number; origin: string | null }

const SITE_COLUMNS = `
  id, company_id, name, public_key, allowed_origins, pending_origins, theme, status,
  verified_at, last_seen_at, last_seen_origin, load_count, message_count,
  created_at, updated_at,
  companies!inner ( api_key, name )
`

export async function loadSiteByPublicKey(
  publicKey: string,
): Promise<SiteWithCompany | null> {
  if (!isWellFormedPublicKey(publicKey)) return null

  const { data, error } = await createAdminClient()
    .from('widget_sites')
    .select(SITE_COLUMNS)
    .eq('public_key', publicKey)
    .maybeSingle<SiteWithCompany>()

  if (error) {
    console.error('[widget] site lookup failed:', describeError(error))
    return null
  }

  return data
}

async function loadSiteById(siteId: string): Promise<SiteWithCompany | null> {
  const { data, error } = await createAdminClient()
    .from('widget_sites')
    .select(SITE_COLUMNS)
    .eq('id', siteId)
    .maybeSingle<SiteWithCompany>()

  if (error) {
    console.error('[widget] site lookup by id failed:', describeError(error))
    return null
  }

  return data
}

/**
 * The full gate: key shape, existence, status, and origin.
 *
 * `origin` is the browser-reported host page. For the loader's own calls that
 * is genuine and unforgeable-by-a-browser; for anything reaching this from a
 * non-browser client it is only as good as the caller, which is why the chat
 * route additionally requires a signed session (see ./session.ts).
 */
export async function authorizeSite(
  publicKey: string | null | undefined,
  rawOrigin: string | null | undefined,
): Promise<SiteAuthorization> {
  const origin = normalizeOrigin(rawOrigin)

  if (!publicKey || !isWellFormedPublicKey(publicKey)) {
    return { ok: false, reason: 'malformed', status: 400, origin }
  }

  const site = await loadSiteByPublicKey(publicKey)
  // 404 for both "no such key" and "no company behind it" — an orphaned site is
  // not a state a caller should be able to distinguish.
  if (!site?.companies?.api_key) {
    return { ok: false, reason: 'unknown', status: 404, origin }
  }

  return gateSite(site, origin)
}

/**
 * Authorises a chat request from an already-established session.
 *
 * The site and origin come from the signed token rather than the request, but
 * they are re-checked against the live row on every call — otherwise disabling
 * a site or removing an origin would not take effect until every outstanding
 * token expired, which is not what "revoke" means to the person clicking it.
 */
export async function authorizeSession(
  session: { siteId: string; origin: string } | null,
): Promise<SiteAuthorization> {
  if (!session) return { ok: false, reason: 'malformed', status: 401, origin: null }

  const site = await loadSiteById(session.siteId)
  if (!site?.companies?.api_key) {
    return { ok: false, reason: 'unknown', status: 404, origin: session.origin }
  }

  return gateSite(site, session.origin)
}

/** Status and origin rules, shared by both entry points. */
function gateSite(site: SiteWithCompany, origin: string | null): SiteAuthorization {
  if (site.status === 'disabled') {
    return { ok: false, reason: 'disabled', status: 403, origin }
  }

  if (!origin || !originMatches(origin, site.allowed_origins)) {
    // Recorded, not just refused. A blocked staging deploy becomes a one-click
    // approve in the dashboard instead of a support conversation.
    if (origin) void noteUnlistedOrigin(site.id, origin)
    return { ok: false, reason: 'origin', status: 403, origin }
  }

  return {
    ok: true,
    site,
    theme: resolveTheme(site.theme),
    origin,
    companyApiKey: site.companies!.api_key,
  }
}

/**
 * Install telemetry. Deliberately not awaited by callers on the hot path — a
 * counter that fails must never turn a working answer into an error, and the
 * RPC is atomic so nothing is lost by letting it land late.
 */
export async function recordSiteSeen(
  siteId: string,
  origin: string | null,
  isMessage = false,
): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('widget_site_seen', {
      site_id: siteId,
      seen_origin: origin,
      is_message: isMessage,
    })
    if (error) throw error
  } catch (error) {
    console.error('[widget] telemetry write failed:', describeError(error))
  }
}

export async function noteUnlistedOrigin(siteId: string, origin: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('widget_site_note_origin', {
      site_id: siteId,
      candidate: origin,
      max_pending: ORIGIN_OBSERVATION_LIMIT,
    })
    if (error) throw error
  } catch (error) {
    console.error('[widget] pending-origin write failed:', describeError(error))
  }
}
