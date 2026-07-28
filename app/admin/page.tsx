'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ArrowLeft, Copy, RefreshCw, Trash2, AlertTriangle } from 'lucide-react'

export default function AdminPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('company_id')
  const supabase = createClient()

  const [company, setCompany] = useState<any>(null)
  const [stats, setStats] = useState({
    totalDocuments: 0,
    totalChunks: 0,
    totalConversations: 0,
    totalMessages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

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

        // Get stats
        const { count: docsCount } = await supabase
          .from('documents')
          .select('*', { count: 'exact' })
          .eq('company_id', companyId)

        const { count: chunksCount } = await supabase
          .from('document_chunks')
          .select('*', { count: 'exact' })
          .eq('company_id', companyId)

        const { count: convsCount } = await supabase
          .from('conversations')
          .select('*', { count: 'exact' })
          .eq('company_id', companyId)

        const { count: msgsCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact' })
          .in(
            'conversation_id',
            (
              await supabase
                .from('conversations')
                .select('id')
                .eq('company_id', companyId)
            ).data?.map((c) => c.id) || []
          )

        setStats({
          totalDocuments: docsCount || 0,
          totalChunks: chunksCount || 0,
          totalConversations: convsCount || 0,
          totalMessages: msgsCount || 0,
        })
      } catch (err) {
        console.error('Error fetching admin data:', err)
        setError('Failed to load admin data')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [companyId, router, supabase])

  const handleCopyApiKey = () => {
    if (company?.api_key) {
      navigator.clipboard.writeText(company.api_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleRegenerateApiKey = async () => {
    if (!confirm('Are you sure? This will invalidate the current API key.')) return

    try {
      const newApiKey = Math.random().toString(36).substring(2, 15)

      const { data: updated, error: updateError } = await supabase
        .from('companies')
        .update({ api_key: newApiKey })
        .eq('id', companyId)
        .select()
        .single()

      if (updateError) throw updateError

      setCompany(updated)
    } catch (err) {
      console.error('Error regenerating API key:', err)
      setError('Failed to regenerate API key')
    }
  }

  const handleDeleteCompany = async () => {
    if (
      !confirm(
        'Are you sure? This will permanently delete the company and all associated data.'
      )
    ) {
      return
    }

    try {
      // Delete all messages
      const conversations = await supabase
        .from('conversations')
        .select('id')
        .eq('company_id', companyId)

      if (conversations.data) {
        for (const conv of conversations.data) {
          await supabase.from('messages').delete().eq('conversation_id', conv.id)
        }
      }

      // Delete conversations
      await supabase.from('conversations').delete().eq('company_id', companyId)

      // Delete chunks
      await supabase.from('document_chunks').delete().eq('company_id', companyId)

      // Delete documents
      await supabase.from('documents').delete().eq('company_id', companyId)

      // Delete company
      const { error: deleteError } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId)

      if (deleteError) throw deleteError

      router.push('/')
    } catch (err) {
      console.error('Error deleting company:', err)
      setError('Failed to delete company')
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </Link>
              <h1 className="text-2xl font-bold text-foreground">
                {company?.name} - Admin
              </h1>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <Card className="p-4 mb-6 bg-destructive/10 border-destructive/30">
            <p className="text-sm text-destructive">{error}</p>
          </Card>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="p-6">
            <div className="text-2xl font-bold text-primary">{stats.totalDocuments}</div>
            <p className="text-sm text-muted-foreground mt-1">Documents</p>
          </Card>
          <Card className="p-6">
            <div className="text-2xl font-bold text-primary">{stats.totalChunks}</div>
            <p className="text-sm text-muted-foreground mt-1">Text Chunks</p>
          </Card>
          <Card className="p-6">
            <div className="text-2xl font-bold text-primary">
              {stats.totalConversations}
            </div>
            <p className="text-sm text-muted-foreground mt-1">Conversations</p>
          </Card>
          <Card className="p-6">
            <div className="text-2xl font-bold text-primary">{stats.totalMessages}</div>
            <p className="text-sm text-muted-foreground mt-1">Messages</p>
          </Card>
        </div>

        {/* API Key Management */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-bold text-foreground mb-4">API Key Management</h2>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Current API Key</p>
              <div className="flex items-center space-x-2">
                <code className="flex-1 bg-muted p-3 rounded text-sm font-mono text-foreground break-all">
                  {company?.api_key}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyApiKey}
                  className="flex items-center space-x-2"
                >
                  <Copy className="w-4 h-4" />
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </Button>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <Button
                variant="outline"
                onClick={handleRegenerateApiKey}
                className="flex items-center space-x-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Regenerate API Key</span>
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                This will invalidate the current key. Make sure to update any integrations.
              </p>
            </div>
          </div>
        </Card>

        {/* Company Info */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-bold text-foreground mb-4">Company Information</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Company ID</span>
              <code className="font-mono text-foreground">{company?.id}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span className="text-foreground">
                {new Date(company?.created_at).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Updated</span>
              <span className="text-foreground">
                {new Date(company?.updated_at).toLocaleString()}
              </span>
            </div>
          </div>
        </Card>

        {/* Danger Zone */}
        <Card className="p-6 border-destructive/30 bg-destructive/5">
          <h2 className="text-lg font-bold text-destructive mb-4 flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5" />
            <span>Danger Zone</span>
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Permanently delete this company and all associated data. This action cannot be
            undone.
          </p>
          <Button variant="destructive" onClick={handleDeleteCompany}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Company
          </Button>
        </Card>
      </main>
    </div>
  )
}
