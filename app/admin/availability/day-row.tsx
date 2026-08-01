'use client'

import { CopyPlus, Plus, X } from 'lucide-react'

import {
  DAY_LABELS,
  DAY_SHORT,
  formatTimeLabel,
  type DayKey,
  type TimeRange,
} from '@/lib/availability/schedule'
import { cn } from '@/lib/utils'

/**
 * One weekday's open hours.
 *
 * The toggle and the ranges are the same fact stated two ways — a day is open
 * because it has hours — so turning a day off keeps its ranges in component
 * state and turning it back on restores them. Someone clearing Saturday to
 * check something should not have to retype it.
 */

const timeInputClass =
  'h-9 w-[7.5rem] rounded-lg border border-border bg-surface px-2.5 text-sm font-light text-ink-900 shadow-soft transition-all outline-none focus:border-ink-300 focus:ring-1 focus:ring-ink-200 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60'

const iconButtonClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:pointer-events-none disabled:opacity-30'

export function DayRow({
  day,
  ranges,
  problems,
  disabled,
  onChange,
  onCopyToAll,
}: Readonly<{
  day: DayKey
  ranges: TimeRange[]
  problems?: string[]
  disabled?: boolean
  onChange: (ranges: TimeRange[]) => void
  onCopyToAll: () => void
}>) {
  const open = ranges.length > 0

  const setRange = (index: number, patch: Partial<TimeRange>) => {
    onChange(ranges.map((range, at) => (at === index ? { ...range, ...patch } : range)))
  }

  const addRange = () => {
    // A new range starts where the last one ended, which is almost always what
    // is wanted — an afternoon block after a lunch break — and is never an
    // overlap. First range of the day falls back to a working morning.
    const last = ranges.at(-1)
    onChange([...ranges, last ? { start: last.end, end: '17:00' } : { start: '09:00', end: '17:00' }])
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b border-border/60 py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-4',
        !open && 'opacity-60',
      )}
    >
      {/* Day + toggle */}
      <label className="flex w-full shrink-0 cursor-pointer items-center gap-2.5 sm:w-32 sm:pt-1.5">
        <input
          type="checkbox"
          checked={open}
          disabled={disabled}
          onChange={(event) =>
            onChange(event.target.checked ? [{ start: '09:00', end: '17:00' }] : [])
          }
          className="h-4 w-4 shrink-0 accent-ink-900"
          aria-label={`${DAY_LABELS[day]} available`}
        />
        <span className="text-sm font-medium text-ink-900">
          <span className="sm:hidden">{DAY_LABELS[day]}</span>
          <span className="hidden sm:inline">{DAY_SHORT[day]}</span>
        </span>
      </label>

      {/* Ranges */}
      <div className="min-w-0 flex-1 space-y-2">
        {open ? (
          ranges.map((range, index) => (
            <div
              // Index as key: these rows have no id, and reordering only ever
              // happens on save (where the whole array is replaced), so an
              // index cannot outlive the row it names.
              key={`${day}-${index}`}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="time"
                value={range.start}
                disabled={disabled}
                step={900}
                onChange={(event) => setRange(index, { start: event.target.value })}
                className={timeInputClass}
                aria-label={`${DAY_LABELS[day]} start time`}
              />
              <span className="text-xs text-ink-400">–</span>
              <input
                type="time"
                value={range.end}
                disabled={disabled}
                step={900}
                onChange={(event) => setRange(index, { end: event.target.value })}
                className={timeInputClass}
                aria-label={`${DAY_LABELS[day]} end time`}
              />

              <button
                type="button"
                onClick={() => onChange(ranges.filter((_, at) => at !== index))}
                disabled={disabled}
                className={iconButtonClass}
                title="Remove this range"
                aria-label={`Remove ${DAY_LABELS[day]} range ${index + 1}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {index === ranges.length - 1 ? (
                <>
                  <button
                    type="button"
                    onClick={addRange}
                    disabled={disabled}
                    className={iconButtonClass}
                    title="Add another range — for a lunch break"
                    aria-label={`Add a range to ${DAY_LABELS[day]}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onCopyToAll}
                    disabled={disabled}
                    className={iconButtonClass}
                    title="Copy these hours to every day"
                    aria-label={`Copy ${DAY_LABELS[day]} hours to all days`}
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : null}
            </div>
          ))
        ) : (
          <div className="flex h-9 items-center text-xs text-ink-400">Unavailable</div>
        )}

        {problems?.length ? (
          <ul className="space-y-0.5 pt-0.5">
            {problems.map((problem) => (
              <li key={problem} className="text-[11px] text-alert">
                {problem}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Plain-language echo of the row, so the 24h inputs are checkable
          against the 12h clock most people think in. */}
      {open && !problems?.length ? (
        <div className="shrink-0 pt-2 font-mono text-[10px] text-ink-400 sm:w-44 sm:text-right">
          {ranges
            .map((range) => `${formatTimeLabel(range.start)} – ${formatTimeLabel(range.end)}`)
            .join(', ')}
        </div>
      ) : null}
    </div>
  )
}
