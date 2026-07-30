'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { TextInput } from '@/components/console/ui'
import { cn } from '@/lib/utils'

/**
 * Password field with a reveal toggle.
 *
 * Lives in its own client module rather than in ui.tsx: that file is imported
 * by AuthShell, which server components render, and a hook in there would drag
 * the whole module across the boundary.
 *
 * Each instance holds its own visibility, so the two fields on the sign-up form
 * reveal independently.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <TextInput
        {...props}
        type={visible ? 'text' : 'password'}
        // Clears the toggle so a long password never runs under it.
        className={cn('pr-11', className)}
      />

      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        // The label states the action; aria-pressed carries the current state.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-400 transition-colors hover:text-ink-900 focus-visible:text-ink-900 disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
