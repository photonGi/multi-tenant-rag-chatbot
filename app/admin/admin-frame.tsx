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
  type LucideIcon,
} from 'lucide-react'

import { ConsoleLoading, ConsoleShell } from '@/components/console/console-shell'
import { btnClass } from '@/components/console/ui'
import { adminPath, type AdminSection } from '@/lib/admin/routes'
import { publicChatPath } from '@/lib/chat/link'
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

  useEffect(() => {
    const load = async () => {
      if (!companyId) {
        router.push('/')
        return
      }

      // RLS answers the ownership question: a workspace this session does not
      // own comes back empty, which is the same outcome as one that does not
      // exist — and the same redirect.
      const { data } = await supabase
        .from('companies')
        .select('id, name, api_key')
        .eq('id', companyId)
        .maybeSingle<AdminCompany>()

      if (!data) {
        router.push('/')
        return
      }

      setCompany(data)
    }

    load()
  }, [companyId, router, supabase])

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
