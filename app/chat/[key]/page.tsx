import type { Metadata } from 'next'

import { ChatLinkUnavailable } from '@/components/chat/link-unavailable'
import { isWellFormedChatKey } from '@/lib/chat/link'

import { ChatModule } from './chat-module'

type PageProps = {
  params: Promise<{ key: string }>
  searchParams: Promise<{ n?: string | string[] }>
}

function displayName(value: string | string[] | undefined): string | null {
  const name = Array.isArray(value) ? value[0] : value
  const trimmed = name?.trim()
  return trimmed ? trimmed.slice(0, 60) : null
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { key } = await params
  const name = displayName((await searchParams).n)

  // A link that cannot resolve should not put a workspace name in the tab —
  // the `n` parameter is caller-supplied and authorises nothing.
  let title = 'Chat link unavailable'
  if (isWellFormedChatKey(key)) {
    title = name ? `${name} · Assistant` : 'Document Assistant'
  }

  return {
    title,
    // Share links are meant to be handed out directly, not crawled.
    robots: { index: false, follow: false },
  }
}

/**
 * Public chat route. Everything the module needs is in the URL, so this page
 * never reaches for a session — that is what lets the link be shared.
 */
export default async function PublicChatPage({ params, searchParams }: PageProps) {
  const { key } = await params
  const name = displayName((await searchParams).n)

  // A key of the wrong shape cannot match any workspace, so this is settled
  // here rather than in the client — a truncated link never ships the chat
  // bundle and never touches the network.
  if (!isWellFormedChatKey(key)) {
    return <ChatLinkUnavailable reason="malformed" />
  }

  return <ChatModule chatKey={key} workspaceName={name} />
}
