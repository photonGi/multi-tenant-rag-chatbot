'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Globe, MapPin, RefreshCw, Video } from 'lucide-react'

import {
  Alert,
  Btn,
  EmptyState,
  Panel,
  PageHeading,
  Pill,
  SectionTitle,
} from '@/components/console/ui'
import { AdminFrame, AdminTabs, type AdminCompany } from '@/app/admin/admin-frame'
import { adminPath } from '@/lib/admin/routes'
import { describeError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { formatInZone, resolveDisplayZone, zoneAbbreviation } from '@/lib/time/zones'

/**
 * What the assistant has booked. Read-only, deliberately.
 *
 * These rows describe calendar events that exist in Google. Editing one here
 * would change this app's record of a meeting without changing the meeting —
 * the lead would still receive the invitation that was actually sent. The
 * calendar is the system of record; this is the view of it.
 */

interface Meeting {
  id: string
  memory_key: string | null
  lead_name: string | null
  lead_email: string | null
  starts_at: string | null
  ends_at: string | null
  timezone: string | null
  is_online: boolean
  purpose: string | null
  meet_link: string | null
  status: 'booked' | 'cancelled' | 'completed'
  created_at: string
}

const MEETING_COLUMNS =
  'id, memory_key, lead_name, lead_email, starts_at, ends_at, timezone, is_online, meet_link, status, purpose, created_at'

const STATUS_TONE = {
  booked: 'success',
  completed: 'neutral',
  cancelled: 'alert',
} as const

/**
 * Renders the instant in the workspace's chosen display zone — one zone for
 * every row, set in Admin → Overview.
 *
 * It deliberately ignores `meetings.timezone`. That column records whatever the
 * booking workflow sent, which in practice varies row to row ('Asia/Kolkata',
 * the legacy alias 'IST', null), and ICU accepts most of it — so echoing it back
 * produced a list where no two rows were in the same zone and none were in the
 * reader's. `starts_at` is a timestamptz and already names the exact moment, so
 * the zone is purely a rendering choice, and the owner's is the useful one.
 */
function formatWhen(
  meeting: Meeting,
  zone: string,
): { date: string; time: string } {
  const starts = formatInZone(meeting.starts_at, zone)
  if (!starts) return { date: '—', time: '' }

  const ends = formatInZone(meeting.ends_at, zone)

  return {
    date: starts.date,
    time: ends ? `${starts.time} – ${ends.time}` : starts.time,
  }
}

function MeetingsList({ company }: { company: AdminCompany }) {
  const supabase = useMemo(() => createClient(), [])

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // A counter rather than the `refreshing` flag itself. Depending on the flag
  // would run the effect twice per click — once when it goes true, once when
  // the load sets it back to false.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data, error: loadError } = await supabase
        .from('meetings')
        .select(MEETING_COLUMNS)
        .eq('company_id', company.id)
        .order('starts_at', { ascending: false })

      if (cancelled) return

      if (loadError) {
        console.error('Error loading meetings:', describeError(loadError))
        setError('Failed to load meetings')
      } else {
        setMeetings((data ?? []) as Meeting[])
        setError('')
      }

      setLoading(false)
      setRefreshing(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [company.id, reloadToken, supabase])

  const zone = resolveDisplayZone(company.display_timezone)

  const upcoming = meetings.filter(
    (meeting) =>
      meeting.status === 'booked' &&
      meeting.starts_at !== null &&
      Date.parse(meeting.starts_at) >= Date.now(),
  ).length

  return (
    <>
      <PageHeading
        title="Meetings"
        subtitle="Bookings the assistant has made for this workspace."
      >
        {/* The zone every row below is rendered in, stated rather than assumed —
            and a route to changing it, since the setting lives on another tab. */}
        <Link
          href={adminPath('overview', company.id)}
          // `title`, not the rail's data-tooltip: that one renders to the right
          // of its anchor, and this sits at the right edge of the header where
          // it would be clipped.
          //
          // The abbreviation fits a pill where 'Asia/Kolkata' does not, but it
          // is often only an offset — so the full zone id is one hover away
          // rather than absent.
          title={`${zone} — change in Overview`}
          className="flex items-center gap-1.5 rounded border border-ink-200 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900"
        >
          <Globe className="h-3 w-3" />
          {zoneAbbreviation(zone)}
        </Link>
        <Btn
          variant="outline"
          onClick={() => {
            setRefreshing(true)
            setReloadToken((token) => token + 1)
          }}
          disabled={refreshing}
        >
          <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          Refresh
        </Btn>
      </PageHeading>

      <AdminTabs active="meetings" companyId={company.id} />

      {error ? <Alert>{error}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        <Panel className="p-5">
          <SectionTitle className="text-ink-500">Total Booked</SectionTitle>
          <div className="mt-2 text-3xl font-light text-ink-900">{meetings.length}</div>
        </Panel>
        <Panel className="p-5">
          <SectionTitle className="text-ink-500">Upcoming</SectionTitle>
          <div className="mt-2 text-3xl font-light text-ink-900">{upcoming}</div>
        </Panel>
        <Panel className="p-5">
          <SectionTitle className="text-ink-500">Online</SectionTitle>
          <div className="mt-2 text-3xl font-light text-ink-900">
            {meetings.filter((meeting) => meeting.is_online).length}
          </div>
        </Panel>
      </div>

      {loading ? (
        <Panel className="p-6 font-mono text-xs text-ink-500">LOADING MEETINGS</Panel>
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-10 w-10" />}
          title="No meetings booked yet"
          hint="Bookings made by the assistant appear here as soon as they are confirmed."
        />
      ) : (
        <Panel className="divide-y divide-border/60 overflow-hidden">
          {meetings.map((meeting) => {
            const when = formatWhen(meeting, zone)

            return (
              <div
                key={meeting.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5"
              >
                {/* Lead */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900">
                    {meeting.lead_name?.trim() || 'Unnamed lead'}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-ink-500">
                    {meeting.lead_email ?? 'No email recorded'}
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900">
                    {meeting.purpose?.trim() || 'No purpose recorded'}
                  </div>
                </div>

                {/* When */}
                <div className="min-w-0 sm:w-56 sm:shrink-0">
                  <div className="font-mono text-xs text-ink-900">{when.date}</div>
                  {when.time ? (
                    <div className="mt-0.5 font-mono text-[11px] text-ink-500">
                      {when.time}
                    </div>
                  ) : null}
                </div>

                {/* Where */}
                <div className="flex min-w-0 items-center gap-2 sm:w-40 sm:shrink-0">
                  {meeting.is_online ? (
                    <>
                      <Video className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      {meeting.meet_link ? (
                        <a
                          href={meeting.meet_link}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-xs text-ink-600 underline-offset-2 hover:text-ink-900 hover:underline"
                        >
                          Join link
                        </a>
                      ) : (
                        <span className="truncate text-xs text-ink-500">Online</span>
                      )}
                    </>
                  ) : (
                    <>
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                      <span className="truncate text-xs text-ink-500">In person</span>
                    </>
                  )}
                </div>

                <div className="shrink-0">
                  <Pill tone={STATUS_TONE[meeting.status]}>
                    {meeting.status.toUpperCase()}
                  </Pill>
                </div>
              </div>
            )
          })}
        </Panel>
      )}
    </>
  )
}

export default function AdminMeetingsPage() {
  return (
    <AdminFrame section="meetings" badge="MEETINGS" loadingLabel="Loading meetings">
      {(company) => <MeetingsList company={company} />}
    </AdminFrame>
  )
}
