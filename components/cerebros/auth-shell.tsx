import * as React from 'react'

import { Panel } from '@/components/cerebros/ui'

/**
 * Centred auth surface. Same three-layer depth as the console — canvas behind,
 * a single surface card in front — so signing in does not feel like a different
 * product from the thing it unlocks.
 */
export function AuthShell({
  title,
  subtitle,
  badge = 'ACCESS',
  children,
  footer,
}: {
  title: string
  subtitle?: string
  badge?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-canvas p-6 md:p-10">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-900 text-white shadow-soft">
            <span className="text-lg font-bold tracking-tighter">C</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-ink-900 uppercase">
              
            </span>
            <span className="rounded border border-ink-200 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
              {badge}
            </span>
          </div>
        </div>

        <Panel className="p-5 shadow-elevated sm:p-6">
          <div className="mb-6">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-500">{subtitle}</p>
            ) : null}
          </div>

          {children}
        </Panel>

        {footer ? (
          <div className="mt-6 text-center text-xs text-ink-500">{footer}</div>
        ) : null}
      </div>
    </div>
  )
}
