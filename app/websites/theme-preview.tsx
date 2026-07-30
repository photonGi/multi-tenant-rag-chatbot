'use client'

import { ArrowUp, Bot, SquarePen, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { derivePalette, type WidgetTheme } from '@/lib/widget/theme'

/**
 * Live preview of the widget panel, driven by the unsaved draft.
 *
 * A static mock rather than a real `/embed` iframe, deliberately: the real one
 * needs a signed session and an allowlisted origin, so it could not render
 * inside the dashboard at all — and even if it could, it would show the *saved*
 * theme, which is exactly the thing the owner is trying to see before saving.
 *
 * The colours are not approximated. It spreads the same `derivePalette` output
 * onto the same Tailwind tokens the panel uses, so what shows here is the
 * arithmetic the real widget will run.
 */
export function ThemePreview({
  theme,
  className,
}: Readonly<{ theme: WidgetTheme; className?: string }>) {
  return (
    <div
      className={cn(
        'flex h-[380px] w-full flex-col overflow-hidden rounded-xl border border-border shadow-elevated',
        className,
      )}
      style={
        {
          '--w-accent': theme.accent,
          '--w-accent-fg': theme.accentForeground,
          ...derivePalette(theme),
          background: 'var(--color-canvas)',
        } as React.CSSProperties
      }
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 items-center gap-2.5 px-3 py-2.5"
        style={{ background: 'var(--w-accent)', color: 'var(--w-accent-fg)' }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{
            background: 'color-mix(in srgb, var(--w-accent-fg) 18%, transparent)',
          }}
        >
          <Bot className="h-3.5 w-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold tracking-tight">
            {theme.title}
          </div>
          <div className="truncate text-[10px] opacity-70">{theme.subtitle}</div>
        </div>

        <SquarePen className="h-3.5 w-3.5 shrink-0 opacity-80" />
        <X className="h-4 w-4 shrink-0 opacity-80" />
      </div>

      {/* ── Transcript ───────────────────────────────────────────────────── */}
      <div className="flex-1 space-y-2.5 overflow-hidden px-3 py-3">
        <div className="rounded-xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed font-light text-ink-900 shadow-soft">
          {theme.greeting}
        </div>

        {theme.starters.slice(0, 2).map((starter) => (
          <div
            key={starter}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-light text-ink-700 shadow-soft"
          >
            {starter}
          </div>
        ))}

        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-xl rounded-tr-sm bg-ink-100 px-3 py-2 text-[11px] leading-relaxed font-light text-ink-900">
            What are your opening hours?
          </div>
        </div>

        <div className="flex items-start gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-brand">
            <Bot className="h-3 w-3" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-[11px] leading-relaxed font-light text-ink-900">
              We&apos;re open 9am–6pm on weekdays.
            </div>
            <div className="max-w-fit rounded-md border border-border bg-ink-50 px-2 py-1">
              <span className="text-[8px] font-bold tracking-wider text-ink-400 uppercase">
                Context Applied
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-border bg-surface px-2.5 pt-2.5 pb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-canvas px-2.5 text-[11px] leading-8 font-light text-ink-400">
            Ask a question…
          </div>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--w-accent)', color: 'var(--w-accent-fg)' }}
          >
            <ArrowUp className="h-4 w-4" />
          </div>
        </div>

        <div
          className={cn(
            'pt-1.5 text-center text-[8px] text-ink-400',
            !theme.showBranding && 'invisible',
          )}
        >
          Powered by Multi-Tenant Chatbot
        </div>
      </div>
    </div>
  )
}

/**
 * The launcher as it sits on the customer's page. Shown beside the panel so
 * the accent can be judged against both surfaces it appears on.
 */
export function LauncherPreview({ theme }: Readonly<{ theme: WidgetTheme }>) {
  return (
    <div className="flex items-center gap-2.5">
      {theme.launcherLabel ? (
        <span className="rounded-full bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-900 shadow-elevated">
          {theme.launcherLabel}
        </span>
      ) : null}
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full shadow-elevated"
        style={{ background: theme.accent, color: theme.accentForeground }}
      >
        <Bot className="h-5 w-5" />
      </div>
    </div>
  )
}
