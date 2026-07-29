import type { Metadata } from 'next'

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
  searchParams,
}: PageProps): Promise<Metadata> {
  const name = displayName((await searchParams).n)

  return {
    title: name ? `${name} · Assistant` : 'Document Assistant',
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

  return <ChatModule chatKey={key} workspaceName={name} />
}
