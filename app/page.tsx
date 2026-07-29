'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Blocks,
  Check,
  Database,
  Link2,
  MessageSquareText,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'

import { ConsoleLoading, ConsoleShell } from '@/components/cerebros/console-shell'
import {
  Alert,
  Btn,
  EmptyState,
  Panel,
  PageHeading,
  SectionTitle,
  btnClass,
} from '@/components/cerebros/ui'
import { publicChatPath, publicChatUrl } from '@/lib/chat/link'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'

interface Company {
  id: string
  name: string
  api_key: string
  created_at: string
  updated_at: string
}

export default function WorkspacesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<{ email?: string } | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        const authUser = authData?.user

        // Only a genuine auth failure sends the user to the login page.
        if (authError || !authUser) {
          router.push('/auth/login')
          return
        }

        setUser(authUser)

        const { data: companiesData, error: companiesError } = await supabase
          .from('companies')
          .select('*')
          .eq('owner_id', authUser.id)
          .order('created_at', { ascending: false })

        if (companiesError) {
          // A failed query is not an auth problem — show it instead of
          // silently bouncing the user back to login.
          console.error('Failed to load companies:', describeError(companiesError))
          setError(describeError(companiesError))
          return
        }

        setCompanies(companiesData ?? [])
        if (companiesData?.length) setSelectedId(companiesData[0].id)
      } catch (err) {
        console.error('Failed to load dashboard:', describeError(err))
        setError(describeError(err))
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [router, supabase])

  const selected = companies.find((company) => company.id === selectedId) ?? null

  const handleCopyChatLink = async () => {
    if (!selected) return

    try {
      await navigator.clipboard.writeText(publicChatUrl(selected.api_key, selected.name))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      setError(describeError(err))
    }
  }

  if (loading) return <ConsoleLoading label="Loading console" />

  return (
    <ConsoleShell
      active="workspaces"
      companyId={selected?.id}
      chatHref={selected ? publicChatPath(selected.api_key, selected.name) : null}
      eyebrow="RAG Console"
      badge="MULTI-TENANT"
      meta={
        <>
          <span>{companies.length}{companies.length==1?" WORKSPACE":" WORKSPACES"}</span>
          <span className="text-ink-300">•</span>
          <span className="truncate">{user?.email?.toUpperCase()}</span>
        </>
      }
      actions={
        <Link href="/dashboard/company/create" className={btnClass('primary', 'md')}>
          <Plus className="h-4 w-4" />
          New Workspace
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-6xl animate-fade-in space-y-6 p-4 pb-12 sm:space-y-8 sm:p-6 md:p-10 md:pb-20">
        {error ? <Alert>{error}</Alert> : null}

        {companies.length === 0 ? (
          <>
            <PageHeading
              title="Workspaces"
              subtitle="Each workspace is an isolated document index with its own key."
            />
            <EmptyState
              icon={<Blocks className="h-10 w-10" />}
              title="No workspaces yet."
              hint="Create one to start indexing documents."
            >
              <Link href="/dashboard/company/create" className={btnClass('primary', 'md')}>
                <Plus className="h-4 w-4" />
                Create Workspace
              </Link>
            </EmptyState>
          </>
        ) : (
          <>
            <PageHeading
              title="Workspaces"
              subtitle="Each workspace is an isolated document index with its own key."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {companies.map((company) => {
                const isSelected = company.id === selectedId

                return (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => setSelectedId(company.id)}
                    className={cn(
                      'rounded-xl border bg-surface p-5 text-left shadow-soft transition-all hover:shadow-elevated',
                      isSelected
                        ? 'border-ink-900/20 ring-1 ring-ink-900/10'
                        : 'border-border hover:border-ink-300',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="truncate text-sm font-semibold text-ink-900">
                        {company.name}
                      </h3>
                      {isSelected ? (
                        <span className="shrink-0 rounded border border-ink-200 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
                          ACTIVE
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 font-mono text-[10px] text-ink-400">
                      CREATED {new Date(company.created_at).toLocaleDateString()}
                    </p>
                  </button>
                )
              })}
            </div>

            {selected ? (
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
                <Panel className="space-y-5 p-5 sm:p-6 lg:col-span-7">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <SectionTitle>Workspace</SectionTitle>
                      <h3 className="mt-2 truncate text-lg font-semibold text-ink-900">
                        {selected.name}
                      </h3>
                    </div>
                    <span className="shrink-0 rounded border border-success/20 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] text-success">
                      LIVE
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4 border-t border-border/60 pt-5 sm:grid-cols-2">
                    <div>
                      <span className="block text-[10px] font-bold tracking-wider text-ink-400 uppercase">
                        Workspace ID
                      </span>
                      <span className="mt-1 block font-mono text-xs break-all text-ink-900">
                        {selected.id}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-bold tracking-wider text-ink-400 uppercase">
                        Created
                      </span>
                      <span className="mt-1 block font-mono text-xs text-ink-900">
                        {new Date(selected.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-border/60 pt-5">
                    <Link
                      href={`/documents?company_id=${selected.id}`}
                      className={btnClass('outline', 'md')}
                    >
                      <Database className="h-4 w-4" />
                      Documents
                    </Link>
                    <Link
                      href={`/admin?company_id=${selected.id}`}
                      className={btnClass('outline', 'md')}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      Admin
                    </Link>
                  </div>
                </Panel>

                {/* ── Share surface for the public chat module ────────────── */}
                <Panel className="space-y-5 p-5 sm:p-6 lg:col-span-5">
                  <div>
                    <SectionTitle>Public Chat Link</SectionTitle>
                    <p className="mt-2 text-xs leading-relaxed text-ink-500">
                      Anyone with this link can chat against this workspace without
                      signing in. Their history stays in their own browser.
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-ink-50 p-3">
                    <code className="block font-mono text-[11px] leading-relaxed break-all text-ink-600">
                      {publicChatPath(selected.api_key, selected.name)}
                    </code>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Btn variant="primary" onClick={handleCopyChatLink}>
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Link2 className="h-4 w-4" />
                      )}
                      {copied ? 'Copied' : 'Copy Link'}
                    </Btn>
                    <Link
                      href={publicChatPath(selected.api_key, selected.name)}
                      target="_blank"
                      rel="noreferrer"
                      className={btnClass('outline', 'md')}
                    >
                      <MessageSquareText className="h-4 w-4" />
                      Open Chat
                    </Link>
                  </div>

                  <p className="border-t border-border/60 pt-4 text-[11px] leading-relaxed text-ink-400">
                    The link carries this workspace&apos;s key. Regenerate it from Admin
                    to revoke every link already shared.
                  </p>
                </Panel>
              </div>
            ) : null}
          </>
        )}
      </div>
    </ConsoleShell>
  )
}
