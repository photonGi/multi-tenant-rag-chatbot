'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Globe, Loader2 } from 'lucide-react'

import { Label, Panel, SectionTitle } from '@/components/console/ui'
import { describeError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import {
  browserTimeZone,
  formatInZone,
  listTimeZones,
  resolveDisplayZone,
} from '@/lib/time/zones'
import { cn } from '@/lib/utils'

/**
 * Which zone the console renders meeting times in.
 *
 * Display only. `meetings.starts_at` is a timestamptz — it already names one
 * exact instant — so this changes how a booking is written down and nothing
 * about when it happens, what the calendar event says, or what the confirmation
 * email quoted. The copy below says so, because a control that looks like it
 * might move a meeting is a control nobody dares touch.
 *
 * Saved on change rather than behind a Save button: it is a single value with an
 * immediately visible effect, and the console treats those optimistically
 * elsewhere too.
 */

/** Matches TextInput, plus room for the native chevron. */
const selectClass =
  'h-11 w-full appearance-none rounded-lg border border-border bg-surface px-3.5 pr-9 text-base font-light text-ink-900 shadow-soft transition-all outline-none sm:h-10 sm:text-sm focus:border-ink-300 focus:ring-1 focus:ring-ink-200 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60'

export function TimeZoneSetting({
  companyId,
  value,
  onSaved,
}: {
  companyId: string
  /** null means "follow the viewer's browser". */
  value: string | null
  onSaved: (zone: string | null) => void
}) {
  const supabase = useMemo(() => createClient(), [])

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // 417 zones, each needing its own DateTimeFormat to read an offset from.
  // Built once — recomputing it on every keystroke elsewhere on the page would
  // be tens of milliseconds for a list that does not change.
  const zones = useMemo(() => listTimeZones(), [])
  const browser = useMemo(() => browserTimeZone(), [])
  const active = resolveDisplayZone(value)

  // A clock, so the choice can be confirmed against something real rather than
  // against the reader's arithmetic. Ticks on the minute boundary it displays.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const handleChange = async (next: string) => {
    // The empty option is the "follow this browser" default, stored as null so
    // it keeps following a viewer who later moves.
    const zone = next === '' ? null : next

    setSaving(true)
    setError('')

    try {
      const { error: updateError } = await supabase
        .from('companies')
        .update({ display_timezone: zone })
        .eq('id', companyId)

      if (updateError) throw updateError

      onSaved(zone)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Error saving display timezone:', describeError(err))
      setError('Failed to save the time zone')
    } finally {
      setSaving(false)
    }
  }

  const currentTime = formatInZone(now.toISOString(), active)

  return (
    <Panel className="space-y-4 p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-ink-400" />
        <SectionTitle>Time Zone</SectionTitle>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-400" /> : null}
        {saved && !saving ? (
          <span className="flex items-center gap-1 font-mono text-[10px] text-success">
            <Check className="h-3 w-3" />
            SAVED
          </span>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-ink-500">
        Meetings are shown in this zone throughout the console. Bookings are stored as
        exact moments in time, so changing this only changes how they are displayed — it
        does not move a meeting or alter what a lead was told.
      </p>

      <div>
        <Label htmlFor="display-timezone">Display Meetings In</Label>
        <div className="relative">
          <select
            id="display-timezone"
            value={value ?? ''}
            disabled={saving}
            onChange={(event) => handleChange(event.target.value)}
            className={selectClass}
          >
            <option value="">Follow this browser ({browser})</option>
            {zones.map((option) => (
              <option key={option.zone} value={option.zone}>
                {option.zone}
                {option.offsetLabel ? ` — ${option.offsetLabel}` : ''}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-400">
            ▾
          </span>
        </div>
      </div>

      <div
        className={cn(
          'flex flex-col gap-1 rounded-lg border border-border bg-ink-50 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
        )}
      >
        <span className="font-mono text-[10px] tracking-wider text-ink-400 uppercase">
          Current time here
        </span>
        <span className="font-mono text-xs text-ink-900">
          {currentTime ? `${currentTime.date}, ${currentTime.time}` : '—'}
          <span className="ml-2 text-ink-400">{active}</span>
        </span>
      </div>

      {error ? <p className="text-xs text-alert">{error}</p> : null}
    </Panel>
  )
}
