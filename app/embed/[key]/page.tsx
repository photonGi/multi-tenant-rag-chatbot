import type { Metadata } from 'next'

import { isWellFormedPublicKey } from '@/lib/widget/keys'

import { WidgetPanel } from './widget-panel'

type PageProps = {
  params: Promise<{ key: string }>
}

export const metadata: Metadata = {
  title: 'Assistant',
  // This page only ever exists inside someone else's site.
  robots: { index: false, follow: false },
}

/**
 * The panel that lives inside the widget's iframe.
 *
 * It does no server-side lookup at all, which is deliberate: the loader has
 * already called /api/widget/config and holds the theme and a signed session,
 * so re-resolving the key here would be a second database round trip for
 * information that is about to arrive over postMessage anyway. The key in the
 * URL is therefore only a cache-buster and a debugging aid — nothing is
 * authorised by it.
 *
 * Framing is restricted per-site by the `frame-ancestors` header set in
 * proxy.ts, so this page cannot be embedded on a site the tenant has not
 * allowed even though it is otherwise public.
 */
export default async function EmbedPage({ params }: PageProps) {
  const { key } = await params

  return <WidgetPanel publicKey={isWellFormedPublicKey(key) ? key : null} />
}
