'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import { n8nClient } from '@/lib/n8n/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Upload, Trash2, ArrowLeft, Loader } from 'lucide-react'

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

  const [documents, setDocuments] = useState<any[]>([])
  const [company, setCompany] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      if (!companyId) {
        router.push('/')
        return
      }

      try {
        // Get company
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

        // Get documents
        const { data: docsData, error: docsError } = await supabase
          .from('documents')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })

        if (docsError) throw docsError
        setDocuments(docsData || [])
      } catch (err) {
        console.error('Error fetching data:', describeError(err))
        setError('Failed to load documents')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [companyId, router, supabase])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError('')
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !label || !company) {
      setError('Please select a file and enter a label')
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
        label,
        file,
      })

      // Add document to database
      const { error: insertError } = await supabase.from('documents').insert([
        {
          company_id: companyId,
          label,
          source_name: file.name,
          preview: await buildPreview(file),
          chunk_count: result.chunks_created ?? 0,
        },
      ])

      if (insertError) throw insertError

      // Reset form
      setFile(null)
      setLabel('')
      setSuccess('Document uploaded successfully!')

      // Refresh documents
      const { data: updatedDocs } = await supabase
        .from('documents')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })

      setDocuments(updatedDocs || [])

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to upload document')
      console.error('Upload error:', describeError(err))
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return

    try {
      // Delete chunks first (cascade should handle it)
      await supabase.from('document_chunks').delete().eq('document_id', docId)

      // Delete document
      const { error } = await supabase.from('documents').delete().eq('id', docId)

      if (error) throw error

      setDocuments(documents.filter((doc) => doc.id !== docId))
      setSuccess('Document deleted successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      console.error('Delete error:', describeError(err))
      setError('Failed to delete document')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </Link>
              <h1 className="text-2xl font-bold text-foreground">
                {company?.name} - Documents
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Upload Form */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-bold text-foreground mb-4">Upload Document</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                File
              </label>
              <Input
                type="file"
                accept=".txt,.pdf,.docx,.doc,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                disabled={uploading}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Supported: PDF, DOCX, TXT, PNG, JPG
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Label
              </label>
              <Input
                type="text"
                placeholder="e.g., CV, Invoice, Document"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={uploading}
                className="w-full"
              />
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}
            {success && <div className="text-sm text-green-600">{success}</div>}

            <Button type="submit" disabled={uploading} className="w-full">
              {uploading ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
          </form>
        </Card>

        {/* Documents List */}
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4">
            Documents ({documents.length})
          </h2>

          {documents.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-muted-foreground">No documents uploaded yet</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <Card key={doc.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground">{doc.source_name}</h3>
                      <div className="grid grid-cols-2 gap-2 mt-2 text-sm text-muted-foreground">
                        <div>Label: {doc.label}</div>
                        <div>Chunks: {doc.chunk_count}</div>
                        <div>
                          Created: {new Date(doc.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      {doc.preview && (
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                          {doc.preview}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="ml-4"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <p className="text-foreground">Loading...</p>
        </div>
      }
    >
      <DocumentsPageContent />
    </Suspense>
  )
}
