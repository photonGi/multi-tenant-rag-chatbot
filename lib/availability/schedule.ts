/**
 * Bookable availability: the shape, the defaults, and the rules about what is
 * a valid week.
 *
 * This module is the authority on all three. The editor, the seeded default and
 * anything reading `availability_schedules` back go through it, so there is one
 * definition of "valid" rather than one in the form and a different one in the
 * database.
 *
 * Hours are **wall-clock times in the schedule's own zone**, never offsets and
 * never instants. "I work 9 to 5" has to survive a daylight-saving change; an
 * offset resolved at save time silently moves every meeting by an hour twice a
 * year. Turning these into instants is the booking workflow's job, and it needs
 * `timezone` from the same row to do it.
 *
 * Pure and dependency-free: it runs in the browser for the editor.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export type DayKey = (typeof DAY_KEYS)[number]

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

export const DAY_SHORT: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

/** A single open span, as 'HH:MM' wall-clock times. */
export interface TimeRange {
  start: string
  end: string
}

/** An empty array is a day off. Several ranges is how a lunch break is said. */
export type WeeklyHours = Record<DayKey, TimeRange[]>

export interface AvailabilitySettings {
  timezone: string
  weeklyHours: WeeklyHours
  slotMinutes: number
  bufferMinutes: number
  minimumNoticeMinutes: number
}

export const DEFAULT_SLOT_MINUTES = 30
export const DEFAULT_BUFFER_MINUTES = 0
export const DEFAULT_MINIMUM_NOTICE_MINUTES = 120

/** Matching the CHECK constraints in scripts/availability-schema.sql. */
export const SLOT_MINUTES_RANGE = { min: 5, max: 480 } as const
export const BUFFER_MINUTES_RANGE = { min: 0, max: 240 } as const
export const MINIMUM_NOTICE_RANGE = { min: 0, max: 43_200 } as const

/** Weekdays nine to five — the answer for most workspaces, and a legible start. */
export function defaultWeeklyHours(): WeeklyHours {
  const workday: TimeRange[] = [{ start: '09:00', end: '17:00' }]

  return {
    // Fresh arrays per day: a shared reference would make editing Monday edit
    // Tuesday as well.
    mon: [...workday.map((range) => ({ ...range }))],
    tue: [...workday.map((range) => ({ ...range }))],
    wed: [...workday.map((range) => ({ ...range }))],
    thu: [...workday.map((range) => ({ ...range }))],
    fri: [...workday.map((range) => ({ ...range }))],
    sat: [],
    sun: [],
  }
}

const TIME_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** '09:30' → 570. Null for anything that is not a wall-clock time. */
export function minutesFromTime(value: unknown): number | null {
  if (typeof value !== 'string') return null

  const match = TIME_SHAPE.exec(value)
  if (!match) return null

  return Number(match[1]) * 60 + Number(match[2])
}

/** 570 → '09:30'. */
export function timeFromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  const hours = Math.floor(clamped / 60)
  return `${String(hours).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}

/**
 * Reads whatever is in the jsonb column into a known shape.
 *
 * Everything unrecognised is dropped rather than repaired: a range with no end,
 * a day key that is not a weekday, a string where an array belongs. The column
 * is jsonb, so it can hold anything a future workflow or a hand-run SQL
 * statement puts there, and the editor must not render — or re-save — a shape
 * it does not understand.
 *
 * Ranges come back sorted by start time, which is what makes overlap checking
 * and display a single pass.
 */
export function normaliseWeeklyHours(input: unknown): WeeklyHours {
  const source = (input ?? {}) as Record<string, unknown>
  const result = {} as WeeklyHours

  for (const day of DAY_KEYS) {
    const raw = source[day]
    if (!Array.isArray(raw)) {
      result[day] = []
      continue
    }

    const ranges: TimeRange[] = []

    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue

      const { start, end } = entry as { start?: unknown; end?: unknown }
      const startMinutes = minutesFromTime(start)
      const endMinutes = minutesFromTime(end)

      // A zero-or-negative-length span is not a narrower window, it is a
      // mistake — and one that would render as an unbookable row forever.
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        continue
      }

      ranges.push({ start: start as string, end: end as string })
    }

    ranges.sort(
      (a, b) => (minutesFromTime(a.start) ?? 0) - (minutesFromTime(b.start) ?? 0),
    )

    result[day] = ranges
  }

  return result
}

/**
 * What is wrong with one day's ranges, in the order a person would fix them.
 *
 * Returns messages rather than a boolean because the editor shows them inline —
 * "that is invalid" is not something anyone can act on.
 */
export function dayProblems(ranges: TimeRange[]): string[] {
  const problems: string[] = []

  const parsed = ranges.map((range) => ({
    range,
    start: minutesFromTime(range.start),
    end: minutesFromTime(range.end),
  }))

  for (const { range, start, end } of parsed) {
    if (start === null || end === null) {
      problems.push('Enter both a start and an end time.')
      continue
    }
    if (end <= start) {
      problems.push(`${range.start}–${range.end} ends before it starts.`)
    }
  }

  // Overlap is checked on the sorted copy, so one pass over neighbours catches
  // every case. Touching ranges (17:00 then 17:00) are fine — that is one
  // continuous block written as two, not a conflict.
  const usable = parsed
    .filter((entry): entry is { range: TimeRange; start: number; end: number } =>
      entry.start !== null && entry.end !== null && entry.end > entry.start)
    .sort((a, b) => a.start - b.start)

  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1]
    const current = usable[index]

    if (current.start < previous.end) {
      problems.push(
        `${previous.range.start}–${previous.range.end} overlaps ${current.range.start}–${current.range.end}.`,
      )
    }
  }

  return problems
}

/** Every day's problems, keyed by day. Days with nothing wrong are absent. */
export function weeklyProblems(weekly: WeeklyHours): Partial<Record<DayKey, string[]>> {
  const problems: Partial<Record<DayKey, string[]>> = {}

  for (const day of DAY_KEYS) {
    const found = dayProblems(weekly[day] ?? [])
    if (found.length > 0) problems[day] = found
  }

  return problems
}

/** Open minutes across the week, ignoring ranges that are not yet valid. */
export function weeklyMinutes(weekly: WeeklyHours): number {
  let total = 0

  for (const day of DAY_KEYS) {
    for (const range of weekly[day] ?? []) {
      const start = minutesFromTime(range.start)
      const end = minutesFromTime(range.end)
      if (start !== null && end !== null && end > start) total += end - start
    }
  }

  return total
}

/**
 * How many slots a week of these hours actually yields.
 *
 * Each range is cut independently — a 50-minute gap does not become a slot just
 * because a neighbouring range has room. Buffer counts against the slot that
 * precedes it, except at the end of a range, where there is nothing to keep
 * clear from: a 60-minute window with a 30-minute meeting and a 15-minute
 * buffer holds one meeting, not zero.
 */
export function weeklySlots(
  weekly: WeeklyHours,
  slotMinutes: number,
  bufferMinutes: number,
): number {
  if (slotMinutes <= 0) return 0

  let slots = 0

  for (const day of DAY_KEYS) {
    for (const range of weekly[day] ?? []) {
      const start = minutesFromTime(range.start)
      const end = minutesFromTime(range.end)
      if (start === null || end === null || end <= start) continue

      let cursor = start
      while (cursor + slotMinutes <= end) {
        slots += 1
        cursor += slotMinutes + bufferMinutes
      }
    }
  }

  return slots
}

/** '9:00 AM – 5:00 PM' in the viewer's locale, from wall-clock strings. */
export function formatTimeLabel(value: string): string {
  const minutes = minutesFromTime(value)
  if (minutes === null) return value

  // An arbitrary date, because only the clock face is being formatted — the day
  // it lands on is never shown.
  const stamp = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)

  return stamp.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** 'Mon, Tue, Wed' — the days with any open hours, in week order. */
export function openDays(weekly: WeeklyHours): DayKey[] {
  return DAY_KEYS.filter((day) => (weekly[day] ?? []).length > 0)
}

/** Reads a database row into the settings the editor works with. */
export function normaliseSettings(row: {
  timezone?: unknown
  weekly_hours?: unknown
  slot_minutes?: unknown
  buffer_minutes?: unknown
  minimum_notice_minutes?: unknown
}): Omit<AvailabilitySettings, 'timezone'> & { timezone: string | null } {
  const clamp = (value: unknown, fallback: number, bounds: { min: number; max: number }) => {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(bounds.min, Math.min(bounds.max, Math.round(parsed)))
  }

  return {
    timezone: typeof row.timezone === 'string' && row.timezone ? row.timezone : null,
    weeklyHours: normaliseWeeklyHours(row.weekly_hours),
    slotMinutes: clamp(row.slot_minutes, DEFAULT_SLOT_MINUTES, SLOT_MINUTES_RANGE),
    bufferMinutes: clamp(row.buffer_minutes, DEFAULT_BUFFER_MINUTES, BUFFER_MINUTES_RANGE),
    minimumNoticeMinutes: clamp(
      row.minimum_notice_minutes,
      DEFAULT_MINIMUM_NOTICE_MINUTES,
      MINIMUM_NOTICE_RANGE,
    ),
  }
}

/** '2 hours', '30 minutes', '1 day' — for the minimum-notice summary. */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return 'none'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24)
    return `${days} day${days === 1 ? '' : 's'}`
  }

  const hours = minutes / 60
  const rounded = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10
  return `${rounded} hour${rounded === 1 ? '' : 's'}`
}
