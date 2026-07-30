/**
 * The `widget_sites` row as the dashboard sees it.
 *
 * Separate from the server-side shape in lib/widget/site.ts on purpose: this
 * one is read through RLS with the owner's session and carries no joined
 * company key, so there is no route by which the workspace credential could
 * end up in a client bundle.
 */
export interface WidgetSite {
  id: string
  company_id: string
  name: string
  public_key: string
  allowed_origins: string[]
  pending_origins: string[]
  theme: unknown
  status: 'pending' | 'active' | 'disabled'
  verified_at: string | null
  last_seen_at: string | null
  last_seen_origin: string | null
  load_count: number
  message_count: number
  created_at: string
  updated_at: string
}
