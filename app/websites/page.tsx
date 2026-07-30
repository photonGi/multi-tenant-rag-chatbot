'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Globe, Plus, RefreshCw, X } from 'lucide-react'

import { ConsoleLoading, ConsoleShell } from '@/components/cerebros/console-shell'
import {
  Alert,
  Btn,
  EmptyState,
  Label,
  Panel,
  PageHeading,
  SectionTitle,
  TextInput,
} from '@/components/cerebros/ui'
import { publicChatPath } from '@/lib/chat/link'
import { describeError } from '@/lib/errors'
import { n8nClient } from '@/lib/n8n/client'
import { createClient } from '@/lib/supabase/client'
import { generatePublicKey } from '@/lib/widget/keys'
import { deriveAllowedOrigins, normalizeOrigin } from '@/lib/widget/origins'
import { DEFAULT_THEME, serializeTheme } from '@/lib/widget/theme'

import { SiteCard } from './site-card'
import type { WidgetSite } from './types'

interface Company {
  id: string
  name: string
  api_key: string
}

const SITE_COLUMNS =
  'id, company_id, name, public_key, allowed_origins, pending_origins, theme, status, verified_at, last_seen_at, last_seen_origin, load_count, message_count, created_at, updated_at'

/** How often to re-check while a site is waiting for its first page load. */
const PENDING_POLL_MS = 6000

function WebsitesPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('company_id')
  const supabase = useMemo(() => createClient(), [])

  const [company, setCompany] = useState<Company | null>(null)
  const [sites, setSites] = useState<WidgetSite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  // Only known in the browser, and it is the correct value: the dashboard is
  // served from the same deployment the snippet will point at.
  const [appUrl, setAppUrl] = useState('')
  useEffect(() => setAppUrl(window.location.origin), [])

  const loadSites = useCallback(async () => {
    if (!companyId) return

    const { data, error: sitesError } = await supabase
      .from('widget_sites')
      .select(SITE_COLUMNS)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })

    if (sitesError) {
      console.error('Error loading websites:', describeError(sitesError))
      setError('Failed to load websites')
      return
    }

    setSites((data ?? []) as WidgetSite[])
  }, [companyId, supabase])

  useEffect(() => {
    const load = async () => {
      if (!companyId) {
        router.push('/')
        return
      }

      const { data: companyData, error: companyError } = await supabase
        .from('companies')
        .select('id, name, api_key')
        .eq('id', companyId)
        .single()

      if (companyError || !companyData) {
        router.push('/')
        return
      }

      setCompany(companyData)
      await loadSites()
      setLoading(false)
    }

    load()
  }, [companyId, loadSites, router, supabase])

  // The install verifies itself, so the dashboard has to notice on its own —
  // asking someone to refresh the page to see whether their paste worked is
  // the exact friction this feature exists to remove. Polling stops as soon as
  // nothing is pending.
  const hasPending = sites.some((site) => site.status === 'pending')
  useEffect(() => {
    if (!hasPending) return

    const timer = setInterval(loadSites, PENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [hasPending, loadSites])

  const patchSite = useCallback(
    async (id: string, patch: Partial<WidgetSite>) => {
      // Optimistic: every one of these is a small toggle, and waiting on a
      // round trip to see a switch move makes the console feel broken.
      setSites((current) =>
        current.map((site) => (site.id === id ? { ...site, ...patch } : site)),
      )

      const { error: updateError } = await supabase
        .from('widget_sites')
        .update(patch)
        .eq('id', id)

      if (updateError) {
        console.error('Error updating website:', describeError(updateError))
        setError('Failed to save that change')
        await loadSites()
      }
    },
    [loadSites, supabase],
  )

  const deleteSite = useCallback(
    async (site: WidgetSite) => {
      if (
        !confirm(
          `Delete "${site.name}"?\n\nThe widget will stop working on that site immediately, and its key cannot be recovered. The workspace and its documents are not affected.`,
        )
      ) {
        return
      }

      const { error: deleteError } = await supabase
        .from('widget_sites')
        .delete()
        .eq('id', site.id)

      if (deleteError) {
        console.error('Error deleting website:', describeError(deleteError))
        setError('Failed to delete that website')
        return
      }

      setSites((current) => current.filter((entry) => entry.id !== site.id))
    },
    [supabase],
  )

  if (loading || !company) return <ConsoleLoading label="Loading websites" />

  return (
    <ConsoleShell
      active="websites"
      companyId={companyId}
      chatHref={publicChatPath(company.api_key, company.name)}
      eyebrow={company.name}
      badge="WEBSITES"
      meta={<span>{sites.length} EMBEDDED</span>}
      actions={
        <Link
          href="/"
          className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-600 shadow-soft transition-all hover:border-ink-300 hover:text-ink-900 hover:shadow-elevated"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-4xl animate-fade-in space-y-6 p-4 pb-12 sm:p-6 md:p-10 md:pb-20">
        <PageHeading
          title="Websites"
          subtitle="Embed this workspace's assistant as a chat widget. One snippet, any stack."
        >
          <Btn variant="outline" onClick={loadSites} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Btn>
          <Btn onClick={() => setAdding((current) => !current)}>
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {adding ? 'Cancel' : 'Add website'}
          </Btn>
        </PageHeading>

        {error ? <Alert>{error}</Alert> : null}

        {adding ? (
          <AddWebsiteForm
            company={company}
            existing={sites}
            onCancel={() => setAdding(false)}
            onCreated={async () => {
              setAdding(false)
              await loadSites()
            }}
            onError={setError}
          />
        ) : null}

        {sites.length === 0 && !adding ? (
          <EmptyState
            icon={<Globe className="h-10 w-10" />}
            title="No websites yet"
            hint="Add a website to get a snippet you can paste into any stack."
          >
            <Btn onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add your first website
            </Btn>
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {sites.map((site) => (
              <SiteCard
                key={site.id}
                site={site}
                appUrl={appUrl}
                onPatch={patchSite}
                onDelete={deleteSite}
              />
            ))}
          </div>
        )}
      </div>
    </ConsoleShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AddWebsiteForm({
  company,
  existing,
  onCancel,
  onCreated,
  onError,
}: Readonly<{
  company: Company
  existing: WidgetSite[]
  onCancel: () => void
  onCreated: () => Promise<void>
  onError: (message: string) => void
}>) {
  const supabase = useMemo(() => createClient(), [])
  const [domain, setDomain] = useState('')
  const [name, setName] = useState('')
  const [seed, setSeed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState('')

  // Whether the owner has typed their own label. Until they do, the name
  // tracks the domain — one less field to fill in for the common case.
  const nameTouched = useRef(false)

  const origins = useMemo(() => deriveAllowedOrigins(domain), [domain])

  const handleDomainChange = (value: string) => {
    setDomain(value)
    setFieldError('')
    if (!nameTouched.current) {
      const normalized = normalizeOrigin(value)
      setName(normalized ? new URL(normalized).host : '')
    }
  }

  const submit = async () => {
    if (origins.length === 0) {
      setFieldError('Enter a domain, for example shop.example.com')
      return
    }

    const duplicate = existing.find((site) =>
      site.allowed_origins.some((origin) => origins.includes(origin)),
    )
    if (duplicate) {
      setFieldError(`"${duplicate.name}" already covers that origin.`)
      return
    }

    setBusy(true)
    try {
      const { error: insertError } = await supabase.from('widget_sites').insert({
        company_id: company.id,
        name: name.trim() || origins[0],
        public_key: generatePublicKey(),
        allowed_origins: origins,
        theme: serializeTheme(DEFAULT_THEME),
      })

      if (insertError) throw insertError

      // Seeding is best-effort and deliberately not allowed to fail the
      // creation — the widget works regardless of whether the crawl lands, and
      // a workflow hiccup should not cost the owner the site they just made.
      if (seed) {
        try {
          await n8nClient.uploadDocument({
            api_key: company.api_key,
            source_name: origins[0]!,
            label: name.trim() || origins[0]!,
            source: { kind: 'url', url: origins[0]! },
          })
        } catch (seedError) {
          console.error('Seed crawl failed:', describeError(seedError))
          onError(
            'Website added, but the initial crawl did not start. You can add it from Documents.',
          )
        }
      }

      await onCreated()
    } catch (err) {
      console.error('Error creating website:', describeError(err))
      onError('Failed to add that website')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel className="space-y-4 p-5 sm:p-6">
      <SectionTitle>Add a website</SectionTitle>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="widget-domain">Website address</Label>
          <TextInput
            id="widget-domain"
            autoFocus
            value={domain}
            placeholder="shop.example.com"
            onChange={(event) => handleDomainChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
          />
        </div>

        <div>
          <Label htmlFor="widget-name">Label</Label>
          <TextInput
            id="widget-name"
            value={name}
            placeholder="Marketing site"
            onChange={(event) => {
              nameTouched.current = true
              setName(event.target.value)
            }}
          />
        </div>
      </div>

      {origins.length > 0 ? (
        <div className="rounded-lg border border-border bg-ink-50 px-3 py-2.5">
          <span className="font-mono text-[10px] tracking-wider text-ink-400 uppercase">
            Allowed origins
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {origins.map((origin) => (
              <code
                key={origin}
                className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-700"
              >
                {origin}
              </code>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            The www and apex forms are different origins to a browser but the same
            site to a person, so both are added. You can add staging domains later.
          </p>
        </div>
      ) : null}

      <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-ink-600">
        <input
          type="checkbox"
          checked={seed}
          onChange={(event) => setSeed(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-ink-900"
        />
        <span>
          Crawl this site to seed the assistant
          <span className="mt-0.5 block text-ink-400">
            Indexes the page content now, so the widget can answer about the site from
            the moment it goes live.
          </span>
        </span>
      </label>

      {fieldError ? <p className="text-xs text-alert">{fieldError}</p> : null}

      <div className="flex items-center gap-2 border-t border-border/60 pt-4">
        <Btn disabled={busy || !domain.trim()} onClick={submit}>
          {busy ? 'Adding…' : 'Add website'}
        </Btn>
        <Btn variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </Panel>
  )
}

export default function WebsitesPage() {
  return (
    <Suspense fallback={<ConsoleLoading label="Loading websites" />}>
      <WebsitesPageContent />
    </Suspense>
  )
}
