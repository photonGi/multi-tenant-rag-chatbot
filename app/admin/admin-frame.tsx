'use client'

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  CalendarClock,
  Mail,
  Plug,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'

import { ConsoleLoading, ConsoleShell } from '@/components/console/console-shell'
import { btnClass } from '@/components/console/ui'
import { adminPath, type AdminSection } from '@/lib/admin/routes'
import { publicChatPath } from '@/lib/chat/link'
import { describeError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

/**
 * Admin is one rail destination with four pages behind it.
 *
 * They did not become four rail icons: the rail is the top-level switcher, and
 * eight entries in a 64px column — or eight in a phone's bottom bar — is how
 * that stops being scannable. Workspace-level settings that are visited rarely
 * belong one level down, so they are tabs inside Admin instead.
 *
 * This frame carries what all four pages need identically — the workspace
 * lookup, the redirect when there is no workspace to show, the shell and the
 * tab strip — so each page is only its own content.
 */

export interface AdminCompany {
  id: string
  name: string
  api_key: string
  /** null follows the viewer's browser. See lib/time/zones.ts. */
  display_timezone: string | null
}

const TABS: { id: AdminSection; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: SlidersHorizontal },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'templates', label: 'Email Templates', icon: Mail },
  { id: 'meetings', label: 'Meetings', icon: CalendarClock },
]

export function AdminTabs({
  active,
  companyId,
}: {
  active: AdminSection
  companyId: string
}) {
  return (
    // Scrolls rather than wraps on a phone: four tabs on one line stay a single
    // horizontal gesture, where a wrapped second row reads as a new section.
    <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map(({ id, label, icon: Icon }) => (
        <Link
          key={id}
          href={adminPath(id, companyId)}
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap transition-all duration-200',
            active === id
              ? 'border-ink-900 bg-ink-900 text-white shadow-sm'
              : 'border-border bg-surface text-ink-500 shadow-soft hover:border-ink-300 hover:text-ink-900',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Link>
      ))}
    </div>
  )
}

/**
 * Shown when the workspace lookup itself failed.
 *
 * States the cause rather than redirecting, because every realistic reason —
 * an unapplied migration, a dropped connection, a broken RLS policy — is
 * something the owner can only act on if they can see it.
 */
function AdminLoadFailure({ message }: Readonly<{ message: string }>) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-xl border border-alert/20 bg-surface p-6 shadow-elevated">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 shrink-0 text-alert" />
          <h2 className="text-sm font-semibold text-ink-900">
            Could not load this workspace
          </h2>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          The workspace query failed. If this followed a deploy, a database
          migration in <code className="font-mono text-ink-700">scripts/</code> is
          probably not applied yet.
        </p>

        <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-ink-50 p-3 font-mono text-[11px] wrap-break-word whitespace-pre-wrap text-ink-600">
          {message}
        </pre>

        <Link href="/" className={cn(btnClass('outline', 'md'), 'mt-4')}>
          <ArrowLeft className="h-4 w-4" />
          Back to workspaces
        </Link>
      </div>
    </div>
  )
}

function AdminFrameInner({
  section,
  badge,
  loadingLabel,
  children,
}: {
  section: AdminSection
  badge: string
  loadingLabel: string
  children: (company: AdminCompany) => ReactNode
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('company_id')
  const supabase = useMemo(() => createClient(), [])

  const [company, setCompany] = useState<AdminCompany | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!companyId) {
        router.push('/')
        return
      }

      // RLS answers the ownership question: a workspace this session does not
      // own comes back empty, which is the same outcome as one that does not
      // exist — and the same redirect.
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, api_key, display_timezone')
        .eq('id', companyId)
        .maybeSingle<AdminCompany>()

      // A failed *query* is not a missing workspace, and must not be reported
      // as one. Bouncing to Workspaces on a PostgREST 400 — an unapplied
      // migration, say — hides the only useful information there is and sends
      // the owner looking in entirely the wrong place.
      if (error) {
        console.error('Error loading workspace:', describeError(error))
        setLoadError(describeError(error))
        return
      }

      if (!data) {
        router.push('/')
        return
      }

      setCompany(data)
    }

    load()
  }, [companyId, router, supabase])

  if (loadError) return <AdminLoadFailure message={loadError} />
  if (!company) return <ConsoleLoading label={loadingLabel} />

  return (
    <ConsoleShell
      active="admin"
      companyId={company.id}
      chatHref={publicChatPath(company.api_key, company.name)}
      eyebrow={company.name}
      badge={badge}
      meta={<span>WORKSPACE {company.id.slice(0, 8).toUpperCase()}</span>}
      actions={
        <Link href="/" className={btnClass('outline', 'md')}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-5xl animate-fade-in space-y-6 p-4 pb-12 sm:space-y-8 sm:p-6 md:p-10 md:pb-20">
        {children(company)}
      </div>
    </ConsoleShell>
  )
}

/**
 * The Suspense boundary has to sit *above* the component calling
 * useSearchParams, so the frame is split in two rather than wrapping itself.
 */
export function AdminFrame(props: {
  section: AdminSection
  badge: string
  loadingLabel: string
  children: (company: AdminCompany) => ReactNode
}) {
  return (
    <Suspense fallback={<ConsoleLoading label={props.loadingLabel} />}>
      <AdminFrameInner {...props} />
    </Suspense>
  )
}
