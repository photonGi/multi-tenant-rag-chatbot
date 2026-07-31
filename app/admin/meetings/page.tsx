'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, MapPin, RefreshCw, Video } from 'lucide-react'

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
import { describeError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'

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
  meet_link: string | null
  status: 'booked' | 'cancelled' | 'completed'
  created_at: string
}

const MEETING_COLUMNS =
  'id, memory_key, lead_name, lead_email, starts_at, ends_at, timezone, is_online, meet_link, status, created_at'

const STATUS_TONE = {
  booked: 'success',
  completed: 'neutral',
  cancelled: 'alert',
} as const

/**
 * Renders the instant in the meeting's own zone rather than the viewer's.
 *
 * "3:00 PM" means nothing without saying whose afternoon it is, and an owner
 * looking at a booking made by a lead in another country needs the lead's
 * time — that is the one the confirmation email quoted.
 */
function formatWhen(meeting: Meeting): { date: string; time: string } {
  if (!meeting.starts_at) return { date: '—', time: '' }

  const starts = new Date(meeting.starts_at)
  if (Number.isNaN(starts.getTime())) return { date: '—', time: '' }

  // An unrecognised zone name would otherwise throw and take the page with it.
  let zone: string | undefined = meeting.timezone ?? undefined
  try {
    if (zone) new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(starts)
  } catch {
    zone = undefined
  }

  const date = starts.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: zone,
  })

  const start = starts.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  })

  const ends = meeting.ends_at ? new Date(meeting.ends_at) : null
  const end =
    ends && !Number.isNaN(ends.getTime())
      ? ends.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: zone,
        })
      : null

  const suffix = zone ? ` ${zone}` : ''

  return { date, time: end ? `${start} – ${end}${suffix}` : `${start}${suffix}` }
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
            const when = formatWhen(meeting)

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
