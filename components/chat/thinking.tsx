'use client'

import { Bot } from 'lucide-react'

/**
 * In-flight indicator.
 *
 * A single quiet state rather than a staged breakdown: the workflow reports no
 * intermediate progress, so any step list would only be a timer pretending to
 * be telemetry. It wears the same bubble the answer will wear, so the swap into
 * the real message reads as the bubble filling rather than one thing replacing
 * another.
 */
export function Thinking() {
  return (
    <div className="flex animate-bubble-in gap-2.5 sm:gap-4">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-brand shadow-soft">
        <Bot className="h-4.5 w-4.5" />
      </div>

      <div
        className="flex items-center gap-2.5 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-3.5 shadow-soft"
        role="status"
        aria-live="polite"
        aria-label="Thinking"
      >
        <span className="font-mono text-[10px] tracking-wider text-ink-400 uppercase sm:text-[11px]">
          Thinking
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-300"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
