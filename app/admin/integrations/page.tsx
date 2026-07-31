'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CalendarDays,
  Check,
  Link2Off,
  Loader2,
  Mail,
  Plug,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'

import {
  Alert,
  Btn,
  Panel,
  PageHeading,
  Pill,
  SectionTitle,
  btnClass,
} from '@/components/console/ui'
import { AdminFrame, AdminTabs, type AdminCompany } from '@/app/admin/admin-frame'
import { adminPath, type IntegrationResultReason } from '@/lib/admin/routes'
import { describeError } from '@/lib/errors'
import {
  CONNECTION_PUBLIC_COLUMNS,
  type PublicConnection,
} from '@/lib/google/connection-shape'
import { createClient } from '@/lib/supabase/client'

/**
 * The Google connection, as the workspace owner sees it.
 *
 * Connecting is a full-page navigation to /api/auth/google/connect rather than
 * a fetch: the flow ends on Google's own domain, and an XHR cannot take a
 * person to a consent screen. Disconnecting is a POST, because it needs the
 * server to revoke the grant with Google and to reach the encrypted token —
 * neither of which a browser can do.
 */

/** What each redirect flag means, written here rather than passed through a URL. */
const FAILURE_MESSAGES: Record<IntegrationResultReason, string> = {
  denied: 'Google access was not granted. Nothing has changed.',
  config:
    'This deployment is missing its Google credentials or its token encryption key. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.',
  exchange:
    'Google rejected the connection attempt. Check that the redirect URI in the Google Cloud console matches this deployment exactly, then try again.',
  store: 'The connection could not be stored. Try connecting again.',
  forbidden:
    'That connection attempt was started by a different session. Sign in as the workspace owner and try again.',
  unknown: 'The connection could not be completed. Try again.',
}

const SCOPE_SUMMARY = [
  {
    icon: CalendarDays,
    title: 'Create calendar events',
    detail:
      'calendar.events — books the meeting on the connected calendar. It cannot delete or create calendars.',
  },
  {
    icon: Mail,
    title: 'Send confirmation email',
    detail:
      'gmail.send — sends the confirmation from the connected mailbox. Send only: it cannot read a single message.',
  },
]

type Notice =
  | { tone: 'success'; message: string }
  | { tone: 'alert'; message: string }

function StatusPill({ status }: { status: PublicConnection['status'] | 'none' }) {
  if (status === 'connected') return <Pill tone="success">CONNECTED</Pill>
  if (status === 'error') return <Pill tone="alert">NEEDS ATTENTION</Pill>
  return <Pill>NOT CONNECTED</Pill>
}

function GoogleIntegration({ company }: { company: AdminCompany }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const [connection, setConnection] = useState<PublicConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState('')

  const loadConnection = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('oauth_connections')
      .select(CONNECTION_PUBLIC_COLUMNS)
      .eq('company_id', company.id)
      .eq('provider', 'google')
      .maybeSingle<PublicConnection>()

    if (loadError) {
      console.error('Error loading Google connection:', describeError(loadError))
      setError('Failed to load the integration status')
      return
    }

    setConnection(data)
  }, [company.id, supabase])

  useEffect(() => {
    loadConnection().finally(() => setLoading(false))
  }, [loadConnection])

  // The OAuth round trip reports back through the URL. Read it once, then strip
  // it — otherwise a refresh re-announces a connection that happened minutes
  // ago, and the browser's back button walks through stale banners.
  useEffect(() => {
    const result = searchParams.get('google')
    if (!result) return

    if (result === 'connected') {
      setNotice({ tone: 'success', message: 'Google account connected.' })
    } else if (result === 'disconnected') {
      setNotice({ tone: 'success', message: 'Google account disconnected.' })
    } else {
      const reason = (searchParams.get('reason') ?? 'unknown') as IntegrationResultReason
      setNotice({
        tone: 'alert',
        message: FAILURE_MESSAGES[reason] ?? FAILURE_MESSAGES.unknown,
      })
    }

    router.replace(adminPath('integrations', company.id), { scroll: false })
  }, [company.id, router, searchParams])

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect this Google account?\n\nThe assistant will stop booking meetings and sending confirmations until an account is connected again.',
      )
    ) {
      return
    }

    setDisconnecting(true)
    setError('')

    try {
      const response = await fetch('/api/admin/integrations/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: company.id }),
      })

      if (!response.ok) throw new Error(`Disconnect failed (${response.status})`)

      const body = (await response.json()) as { revoked_remotely?: boolean }

      await loadConnection()
      setNotice({
        tone: 'success',
        message: body.revoked_remotely
          ? 'Google account disconnected and access revoked with Google.'
          : 'Google account disconnected. Google had already dropped the grant, so there was nothing left to revoke.',
      })
    } catch (err) {
      console.error('Error disconnecting Google:', describeError(err))
      setError('Failed to disconnect the Google account')
    } finally {
      setDisconnecting(false)
    }
  }

  const status = connection?.status ?? 'none'
  const isConnected = status === 'connected'

  return (
    <>
      <PageHeading
        title="Integrations"
        subtitle="Connect the accounts the assistant books meetings and sends confirmations with."
      />

      <AdminTabs active="integrations" companyId={company.id} />

      {notice ? <Alert tone={notice.tone}>{notice.message}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      <Panel className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-ink-50 text-ink-600">
              <Plug className="h-4 w-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <SectionTitle>Google Calendar &amp; Gmail</SectionTitle>
                {loading ? <Pill>CHECKING…</Pill> : <StatusPill status={status} />}
              </div>
              <p className="mt-2 max-w-xl text-xs leading-relaxed text-ink-500">
                Lets the assistant book a meeting on your calendar and email the
                confirmation from your own address, so the lead hears from you rather
                than from an unfamiliar sender.
              </p>
            </div>
          </div>

          {!loading && isConnected ? (
            <Btn variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2Off className="h-4 w-4" />
              )}
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Btn>
          ) : null}

          {!loading && !isConnected ? (
            // A plain anchor, not a router push: the destination redirects off
            // this origin to Google's consent screen.
            <a
              href={`/api/auth/google/connect?company_id=${encodeURIComponent(company.id)}`}
              className={btnClass('primary', 'md')}
            >
              <Plug className="h-4 w-4" />
              {status === 'none' ? 'Connect Google' : 'Reconnect Google'}
            </a>
          ) : null}
        </div>

        {isConnected ? (
          <dl className="space-y-3 border-t border-border/60 pt-4 text-xs">
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-ink-500">Connected mailbox</dt>
              <dd className="font-mono break-all text-ink-900 sm:text-right">
                {connection?.connected_email ?? 'Unknown'}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-ink-500">Calendar</dt>
              <dd className="font-mono break-all text-ink-900 sm:text-right">
                {connection?.calendar_id ?? 'primary'}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-ink-500">Connected</dt>
              <dd className="font-mono text-ink-900 sm:text-right">
                {connection ? new Date(connection.created_at).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        ) : null}

        {status === 'error' ? (
          <div className="flex items-start gap-3 rounded-lg border border-alert/20 bg-alert/5 p-4 text-xs leading-relaxed text-ink-600">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-alert" />
            <span>
              Google refused to renew this connection the last time it was used.
              Reconnecting the account will fix it.
            </span>
          </div>
        ) : null}

        {status === 'revoked' ? (
          <div className="rounded-lg border border-border bg-ink-50 p-4 text-xs leading-relaxed text-ink-600">
            This workspace was connected to{' '}
            <span className="font-mono text-ink-900">
              {connection?.connected_email ?? 'a Google account'}
            </span>{' '}
            and has since been disconnected. Meetings already booked are unaffected.
          </div>
        ) : null}
      </Panel>

      {/* ── What is being granted ─────────────────────────────────────────── */}
      <Panel className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-ink-400" />
          <SectionTitle>What this grants</SectionTitle>
        </div>

        <ul className="mt-4 space-y-4">
          {SCOPE_SUMMARY.map(({ icon: Icon, title, detail }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-ink-100 text-ink-500">
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-ink-900">{title}</div>
                <p className="mt-1 text-xs leading-relaxed text-ink-500">{detail}</p>
              </div>
            </li>
          ))}
          <li className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand/10 text-brand">
              <Check className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink-900">Tokens are encrypted</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                The credentials Google issues are encrypted with a key held outside the
                database, so a copy of the database is not a copy of your mailbox. You
                can also revoke access at any time from your Google account&apos;s
                third-party access page.
              </p>
            </div>
          </li>
        </ul>
      </Panel>
    </>
  )
}

export default function AdminIntegrationsPage() {
  return (
    <AdminFrame section="integrations" badge="INTEGRATIONS" loadingLabel="Loading integrations">
      {(company) => <GoogleIntegration company={company} />}
    </AdminFrame>
  )
}
