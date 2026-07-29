'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CloudUpload, FileText, Loader2, Trash2 } from 'lucide-react'

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
  btnClass,
} from '@/components/cerebros/ui'
import { publicChatPath } from '@/lib/chat/link'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import { n8nClient } from '@/lib/n8n/client'
import { cn } from '@/lib/utils'

interface Company {
  id: string
  name: string
  api_key: string
}

interface DocumentRow {
  id: string
  label: string | null
  source_name: string
  preview: string | null
  chunk_count: number
  created_at: string
}

const ACCEPTED = '.txt,.pdf,.docx,.doc,.png,.jpg,.jpeg'

/**
 * Short excerpt shown in the documents list.
 *
 * Only text-like files are read here — calling .text() on a PDF or an image
 * yields raw bytes, which is what used to get stored as the preview.
 */
async function buildPreview(file: File): Promise<string | null> {
  const isTextual =
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    /\.(txt|md|csv|json)$/i.test(file.name)

  if (!isTextual) return null

  try {
    const text = await file.text()
    return text.slice(0, 200)
  } catch {
    return null
  }
}

function DocumentsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('company_id')
  const supabase = createClient()

  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

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

        const { data: docsData, error: docsError } = await supabase
          .from('documents')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })

        if (docsError) throw docsError
        setDocuments(docsData ?? [])
      } catch (err) {
        console.error('Error fetching data:', describeError(err))
        setError('Failed to load documents')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [companyId, router, supabase])

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!file || !label.trim() || !company) {
      setError('Select a file and enter a label')
      return
    }

    setUploading(true)
    setError('')
    setSuccess('')

    try {
      // Send the file itself to n8n, which extracts the text (PDFs go through
      // its PDF node). Reading it here would only work for plain text.
      const result = await n8nClient.uploadDocument({
        api_key: company.api_key,
        source_name: file.name,
        label: label.trim(),
        file,
      })

      const { error: insertError } = await supabase.from('documents').insert([
        {
          company_id: companyId,
          label: label.trim(),
          source_name: file.name,
          preview: await buildPreview(file),
          chunk_count: result.chunks_created ?? 0,
        },
      ])

      if (insertError) throw insertError

      setFile(null)
      setLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSuccess(`Indexed ${result.chunks_created ?? 0} chunks from ${file.name}`)

      const { data: updatedDocs } = await supabase
        .from('documents')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })

      setDocuments(updatedDocs ?? [])
      setTimeout(() => setSuccess(''), 4000)
    } catch (err) {
      console.error('Upload error:', describeError(err))
      setError(describeError(err))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document and its indexed chunks?')) return

    try {
      await supabase.from('document_chunks').delete().eq('document_id', docId)

      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId)

      if (deleteError) throw deleteError

      setDocuments((current) => current.filter((doc) => doc.id !== docId))
      setSuccess('Document deleted')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Delete error:', describeError(err))
      setError('Failed to delete document')
    }
  }

  if (loading) return <ConsoleLoading label="Loading documents" />

  const totalChunks = documents.reduce((sum, doc) => sum + (doc.chunk_count ?? 0), 0)

  return (
    <ConsoleShell
      active="documents"
      companyId={companyId}
      chatHref={company ? publicChatPath(company.api_key, company.name) : null}
      eyebrow={company?.name ?? 'Workspace'}
      badge="DOCUMENTS"
      meta={
        <>
          <span>{documents.length} DOCUMENTS</span>
          <span className="text-ink-300">•</span>
          <span>{totalChunks.toLocaleString()} CHUNKS INDEXED</span>
        </>
      }
      actions={
        <Link href="/" className={btnClass('outline', 'md')}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-6xl animate-fade-in space-y-6 p-4 pb-12 sm:space-y-8 sm:p-6 md:p-10 md:pb-20">
        <PageHeading
          title="Documents"
          subtitle="Ingestion and index coverage for this workspace."
        />

        {error ? <Alert>{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}

        {/* ── Index coverage ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
          <Panel className="p-5">
            <SectionTitle className="text-ink-500">Documents</SectionTitle>
            <div className="mt-2 text-3xl font-light text-ink-900">
              {documents.length}
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionTitle className="text-ink-500">Chunks Indexed</SectionTitle>
            <div className="mt-2 text-3xl font-light text-ink-900">
              {totalChunks.toLocaleString()}
            </div>
          </Panel>
          <Panel className="p-5">
            <SectionTitle className="text-ink-500">Embedding Model</SectionTitle>
            <div className="mt-2 font-mono text-sm text-ink-900">MiniLM-L6</div>
            <div className="mt-1 font-mono text-[10px] text-ink-400">384 DIMENSIONS</div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
          {/* ── Manual ingestion ──────────────────────────────────────────── */}
          <Panel className="flex flex-col p-5 sm:p-6 lg:col-span-5">
            <SectionTitle className="mb-4 text-ink-500">Manual Ingestion</SectionTitle>

            <form onSubmit={handleUpload} className="flex flex-1 flex-col gap-4">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  if (selected) {
                    setFile(selected)
                    setError('')
                  }
                }}
              />

              {/* A button, not a div: the zone has to be reachable and
                  operable by keyboard, not only by pointer. */}
              <button
                type="button"
                disabled={uploading}
                aria-label={file ? `Replace ${file.name}` : 'Choose a file to ingest'}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  if (uploading) return

                  const dropped = event.dataTransfer.files?.[0]
                  if (dropped) {
                    setFile(dropped)
                    setError('')
                  }
                }}
                className={cn(
                  'upload-zone flex w-full flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-all outline-none',
                  'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30',
                  dragging ? 'border-brand bg-brand/5' : 'border-border',
                  uploading && 'pointer-events-none opacity-60',
                )}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mb-3 h-5 w-5 animate-spin text-brand" />
                    <p className="font-mono text-xs text-ink-500">
                      CHUNKING &amp; EMBEDDING…
                    </p>
                  </>
                ) : file ? (
                  <>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
                      <FileText className="h-5 w-5" />
                    </div>
                    <p className="max-w-full truncate text-sm font-medium text-ink-900">
                      {file.name}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-ink-400">
                      {(file.size / 1024).toFixed(0)} KB • CLICK TO REPLACE
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-ink-50 text-ink-400">
                      <CloudUpload className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-medium text-ink-900">
                      Drag &amp; drop a file or browse
                    </p>
                    <p className="mt-1 text-xs text-ink-400">PDF, DOCX, TXT, PNG, JPG</p>
                  </>
                )}
              </button>

              <div>
                <Label htmlFor="document-label">Label</Label>
                <TextInput
                  id="document-label"
                  type="text"
                  placeholder="e.g. Handbook, Pricing, FAQ"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  disabled={uploading}
                />
              </div>

              <Btn type="submit" disabled={uploading || !file || !label.trim()} size="lg">
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ingesting…
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-4 w-4" />
                    Ingest &amp; Embed
                  </>
                )}
              </Btn>
            </form>
          </Panel>

          {/* ── Indexed documents ─────────────────────────────────────────── */}
          <div className="space-y-3 lg:col-span-7">
            <SectionTitle className="text-ink-500">
              Indexed Documents ({documents.length})
            </SectionTitle>

            {documents.length === 0 ? (
              <EmptyState
                icon={<FileText className="h-10 w-10" />}
                title="Nothing indexed yet."
                hint="Upload a document to build this workspace's index."
              />
            ) : (
              <div className="space-y-3">
                {documents.map((doc) => (
                  <Panel
                    key={doc.id}
                    className="group p-4 transition-all hover:border-ink-300 hover:shadow-elevated"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-ink-50 text-ink-400">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-medium text-ink-900">
                            {doc.source_name}
                          </h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-400">
                            {doc.label ? (
                              <span className="rounded border border-border bg-ink-50 px-1.5 py-0.5">
                                {doc.label.toUpperCase()}
                              </span>
                            ) : null}
                            <span>{doc.chunk_count} CHUNKS</span>
                            <span className="text-ink-300">•</span>
                            <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                          </div>
                          {doc.preview ? (
                            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-500">
                              {doc.preview}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        aria-label={`Delete ${doc.source_name}`}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-alert/10 hover:text-alert focus-visible:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Panel>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ConsoleShell>
  )
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<ConsoleLoading label="Loading documents" />}>
      <DocumentsPageContent />
    </Suspense>
  )
}
