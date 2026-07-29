/**
 * Public chat links.
 *
 * The link carries the workspace key directly, so it needs no session to
 * resolve — that is what makes the chat module shareable. The optional `n`
 * parameter only supplies a display name for the header; nothing is
 * authorised by it.
 *
 * NOTE: the key in this URL is the same credential the n8n /ingest webhook
 * accepts. Anyone holding a share link can therefore also push documents into
 * that workspace. Rotate the key from Admin to revoke a link.
 */
export function publicChatPath(apiKey: string, workspaceName?: string | null): string {
  const path = `/chat/${encodeURIComponent(apiKey)}`
  const name = workspaceName?.trim()
  return name ? `${path}?n=${encodeURIComponent(name)}` : path
}

export function publicChatUrl(apiKey: string, workspaceName?: string | null): string {
  const path = publicChatPath(apiKey, workspaceName)
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}
