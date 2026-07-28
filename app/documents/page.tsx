'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { n8nClient } from '@/lib/n8n/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Upload, Trash2, ArrowLeft, Loader } from 'lucide-react'

export default function DocumentsPage() {
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
        console.error('Error fetching data:', err)
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
      // Read file content
      const fileContent = await file.text()

      // Send to n8n for processing
      const result = await n8nClient.uploadDocument({
        api_key: company.api_key,
        source_name: file.name,
        label,
        content: fileContent,
        file_type: file.type || 'text/plain',
      })

      if (!result.success) {
        throw new Error(result.error || 'Upload failed')
      }

      // Add document to database
      const { data: newDoc, error: insertError } = await supabase
        .from('documents')
        .insert([
          {
            company_id: companyId,
            label,
            source_name: file.name,
            preview: fileContent.substring(0, 200),
            chunk_count: result.chunk_count || 0,
          },
        ])
        .select()

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
      console.error('Upload error:', err)
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
      console.error('Delete error:', err)
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
