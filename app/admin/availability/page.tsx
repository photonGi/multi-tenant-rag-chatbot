'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Check, Clock, Globe, Loader2, RotateCcw } from 'lucide-react'

import {
  Alert,
  Btn,
  Label,
  Panel,
  PageHeading,
  Pill,
  SectionTitle,
  TextInput,
} from '@/components/console/ui'
import { AdminFrame, AdminTabs, type AdminCompany } from '@/app/admin/admin-frame'
import { describeError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import {
  BUFFER_MINUTES_RANGE,
  DAY_KEYS,
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_MINIMUM_NOTICE_MINUTES,
  DEFAULT_SLOT_MINUTES,
  MINIMUM_NOTICE_RANGE,
  SLOT_MINUTES_RANGE,
  defaultWeeklyHours,
  formatDuration,
  normaliseSettings,
  normaliseWeeklyHours,
  openDays,
  weeklyMinutes,
  weeklyProblems,
  weeklySlots,
  type DayKey,
  type TimeRange,
  type WeeklyHours,
} from '@/lib/availability/schedule'
import { browserTimeZone, listTimeZones, resolveDisplayZone } from '@/lib/time/zones'

import { TimeZoneSelect } from '../timezone-select'
import { DayRow } from './day-row'

/**
 * When the assistant is allowed to offer a meeting.
 *
 * Seeded on first visit like the email template, so the page is never an empty
 * form and the booking workflow always finds a row — a workspace with no
 * schedule would otherwise mean "no availability at all", which is not what
 * "never opened this page" should mean.
 */

interface ScheduleRow {
  id: string
  timezone: string
  weekly_hours: unknown
  slot_minutes: number
  buffer_minutes: number
  minimum_notice_minutes: number
}

const SCHEDULE_COLUMNS =
  'id, timezone, weekly_hours, slot_minutes, buffer_minutes, minimum_notice_minutes'

/** Postgres unique_violation — another tab seeded the same row first. */
const UNIQUE_VIOLATION = '23505'

/** Small numeric field with its unit, used by the three slot rules. */
function MinutesField({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: Readonly<{
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (value: number) => void
}>) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          // Clamped on change rather than on blur: the database has the same
          // bounds as CHECK constraints, and a value that would be rejected
          // there should never reach the Save button.
          onChange={(event) => {
            const parsed = Number(event.target.value)
            if (!Number.isFinite(parsed)) return
            onChange(Math.max(min, Math.min(max, Math.round(parsed))))
          }}
          className="w-28"
        />
        <span className="shrink-0 text-xs text-ink-500">minutes</span>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-400">{hint}</p>
    </div>
  )
}

function AvailabilityEditor({ company }: Readonly<{ company: AdminCompany }>) {
  const supabase = useMemo(() => createClient(), [])

  const [schedule, setSchedule] = useState<ScheduleRow | null>(null)
  const [timezone, setTimezone] = useState<string>('')
  const [weekly, setWeekly] = useState<WeeklyHours>(() => defaultWeeklyHours())
  const [slotMinutes, setSlotMinutes] = useState(DEFAULT_SLOT_MINUTES)
  const [bufferMinutes, setBufferMinutes] = useState(DEFAULT_BUFFER_MINUTES)
  const [noticeMinutes, setNoticeMinutes] = useState(DEFAULT_MINIMUM_NOTICE_MINUTES)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const zones = useMemo(() => listTimeZones(), [])
  const browser = useMemo(() => browserTimeZone(), [])

  const apply = useCallback((row: ScheduleRow) => {
    const settings = normaliseSettings(row)
    setSchedule(row)
    setTimezone(settings.timezone ?? browserTimeZone())
    setWeekly(settings.weeklyHours)
    setSlotMinutes(settings.slotMinutes)
    setBufferMinutes(settings.bufferMinutes)
    setNoticeMinutes(settings.minimumNoticeMinutes)
  }, [])

  useEffect(() => {
    const load = async () => {
      const select = () =>
        supabase
          .from('availability_schedules')
          .select(SCHEDULE_COLUMNS)
          .eq('company_id', company.id)
          .maybeSingle<ScheduleRow>()

      try {
        const { data: existing, error: selectError } = await select()
        if (selectError) throw selectError

        if (existing) {
          apply(existing)
          return
        }

        const { data: seeded, error: insertError } = await supabase
          .from('availability_schedules')
          .insert({
            company_id: company.id,
            // Seeded from the display zone, then independent of it. This one has
            // to name a definite zone — "follow the viewer's browser" cannot
            // mean anything to a lead in another country.
            timezone: resolveDisplayZone(company.display_timezone),
            weekly_hours: defaultWeeklyHours(),
            slot_minutes: DEFAULT_SLOT_MINUTES,
            buffer_minutes: DEFAULT_BUFFER_MINUTES,
            minimum_notice_minutes: DEFAULT_MINIMUM_NOTICE_MINUTES,
          })
          .select(SCHEDULE_COLUMNS)
          .single<ScheduleRow>()

        if (insertError) {
          // Two tabs open on a workspace with no schedule both try to seed it.
          // The loser reads what the winner wrote.
          if (insertError.code === UNIQUE_VIOLATION) {
            const { data: raced } = await select()
            if (raced) {
              apply(raced)
              return
            }
          }
          throw insertError
        }

        apply(seeded)
      } catch (err) {
        console.error('Error loading availability:', describeError(err))
        setError(describeError(err))
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [apply, company.display_timezone, company.id, supabase])

  const problems = useMemo(() => weeklyProblems(weekly), [weekly])
  const hasProblems = Object.keys(problems).length > 0

  const dirty = useMemo(() => {
    if (!schedule) return false

    const saved = normaliseSettings(schedule)

    return (
      // Same fallback `apply` used, or a NULL zone would read as an edit the
      // moment the page loaded.
      timezone !== (saved.timezone ?? browser) ||
      slotMinutes !== saved.slotMinutes ||
      bufferMinutes !== saved.bufferMinutes ||
      noticeMinutes !== saved.minimumNoticeMinutes ||
      // Compared against the normalised form so a reordering-only difference
      // does not register as an edit.
      JSON.stringify(normaliseWeeklyHours(weekly)) !== JSON.stringify(saved.weeklyHours)
    )
  }, [browser, bufferMinutes, noticeMinutes, schedule, slotMinutes, timezone, weekly])

  const setDay = (day: DayKey, ranges: TimeRange[]) => {
    setWeekly((current) => ({ ...current, [day]: ranges }))
  }

  const copyToAll = (from: DayKey) => {
    setWeekly((current) => {
      const source = current[from].map((range) => ({ ...range }))
      const next = {} as WeeklyHours
      // Fresh copies per day, or editing one day would edit all seven.
      for (const day of DAY_KEYS) next[day] = source.map((range) => ({ ...range }))
      return next
    })
  }

  const handleSave = async () => {
    if (!schedule || hasProblems) return

    setSaving(true)
    setError('')

    try {
      // Normalised on the way out: ranges sorted, anything unparseable dropped.
      // The column is jsonb and nothing downstream re-validates it, so this is
      // the last place a malformed week can be stopped.
      const { data, error: updateError } = await supabase
        .from('availability_schedules')
        .update({
          timezone,
          weekly_hours: normaliseWeeklyHours(weekly),
          slot_minutes: slotMinutes,
          buffer_minutes: bufferMinutes,
          minimum_notice_minutes: noticeMinutes,
        })
        .eq('id', schedule.id)
        .select(SCHEDULE_COLUMNS)
        .single<ScheduleRow>()

      if (updateError) throw updateError

      apply(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Error saving availability:', describeError(err))
      setError('Failed to save availability')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!confirm('Replace these hours with weekdays, 9:00 to 17:00?')) return
    setWeekly(defaultWeeklyHours())
  }

  if (loading) {
    return (
      <>
        <PageHeading title="Availability" />
        <AdminTabs active="availability" companyId={company.id} />
        <Panel className="flex items-center gap-3 p-6 font-mono text-xs text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          LOADING AVAILABILITY
        </Panel>
      </>
    )
  }

  const totalMinutes = weeklyMinutes(weekly)
  const slots = weeklySlots(weekly, slotMinutes, bufferMinutes)
  const days = openDays(weekly)

  return (
    <>
      <PageHeading
        title="Availability"
        subtitle="The hours the assistant may offer a lead, and how it cuts them into slots."
      >
        {dirty ? <Pill tone="brand">UNSAVED</Pill> : null}
        <Btn variant="outline" onClick={handleReset} disabled={saving}>
          <RotateCcw className="h-4 w-4" />
          Reset
        </Btn>
        <Btn onClick={handleSave} disabled={!dirty || saving || hasProblems}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </Btn>
      </PageHeading>

      <AdminTabs active="availability" companyId={company.id} />

      {error ? <Alert>{error}</Alert> : null}

      {hasProblems ? (
        <Alert>
          Some hours cannot be saved yet — see the days marked below.
        </Alert>
      ) : null}

      {/* ── Time zone ───────────────────────────────────────────────────────── */}
      <Panel className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-ink-400" />
          <SectionTitle>Schedule Time Zone</SectionTitle>
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          The hours below are read in this zone. It is separate from the display zone in
          Overview on purpose: that one decides how times are shown to <em>you</em>, this
          one decides what &ldquo;9:00&rdquo; means to a lead booking from anywhere in the
          world. Stored as wall-clock times, so the schedule stays right across a
          daylight-saving change.
        </p>

        <div>
          <Label htmlFor="availability-timezone">Hours Are In</Label>
          <TimeZoneSelect
            id="availability-timezone"
            value={timezone}
            browser={browser}
            options={zones}
            disabled={saving}
            // No "follow this browser" here — availability has to name one zone.
            allowBrowserDefault={false}
            onChange={(zone) => {
              if (zone) setTimezone(zone)
            }}
          />
        </div>
      </Panel>

      {/* ── Weekly hours ────────────────────────────────────────────────────── */}
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-ink-400" />
            <SectionTitle>Weekly Hours</SectionTitle>
          </div>
          <div className="font-mono text-[10px] text-ink-400">
            {days.length} {days.length === 1 ? 'DAY' : 'DAYS'} ·{' '}
            {Math.round((totalMinutes / 60) * 10) / 10}H/WEEK ·{' '}
            {slots} {slots === 1 ? 'SLOT' : 'SLOTS'}
          </div>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          Add a second range to a day to leave a gap in the middle — 09:00–12:30 and
          13:30–17:00 keeps lunch clear.
        </p>

        <div className="mt-4">
          {DAY_KEYS.map((day) => (
            <DayRow
              key={day}
              day={day}
              ranges={weekly[day]}
              problems={problems[day]}
              disabled={saving}
              onChange={(ranges) => setDay(day, ranges)}
              onCopyToAll={() => copyToAll(day)}
            />
          ))}
        </div>

        {days.length === 0 ? (
          <p className="mt-4 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-xs leading-relaxed text-ink-600">
            No days are open, so the assistant has nothing to offer and will tell leads
            there is no availability. That is a valid way to pause bookings — just not
            usually the intent.
          </p>
        ) : null}
      </Panel>

      {/* ── Slot rules ──────────────────────────────────────────────────────── */}
      <Panel className="space-y-5 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-ink-400" />
          <SectionTitle>Slot Rules</SectionTitle>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <MinutesField
            id="slot-minutes"
            label="Meeting length"
            hint="How long one booking runs, and the grid the hours above are cut into."
            value={slotMinutes}
            min={SLOT_MINUTES_RANGE.min}
            max={SLOT_MINUTES_RANGE.max}
            disabled={saving}
            onChange={setSlotMinutes}
          />
          <MinutesField
            id="buffer-minutes"
            label="Buffer after"
            hint="Kept clear after each meeting. Not applied at the end of a range."
            value={bufferMinutes}
            min={BUFFER_MINUTES_RANGE.min}
            max={BUFFER_MINUTES_RANGE.max}
            disabled={saving}
            onChange={setBufferMinutes}
          />
          <MinutesField
            id="notice-minutes"
            label="Minimum notice"
            hint={`Earliest a lead may book: ${formatDuration(noticeMinutes)} from now.`}
            value={noticeMinutes}
            min={MINIMUM_NOTICE_RANGE.min}
            max={MINIMUM_NOTICE_RANGE.max}
            disabled={saving}
            onChange={setNoticeMinutes}
          />
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          These are the rules for what may be <em>offered</em>. Whether a slot is actually
          free is decided against the connected calendar at booking time.
        </p>
      </Panel>
    </>
  )
}

export default function AdminAvailabilityPage() {
  return (
    <AdminFrame section="availability" badge="AVAILABILITY" loadingLabel="Loading availability">
      {(company) => <AvailabilityEditor company={company} />}
    </AdminFrame>
  )
}
