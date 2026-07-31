'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

import { searchZones, type ZoneOption } from '@/lib/time/zones'
import { cn } from '@/lib/utils'

/**
 * Searchable zone picker.
 *
 * A native `<select>` with 417 options is technically usable and practically
 * not: type-ahead only matches the start of the label, so finding
 * 'Asia/Kolkata' means typing 'Asia/K' with no feedback, and on mobile it is a
 * 417-row scroll wheel. This is the APG editable-combobox pattern instead —
 * one input that filters as you type.
 *
 * Not virtualised on purpose. The filtered list is usually a handful of rows,
 * the unfiltered worst case is ~420, and a windowing library would add a
 * dependency plus scroll-anchoring bugs to solve a problem this size does not
 * have.
 */

const FOLLOW_BROWSER = '__browser__'

export function TimeZoneSelect({
  id,
  value,
  browser,
  options,
  disabled,
  onChange,
}: Readonly<{
  id: string
  /** null means "follow the viewer's browser". */
  value: string | null
  browser: string
  options: ZoneOption[]
  disabled?: boolean
  onChange: (zone: string | null) => void
}>) {
  const listId = useId()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const browserLabel = `Follow this browser (${browser})`
  const selectedLabel = value
    ? `${value}${options.find((o) => o.zone === value)?.offsetLabel ? ` — ${options.find((o) => o.zone === value)!.offsetLabel}` : ''}`
    : browserLabel

  /** The browser default is an option too, and must be findable by typing. */
  const matches = useMemo(() => {
    const zones = searchZones(options, query)
    const needle = query.trim().toLowerCase()
    const showBrowser =
      !needle ||
      browserLabel.toLowerCase().includes(needle) ||
      'default'.startsWith(needle)

    return showBrowser
      ? [{ zone: FOLLOW_BROWSER, offsetLabel: '', offsetMinutes: 0 }, ...zones]
      : zones
  }, [browserLabel, options, query])

  // Reset the cursor whenever the list changes underneath it, so Enter never
  // lands on whatever happened to be at that index a keystroke ago.
  useEffect(() => setHighlight(0), [query])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const commit = useCallback(
    (zone: string) => {
      onChange(zone === FOLLOW_BROWSER ? null : zone)
      close()
      // Focus returns to the control, not the page, so the keyboard path can
      // continue without a stop at document.body.
      inputRef.current?.focus()
    },
    [close, onChange],
  )

  // Dismiss on an outside press. Pointerdown rather than click so a press that
  // starts outside cannot land on an option that moved under the cursor.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [close, open])

  // Keep the active option in view for keyboard users.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((current) => {
        if (matches.length === 0) return 0
        return (current + step + matches.length) % matches.length
      })
      return
    }

    if (event.key === 'Enter') {
      if (!open) return
      event.preventDefault()
      const choice = matches[highlight]
      if (choice) commit(choice.zone)
      return
    }

    if (event.key === 'Escape') {
      if (!open) return
      // Stops the key escaping to anything that closes on Escape behind us.
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }

    if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlight(0)
      return
    }

    if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlight(Math.max(0, matches.length - 1))
    }
  }

  const activeId = matches[highlight] ? `${listId}-${highlight}` : undefined

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className={cn(
            'pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 transition-colors',
            open ? 'text-ink-500' : 'text-ink-400',
          )}
        />

        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={open ? query : selectedLabel}
          // While open the field is a search box, so the current selection
          // moves to the placeholder rather than being text you must delete.
          placeholder={open ? selectedLabel : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            'h-11 w-full rounded-lg border border-border bg-surface pr-9 pl-9 text-base font-light text-ink-900 shadow-soft transition-all outline-none sm:h-10 sm:text-sm',
            'placeholder:text-ink-400 focus:border-ink-300 focus:ring-1 focus:ring-ink-200',
            'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60',
            // Closed, it reads as a value rather than as something half-typed.
            !open && 'cursor-pointer',
          )}
        />

        <ChevronDown
          className={cn(
            'pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-ink-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Time zones"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-elevated"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-400">
              No zone matches “{query}”. Try a city, a region, or an offset like
              +05:30.
            </li>
          ) : (
            matches.map((option, index) => {
              const isBrowser = option.zone === FOLLOW_BROWSER
              const selected = isBrowser ? value === null : value === option.zone

              return (
                <li
                  key={option.zone}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  // Mouse down would blur the input and close the list before
                  // the click ever landed.
                  onPointerDown={(event) => {
                    event.preventDefault()
                    commit(option.zone)
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors',
                    index === highlight ? 'bg-ink-100 text-ink-900' : 'text-ink-700',
                  )}
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      selected ? 'text-success' : 'invisible',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {isBrowser ? browserLabel : option.zone}
                  </span>
                  {option.offsetLabel ? (
                    <span className="shrink-0 font-mono text-[10px] text-ink-400">
                      {option.offsetLabel}
                    </span>
                  ) : null}
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
