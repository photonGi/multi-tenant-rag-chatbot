'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CloudUpload,
  FileText,
  Globe,
  Loader2,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react'

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
import { n8nClient, type IngestSource } from '@/lib/n8n/client'
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

/** A file is one way to give a workspace context, not the only one. */
type SourceMode = 'file' | 'text' | 'url'

type Submission =
  | { ok: true; source_name: string; source: IngestSource; preview: string | null }
  | { ok: false; error: string }

const SOURCE_MODES: { id: SourceMode; label: string; icon: LucideIcon }[] = [
  { id: 'file', label: 'File', icon: CloudUpload },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'url', label: 'Website', icon: Globe },
]

/**
 * Accepts what someone would actually paste — with or without a scheme — and
 * normalises it so the workflow always receives an absolute URL.
 * Returns null when it could not be one.
 */
function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(candidate)
    // A hostname with no dot is a typo, not a site.
    if (!parsed.hostname.includes('.')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

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
  // Reading a page happens before anything reaches n8n and can take seconds, so
  // it gets its own stage rather than leaving the form looking frozen.
  const [stage, setStage] = useState<'idle' | 'reading' | 'ingesting'>('idle')
  const [mode, setMode] = useState<SourceMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
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

  /**
   * Turns the active mode into what n8n receives and what the documents row
   * records.
   *
   * source_name is what identifies a document for deletion — chunks are matched
   * on (company_id, source_name) — so each mode has to produce something stable
   * and reasonably distinct: the filename, the URL, or the label the person
   * chose for their text.
   */
  const buildSubmission = async (trimmedLabel: string): Promise<Submission> => {
    if (mode === 'file') {
      if (!file) return { ok: false, error: 'Choose a file to ingest' }
      return {
        ok: true,
        source_name: file.name,
        source: { kind: 'file', file },
        preview: await buildPreview(file),
      }
    }

    if (mode === 'text') {
      const content = text.trim()
      if (!content) return { ok: false, error: 'Paste the text you want indexed' }
      return {
        ok: true,
        source_name: trimmedLabel,
        source: { kind: 'text', content },
        preview: content.slice(0, 200),
      }
    }

    const normalised = normaliseUrl(url)
    if (!normalised) return { ok: false, error: 'Enter a valid website address' }

    // The workflow ingests text and files, not addresses, and the browser
    // cannot fetch a third-party page itself (CORS). The server route reads it
    // and hands back the readable text.
    const response = await fetch('/api/extract-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: normalised }),
    })

    const extracted = (await response.json()) as {
      text?: string
      title?: string | null
      error?: string
    }

    if (!response.ok || !extracted.text) {
      return { ok: false, error: extracted.error ?? 'That page could not be read.' }
    }

    return {
      ok: true,
      source_name: normalised,
      source: { kind: 'url', url: normalised, content: extracted.text },
      preview: extracted.title
        ? `${extracted.title} — ${extracted.text.slice(0, 160)}`
        : extracted.text.slice(0, 200),
    }
  }

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault()

    const trimmedLabel = label.trim()
    if (!trimmedLabel || !company) {
      setError('Enter a label for this source')
      return
    }

    setError('')
    setSuccess('')

    // Reading the page is a real round trip, so the form locks before it runs.
    setStage(mode === 'url' ? 'reading' : 'ingesting')

    const submission = await buildSubmission(trimmedLabel)
    if (!submission.ok) {
      setError(submission.error)
      setStage('idle')
      return
    }

    setStage('ingesting')

    try {
      // Files go to n8n intact so its own extraction nodes handle them (PDFs in
      // particular); text and URLs travel as plain fields.
      const result = await n8nClient.uploadDocument({
        api_key: company.api_key,
        source_name: submission.source_name,
        label: trimmedLabel,
        source: submission.source,
      })

      const { error: insertError } = await supabase.from('documents').insert([
        {
          company_id: companyId,
          label: trimmedLabel,
          source_name: submission.source_name,
          preview: submission.preview,
          chunk_count: result.chunks_created ?? 0,
        },
      ])

      if (insertError) throw insertError

      setFile(null)
      setText('')
      setUrl('')
      setLabel('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSuccess(
        `Indexed ${result.chunks_created ?? 0} chunks from ${submission.source_name}`,
      )

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
      setStage('idle')
    }
  }

  /**
   * Removes a document and the chunks it put in the index.
   *
   * Chunks are matched on (company_id, source_name) — the pair
   * idx_chunks_company_source exists for — not on document_id. The n8n ingest
   * workflow writes the chunks and only ever receives the api key, source name
   * and label, so it leaves document_id NULL; filtering on it matched nothing
   * and every delete silently orphaned the whole set.
   *
   * That mattered because match_documents() filters on company_id alone, so
   * orphaned chunks stayed retrievable and a deleted document kept answering
   * questions. Deleting the documents row afterwards also cascades to any chunk
   * that does carry a document_id.
   */
  const handleDelete = async (doc: DocumentRow) => {
    if (!companyId) return
    if (
      !confirm(`Delete "${doc.source_name}" and remove its chunks from the index?`)
    ) {
      return
    }

    try {
      const { data: removedChunks, error: chunkError } = await supabase
        .from('document_chunks')
        .delete()
        .eq('company_id', companyId)
        .eq('source_name', doc.source_name)
        .select('id')

      if (chunkError) throw chunkError

      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', doc.id)

      if (deleteError) throw deleteError

      setDocuments((current) => current.filter((item) => item.id !== doc.id))
      setSuccess(
        `Deleted ${doc.source_name} — ${removedChunks?.length ?? 0} chunks removed from the index`,
      )
      setTimeout(() => setSuccess(''), 4000)
    } catch (err) {
      console.error('Delete error:', describeError(err))
      setError(describeError(err))
    }
  }

  if (loading) return <ConsoleLoading label="Loading documents" />

  const totalChunks = documents.reduce((sum, doc) => sum + (doc.chunk_count ?? 0), 0)

  const uploading = stage !== 'idle'
  const modeHasInput =
    (mode === 'file' && file !== null) ||
    (mode === 'text' && text.trim().length > 0) ||
    (mode === 'url' && url.trim().length > 0)
  const hasSource = modeHasInput && label.trim().length > 0

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
            <SectionTitle className="mb-4 text-ink-500">Add Context</SectionTitle>

            {/* Three equal ways in — a file is not required. */}
            <div
              role="tablist"
              aria-label="Context source"
              className="mb-4 flex gap-1 rounded-lg border border-border bg-ink-50 p-1"
            >
              {SOURCE_MODES.map(({ id, label: modeLabel, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={mode === id}
                  disabled={uploading}
                  onClick={() => {
                    setMode(id)
                    setError('')
                  }}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-2 text-xs font-medium transition-all disabled:opacity-50',
                    mode === id
                      ? 'bg-surface text-ink-900 shadow-soft'
                      : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {modeLabel}
                </button>
              ))}
            </div>

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
                hidden={mode !== 'file'}
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
                  'upload-zone w-full flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-all outline-none',
                  // `hidden` sets display:none; this only re-enables the flex
                  // layout for the mode that is actually showing.
                  mode === 'file' && 'flex',
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

              {mode === 'text' ? (
                <div className="flex flex-1 flex-col">
                  <Label htmlFor="context-text">Text</Label>
                  <textarea
                    id="context-text"
                    value={text}
                    disabled={uploading}
                    placeholder="Paste anything the assistant should know — policies, notes, FAQs, product details…"
                    onChange={(event) => setText(event.target.value)}
                    className="min-h-44 flex-1 resize-y rounded-lg border border-border bg-surface px-3.5 py-3 text-base leading-relaxed font-light text-ink-900 shadow-soft transition-all outline-none placeholder:text-ink-400 focus:border-ink-300 focus:ring-1 focus:ring-ink-200 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60 sm:text-sm"
                  />
                  <p className="mt-2 font-mono text-[10px] text-ink-400">
                    {text.trim().length.toLocaleString()} CHARACTERS
                  </p>
                </div>
              ) : null}

              {mode === 'url' ? (
                <div className="flex flex-1 flex-col">
                  <Label htmlFor="context-url">Website Address</Label>
                  <TextInput
                    id="context-url"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="example.com/about"
                    value={url}
                    disabled={uploading}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                    The workflow fetches the page and indexes its text. One page per
                    entry — it does not follow links.
                  </p>
                </div>
              ) : null}

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

              <Btn type="submit" disabled={uploading || !hasSource} size="lg">
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {stage === 'reading' ? 'Reading page…' : 'Ingesting…'}
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

                      {/* Always visible, not hover-revealed: there is no hover
                          on touch, and this is the only way to remove a
                          document. */}
                      <button
                        type="button"
                        onClick={() => handleDelete(doc)}
                        aria-label={`Delete ${doc.source_name}`}
                        className="-m-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-300 transition-all hover:bg-alert/10 hover:text-alert active:bg-alert/10"
                      >
                        <Trash2 className="h-4 w-4" />
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
