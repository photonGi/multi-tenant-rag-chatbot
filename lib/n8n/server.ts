import { N8nClient } from './client'

/**
 * Server-only n8n client.
 *
 * The widget path never lets a browser talk to n8n. A visitor on a customer's
 * site holds a public key that authorises nothing by itself; the API route
 * checks it, then calls the workflow from here with the workspace key the
 * browser has never seen.
 *
 * `N8N_SHARED_SECRET` closes the last gap: the webhook URL is guessable and the
 * workflow is publicly reachable, so without a secret anyone who learns a
 * workspace key could call it directly. Add a matching header check to the
 * n8n workflow's first node — see N8N_INTEGRATION.md.
 */

let cached: N8nClient | null = null

export function serverN8nClient(): N8nClient {
  if (cached) return cached

  const baseUrl = process.env.N8N_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, '')
  const secret = process.env.N8N_SHARED_SECRET?.trim()

  const headers: Record<string, string> = {}
  if (secret) headers['X-Widget-Secret'] = secret

  // Falls back to the client's own default base URL, so the widget keeps
  // working on a deployment that has not set the variable yet.
  cached = baseUrl ? new N8nClient(baseUrl, headers) : new N8nClient(undefined, headers)
  return cached
}
