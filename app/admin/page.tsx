'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  MessageSquareText,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'

import { ConsoleLoading, ConsoleShell } from '@/components/console/console-shell'
import {
  Alert,
  Btn,
  Panel,
  PageHeading,
  SectionTitle,
} from '@/components/console/ui'
import { publicChatPath, publicChatUrl } from '@/lib/chat/link'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import { generateApiKey } from '@/lib/api-key'

interface Company {
  id: string
  name: string
  api_key: string
  created_at: string
  updated_at: string
}

function AdminPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('company_id')
  const supabase = createClient()

  const [company, setCompany] = useState<Company | null>(null)
  const [stats, setStats] = useState({ documents: 0, chunks: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'key' | 'link' | null>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      if (!companyId) {
        router.push('/')
        return
      }

      try {
        const { data: companyData, error: companyError } = await supabase
          .from('companies')
          .select('*')
          .eq('id', companyId)
          .single()

        if (companyError || !companyData) {
          router.push('/')
          return
        }

        setCompany(companyData)

        const [{ count: docsCount }, { count: chunksCount }] = await Promise.all([
          supabase
            .from('documents')
            .select('*', { count: 'exact', head: true })
            .eq('company_id', companyId),
          supabase
            .from('document_chunks')
            .select('*', { count: 'exact', head: true })
            .eq('company_id', companyId),
        ])

        setStats({ documents: docsCount ?? 0, chunks: chunksCount ?? 0 })
      } catch (err) {
        console.error('Error fetching admin data:', describeError(err))
        setError('Failed to load admin data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [companyId, router, supabase])

  const copy = async (value: string, which: 'key' | 'link') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch (err) {
      setError(describeError(err))
    }
  }

  const handleRegenerate = async () => {
    if (
      !confirm(
        'Regenerate this workspace key?\n\nEvery public chat link already shared will stop working, and any integration using the current key will need updating.',
      )
    ) {
      return
    }

    try {
      const { data: updated, error: updateError } = await supabase
        .from('companies')
        .update({ api_key: generateApiKey() })
        .eq('id', companyId)
        .select()
        .single()

      if (updateError) throw updateError
      setCompany(updated)
    } catch (err) {
      console.error('Error regenerating API key:', describeError(err))
      setError('Failed to regenerate the workspace key')
    }
  }

  const handleDelete = async () => {
    if (
      !confirm(
        'Permanently delete this workspace and every document, chunk and conversation record it owns? This cannot be undone.',
      )
    ) {
      return
    }

    try {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .eq('company_id', companyId)

      for (const conversation of conversations ?? []) {
        await supabase.from('messages').delete().eq('conversation_id', conversation.id)
      }

      await supabase.from('conversations').delete().eq('company_id', companyId)
      await supabase.from('document_chunks').delete().eq('company_id', companyId)
      await supabase.from('documents').delete().eq('company_id', companyId)

      const { error: deleteError } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId)

      if (deleteError) throw deleteError

      router.push('/')
    } catch (err) {
      console.error('Error deleting company:', describeError(err))
      setError('Failed to delete the workspace')
    }
  }

  if (loading || !company) return <ConsoleLoading label="Loading admin" />

  const chatPath = publicChatPath(company.api_key, company.name)
  const maskedKey = `${company.api_key.slice(0, 8)}${'•'.repeat(24)}${company.api_key.slice(-4)}`

  return (
    <ConsoleShell
      active="admin"
      companyId={companyId}
      chatHref={chatPath}
      eyebrow={company.name}
      badge="ADMIN"
      meta={<span>WORKSPACE {company.id.slice(0, 8).toUpperCase()}</span>}
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
      <div className="mx-auto w-full max-w-5xl animate-fade-in space-y-6 p-4 pb-12 sm:space-y-8 sm:p-6 md:p-10 md:pb-20">
        <PageHeading
          title="Admin"
          subtitle="Key rotation, public access, and workspace lifecycle."
        />

        {error ? <Alert>{error}</Alert> : null}

        {/* ── Index health ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
          <Panel className="p-5">
            <SectionTitle className="text-ink-500">Documents</SectionTitle>
            <div className="mt-2 text-3xl font-light text-ink-900">
              {stats.documents}
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionTitle className="text-ink-500">Chunks Indexed</SectionTitle>
            <div className="mt-2 text-3xl font-light text-ink-900">
              {stats.chunks.toLocaleString()}
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionTitle className="text-ink-500">Public Chat</SectionTitle>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse-slow rounded-full bg-success" />
              <span className="font-mono text-sm text-ink-900">OPEN</span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-ink-400">NO SIGN-IN</div>
          </Panel>
        </div>

        {/* ── Public link ─────────────────────────────────────────────────── */}
        <Panel className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <SectionTitle>Public Chat Link</SectionTitle>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                Share this to let anyone chat against this workspace&apos;s documents.
                Each visitor&apos;s history is kept in their own browser, never on the
                server.
              </p>
            </div>
            <Link
              href={chatPath}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-600 shadow-soft transition-all hover:border-ink-300 hover:text-ink-900"
            >
              <MessageSquareText className="h-4 w-4" />
              Open
            </Link>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 rounded-lg border border-border bg-ink-50 p-3 font-mono text-[11px] break-all text-ink-600">
             {chatPath}
            </code>
            <Btn
              variant="outline"
              className="shrink-0"
              onClick={() => copy(publicChatUrl(company.api_key, company.name), 'link')}
            >
              {copied === 'link' ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {copied === 'link' ? 'Copied' : 'Copy'}
            </Btn>
          </div>
        </Panel>

        {/* ── Key management ──────────────────────────────────────────────── */}
        <Panel className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-ink-400" />
            <SectionTitle>Workspace Key</SectionTitle>
          </div>

          <div className="space-y-2">
            <code className="block rounded-lg border border-border bg-ink-50 p-3 font-mono text-xs break-all text-ink-900">
              {revealed ? company.api_key : maskedKey}
            </code>
            <div className="flex items-center gap-2">
              <Btn
                variant="outline"
                onClick={() => setRevealed((current) => !current)}
                aria-label={revealed ? 'Hide key' : 'Reveal key'}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {revealed ? 'Hide' : 'Reveal'}
              </Btn>
              <Btn variant="outline" onClick={() => copy(company.api_key, 'key')}>
                {copied === 'key' ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied === 'key' ? 'Copied' : 'Copy'}
              </Btn>
            </div>
          </div>

          <div className="border-t border-border/60 pt-4">
            <Btn variant="outline" onClick={handleRegenerate}>
              <RefreshCw className="h-4 w-4" />
              Regenerate Key
            </Btn>
          </div>
        </Panel>

        {/* ── Workspace record ────────────────────────────────────────────── */}
        <Panel className="p-5 sm:p-6">
          <SectionTitle>Workspace Record</SectionTitle>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex flex-col gap-1 border-b border-border/60 pb-3 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-ink-500">Workspace ID</dt>
              <dd className="font-mono break-all text-ink-900 sm:text-right">{company.id}</dd>
            </div>
            <div className="flex flex-col gap-1 border-b border-border/60 pb-3 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-ink-500">Created</dt>
              <dd className="font-mono text-ink-900 sm:text-right">
                {new Date(company.created_at).toLocaleString()}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-ink-500">Last Updated</dt>
              <dd className="font-mono text-ink-900 sm:text-right">
                {new Date(company.updated_at).toLocaleString()}
              </dd>
            </div>
          </dl>
        </Panel>

        {/* ── Danger zone ─────────────────────────────────────────────────── */}
        <Panel className="border-alert/20 bg-alert/2 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-alert" />
            <SectionTitle className="text-alert">Danger Zone</SectionTitle>
          </div>
          <p className="mt-3 mb-4 text-xs leading-relaxed text-ink-500">
            Permanently delete this workspace and everything indexed under it. This
            cannot be undone.
          </p>
          <Btn variant="danger" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
            Delete Workspace
          </Btn>
        </Panel>
      </div>
    </ConsoleShell>
  )
}

export default function AdminPage() {
  return (
    <Suspense fallback={<ConsoleLoading label="Loading admin" />}>
      <AdminPageContent />
    </Suspense>
  )
}
