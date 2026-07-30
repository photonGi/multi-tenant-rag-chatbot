import * as React from 'react'

import { cn } from '@/lib/utils'

/* =============================================================================
   Console primitives.

   These exist so pages can be written at the density the spec calls for without
   repeating the same twenty-class strings. Anything visual that appears more
   than twice across the console lives here.
   ============================================================================= */

/** Middle depth layer: a surface card floating on the canvas. */
export function Panel({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface shadow-soft',
        className,
      )}
      {...props}
    />
  )
}

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas'

const buttonVariants = {
  /** Primary call to action. Ink, never brand — brand is reserved for AI states. */
  primary: 'bg-ink-900 text-white shadow-sm hover:bg-ink-800',
  outline:
    'border border-border bg-surface text-ink-600 shadow-soft hover:border-ink-300 hover:text-ink-900 hover:shadow-elevated',
  ghost: 'text-ink-500 hover:bg-ink-100 hover:text-ink-900',
  danger:
    'border border-alert/30 bg-alert/5 text-alert hover:bg-alert/10 hover:border-alert/50',
} as const

// Heights stay at or above 36px so every control is comfortable to tap.
const buttonSizes = {
  sm: 'h-9 px-3 sm:h-7 sm:px-2.5',
  md: 'h-9 px-3.5',
  lg: 'h-11 px-4 text-sm sm:h-10',
} as const

export function Btn({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: React.ComponentProps<'button'> & {
  variant?: keyof typeof buttonVariants
  size?: keyof typeof buttonSizes
}) {
  return (
    <button
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)}
      {...props}
    />
  )
}

/** Same surface as Btn, for anchors and Links. */
export function btnClass(
  variant: keyof typeof buttonVariants = 'primary',
  size: keyof typeof buttonSizes = 'md',
  className?: string,
) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)
}

/** Mono status tag — 10px, 4px rounding, per the spec. */
export function Pill({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'span'> & {
  tone?: 'neutral' | 'brand' | 'success' | 'alert'
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-500 border-ink-200',
    brand: 'bg-brand/10 text-brand border-brand/20',
    success: 'bg-success/10 text-success border-success/20',
    alert: 'bg-alert/10 text-alert border-alert/20',
  } as const

  return (
    <span
      className={cn(
        'rounded border px-1.5 py-0.5 font-mono text-[10px] leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'mb-2 block text-[10px] font-bold tracking-wider text-ink-400 uppercase',
        className,
      )}
      {...props}
    />
  )
}

export function TextInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        // 16px on mobile: anything smaller makes iOS Safari zoom in on focus.
        'h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-base font-light text-ink-900 shadow-soft transition-all outline-none sm:h-10 sm:text-sm',
        'placeholder:text-ink-400 focus:border-ink-300 focus:ring-1 focus:ring-ink-200',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export function SectionTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'text-xs font-semibold tracking-wider text-ink-900 uppercase',
        className,
      )}
      {...props}
    />
  )
}

export function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-ink-400">
      <div className="mb-3 opacity-40">{icon}</div>
      <div className="text-sm font-medium text-ink-500">{title}</div>
      {hint ? <div className="mt-1 text-xs text-ink-400">{hint}</div> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  )
}

/** Inline alert. Reserved for genuine failures — never for AI output. */
export function Alert({
  tone = 'alert',
  children,
}: {
  tone?: 'alert' | 'success'
  children: React.ReactNode
}) {
  const tones = {
    alert: 'border-alert/20 bg-alert/5 text-alert',
    success: 'border-success/20 bg-success/5 text-success',
  } as const

  return (
    <div className={cn('rounded-lg border px-4 py-3 text-xs', tones[tone])}>
      {children}
    </div>
  )
}
