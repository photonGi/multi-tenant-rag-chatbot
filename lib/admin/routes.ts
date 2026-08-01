/**
 * Admin section paths.
 *
 * Admin is one rail destination with four pages behind it, and three of those
 * are reached from a server redirect after an OAuth round trip. Building the
 * URLs here keeps the API routes and the tab strip agreeing on where a page
 * lives — a mismatch would only show up as a redirect into a blank page.
 *
 * Every admin page is workspace-scoped, so company_id rides in the query string
 * exactly as it does on Documents and Websites.
 */

export type AdminSection =
  | 'overview'
  | 'integrations'
  | 'availability'
  | 'templates'
  | 'meetings'

const SECTION_PATHS: Record<AdminSection, string> = {
  overview: '/admin',
  integrations: '/admin/integrations',
  availability: '/admin/availability',
  templates: '/admin/templates',
  meetings: '/admin/meetings',
}

export function adminPath(section: AdminSection, companyId: string): string {
  return `${SECTION_PATHS[section]}?company_id=${encodeURIComponent(companyId)}`
}

/**
 * How the OAuth round trip reports back to the console.
 *
 * `reason` is a stable code, not a message: the text a person reads is written
 * in the page (app/admin/integrations/page.tsx), so a redirect URL never
 * carries prose that could be swapped for something misleading.
 */
export type IntegrationResultReason =
  | 'denied'
  | 'config'
  | 'exchange'
  | 'store'
  | 'forbidden'
  | 'unknown'

export function integrationsResultPath(
  companyId: string,
  result: 'connected' | 'disconnected' | 'error',
  reason?: IntegrationResultReason,
): string {
  const path = `${adminPath('integrations', companyId)}&google=${result}`
  return reason ? `${path}&reason=${reason}` : path
}
