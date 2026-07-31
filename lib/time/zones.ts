/**
 * Time zone handling for the console.
 *
 * WHY THIS EXISTS
 * ---------------
 * `meetings.timezone` is written by the booking workflow and holds whatever the
 * lead's browser or the workflow decided to send — 'Asia/Kolkata' on one row,
 * 'IST' on the next, null on the one after. ICU accepts 'IST' as a legacy alias,
 * so rendering that string back produced a list where every row appeared to be
 * in a different zone and none of them could be compared at a glance.
 *
 * The instant is the truth: `starts_at` is a timestamptz, so it names one moment
 * regardless of what any row says its zone was. So the console picks *one* zone
 * — the owner's — and renders every row in it. Changing it changes nothing about
 * the meetings themselves; it is purely how they are displayed.
 *
 * Pure and browser-safe: no imports, no server dependencies.
 */

/**
 * Zones IANA renamed, which ICU still reports under the old name.
 *
 * `Intl.supportedValuesOf('timeZone')` returns ICU's canonical list, and ICU
 * canonicalises to the *older* of a renamed pair — so on Node 22 and most
 * browsers the list contains 'Asia/Calcutta' and not 'Asia/Kolkata', even
 * though Kolkata is the current IANA name and the only one a user in India will
 * think to look for. `resolvedOptions().timeZone` does the same.
 *
 * Both names always format identically (they are links to the same zone data),
 * so substituting the modern name is safe and is purely about the label a
 * person reads. Kept deliberately short: only renames someone would actually
 * notice missing. IANA renames are rare, so this does not grow often.
 */
const MODERN_ZONE_NAMES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
}

/** The current IANA name, when this runtime reports a superseded one. */
function modernise(zone: string): string {
  const modern = MODERN_ZONE_NAMES[zone]
  // Guarded: a runtime old enough to lack the new name keeps the old one rather
  // than being handed a zone it cannot format.
  return modern && isValidTimeZone(modern) ? modern : zone
}

/** The zone the viewer's own machine is set to. */
export function browserTimeZone(): string {
  try {
    return modernise(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  } catch {
    return 'UTC'
  }
}

/**
 * Whether a string is a zone this runtime can actually format in.
 *
 * Note that ICU accepts more than the IANA canonical list — 'IST' passes here.
 * That is fine for validating a stored preference (it will format correctly),
 * and it is precisely why the *display* zone is a deliberate choice rather than
 * whatever arrived in the data.
 */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false

  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * The zone to render in: the workspace's saved preference when it is set and
 * usable, otherwise whatever the viewer's machine says.
 *
 * The fallback is deliberate — an owner who has never opened the setting still
 * sees times in their own zone rather than in UTC.
 */
export function resolveDisplayZone(stored: string | null | undefined): string {
  return isValidTimeZone(stored) ? stored : browserTimeZone()
}

/**
 * Every zone this browser knows, sorted by offset then name.
 *
 * `Intl.supportedValuesOf` gives ~420 entries with no list to ship or maintain.
 * Where it is missing (Safari before 15.4), a short list covering the common
 * cases beats an empty picker — the field still accepts any zone the runtime
 * understands, this only decides what is offered.
 */
const FALLBACK_ZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

export interface ZoneOption {
  zone: string
  /** 'GMT+05:30', for the picker label. */
  offsetLabel: string
  /** Minutes east of UTC, for sorting. */
  offsetMinutes: number
}

/**
 * The offset a zone is at *right now*.
 *
 * Right now, and not at some fixed reference date, because half the world
 * changes offset twice a year — a picker built on a January reference labels
 * Europe/London as GMT+00:00 all summer.
 */
export function zoneOffset(zone: string, at: Date = new Date()): ZoneOption {
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    }).format(at)

    // 'longOffset' renders UTC itself as a bare 'GMT' with no digits.
    const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(formatted)
    if (!match) return { zone, offsetLabel: 'GMT+00:00', offsetMinutes: 0 }

    const sign = match[1] === '-' ? -1 : 1
    const hours = Number(match[2])
    const minutes = Number(match[3] ?? '0')

    return {
      zone,
      offsetLabel: `GMT${match[1]}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      offsetMinutes: sign * (hours * 60 + minutes),
    }
  } catch {
    return { zone, offsetLabel: '', offsetMinutes: 0 }
  }
}

export function listTimeZones(): ZoneOption[] {
  let zones: string[]

  try {
    zones =
      typeof Intl.supportedValuesOf === 'function'
        ? [...Intl.supportedValuesOf('timeZone')]
        : FALLBACK_ZONES
  } catch {
    zones = FALLBACK_ZONES
  }

  // 'UTC' is genuinely absent from supportedValuesOf (verified on Node 22 and
  // in browsers — the list carries 'Etc/UTC' instead), and it is the one entry
  // someone deliberately looking for a neutral zone will search for.
  if (!zones.includes('UTC')) zones.push('UTC')

  // Deduped after modernising: if a runtime somehow offers both names of a
  // renamed pair, they collapse to one entry rather than appearing twice.
  const named = [...new Set(zones.map(modernise))]

  return named
    .map((zone) => zoneOffset(zone))
    .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.zone.localeCompare(b.zone))
}

/** 'Sat, 1 Aug 2026' and '10:30 PM', both in the given zone. */
export function formatInZone(
  value: string | null | undefined,
  zone: string,
): { date: string; time: string } | null {
  if (!value) return null

  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return null

  const options = { timeZone: isValidTimeZone(zone) ? zone : undefined } as const

  return {
    date: instant.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...options,
    }),
    time: instant.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }),
  }
}

/**
 * A short label for the zone in running text.
 *
 * CLDR only has letter abbreviations for some zones — 'EDT' for New York, but
 * 'GMT+5:30' for India, which has no English abbreviation it agrees on. That is
 * the better outcome anyway: an offset says exactly what it means, where 'IST'
 * is claimed by India, Israel and Ireland at once. Callers pair this with the
 * full zone id somewhere reachable.
 *
 * Falls back to the zone id, which is long but never wrong.
 */
export function zoneAbbreviation(zone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(at)

    return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone
  } catch {
    return zone
  }
}
