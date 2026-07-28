'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Loader } from 'lucide-react'

export default function CreateCompanyPage() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generateApiKey = () => {
    if (typeof window !== 'undefined' && window.crypto) {
      // Client-side generation with Web Crypto API
      const randomBytes = new Uint8Array(32)
      window.crypto.getRandomValues(randomBytes)
      return Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
    // Fallback for environments without crypto
    return Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15) +
           Math.random().toString(36).substring(2, 15)
  }

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Please enter a company name')
      return
    }

    setLoading(true)
    setError('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/auth/login')
        return
      }

      const apiKey = generateApiKey()

      const { data, error: createError } = await supabase
        .from('companies')
        .insert([
          {
            name: name.trim(),
            api_key: apiKey,
            owner_id: user.id,
          },
        ])
        .select()
        .single()

      if (createError) throw createError

      // Navigate to dashboard
      router.push(`/?company_id=${data.id}`)
    } catch (err: any) {
      console.error('Error creating company:', err)
      setError(err.message || 'Failed to create company')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Card className="p-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Create New Company</h1>
          <p className="text-muted-foreground mb-6">
            Set up a new company for managing your RAG chatbot
          </p>

          <form onSubmit={handleCreateCompany} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Company Name
              </label>
              <Input
                type="text"
                placeholder="e.g., Acme Corporation"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The name of your company. This will be displayed in all chats.
              </p>
            </div>

            {error && (
              <div className="p-4 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Company'
              )}
            </Button>
          </form>

          <div className="mt-8 p-4 bg-muted/50 rounded-lg">
            <h3 className="font-semibold text-foreground mb-2">What happens next?</h3>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>✓ An API key will be automatically generated for your company</li>
              <li>✓ You can upload documents and manage your chatbot context</li>
              <li>✓ Your company data is isolated and secure</li>
              <li>✓ Start chatting with your documents right away</li>
            </ul>
          </div>
        </Card>
      </main>
    </div>
  )
}
