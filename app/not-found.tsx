import Link from 'next/link'
import { Compass } from 'lucide-react'

import { btnClass } from '@/components/console/ui'

/**
 * Catch-all 404. Covers a bare /chat with no key, a mistyped console route, and
 * anything else that never resolved — the default Next page would drop straight
 * out of the design system.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md animate-slide-up">
        <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-elevated sm:p-8">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-ink-50 text-ink-400">
            <Compass className="h-6 w-6" />
          </div>

          <span className="font-mono text-[10px] tracking-wider text-ink-400">404</span>

          <h1 className="mt-2 text-lg font-semibold tracking-tight text-balance text-ink-900">
            There is nothing at this address
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-pretty text-ink-500">
            The page may have moved, or the link may have been copied
            incompletely.
          </p>

          <div className="mt-6 border-t border-border/60 pt-6">
            <Link href="/" className={btnClass('primary', 'lg', 'w-full')}>
              Go to the console
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
