'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MessageSquare, Upload, LogOut, Settings } from 'lucide-react'

export default function Dashboard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [companies, setCompanies] = useState<any[]>([])
  const [selectedCompany, setSelectedCompany] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser()
        const authUser = authData?.user

        // Only a genuine auth failure sends the user to the login page.
        if (authError || !authUser) {
          router.push('/auth/login')
          return
        }

        setUser(authUser)

        // Fetch user's companies
        const { data: companiesData, error: companiesError } = await supabase
          .from('companies')
          .select('*')
          .eq('owner_id', authUser.id)

        if (companiesError) {
          // A failed query is not an auth problem — show it instead of
          // silently bouncing the user back to login.
          console.error('Failed to load companies:', describeError(companiesError))
          setError(describeError(companiesError))
          return
        }

        setCompanies(companiesData || [])
        if (companiesData && companiesData.length > 0) {
          setSelectedCompany(companiesData[0])
        }
      } catch (error) {
        console.error('Failed to load dashboard:', describeError(error))
        setError(describeError(error))
      } finally {
        setLoading(false)
      }
    }

    checkAuth()
  }, [router, supabase])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <p className="text-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">RAG Chatbot</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground">{user?.email}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="flex items-center space-x-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 rounded-md border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {companies.length === 0 ? (
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold text-foreground mb-4">No Companies Yet</h2>
            <p className="text-muted-foreground mb-6">Create your first company to get started</p>
            <Link href="/dashboard/company/create">
              <Button>Create Company</Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {/* Company Selection */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground">Your Companies</h2>
              <Link href="/dashboard/company/create">
                <Button variant="outline" size="sm">
                  New Company
                </Button>
              </Link>
            </div>

            {/* Company Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {companies.map((company) => (
                <Card
                  key={company.id}
                  className="p-6 cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setSelectedCompany(company)}
                >
                  <h3 className="font-bold text-foreground mb-2">{company.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Created {new Date(company.created_at).toLocaleDateString()}
                  </p>
                  <div className="flex flex-col space-y-2">
                    <Link href={`/documents?company_id=${company.id}`}>
                      <Button variant="outline" size="sm" className="w-full">
                        <Upload className="w-4 h-4 mr-2" />
                        Manage Documents
                      </Button>
                    </Link>
                    <Link href={`/chatbot?company_id=${company.id}`}>
                      <Button size="sm" className="w-full">
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Open Chat
                      </Button>
                    </Link>
                  </div>
                </Card>
              ))}
            </div>

            {/* Selected Company Details */}
            {selectedCompany && (
              <Card className="p-6 bg-card border-primary">
                <h3 className="text-lg font-bold text-foreground mb-4">{selectedCompany.name}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <p className="text-sm text-muted-foreground">API Key</p>
                    <p className="font-mono text-sm text-foreground break-all">
                      {selectedCompany.api_key}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Created</p>
                    <p className="text-foreground">
                      {new Date(selectedCompany.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Link href={`/admin?company_id=${selectedCompany.id}`}>
                  <Button variant="outline" className="flex items-center space-x-2">
                    <Settings className="w-4 h-4" />
                    <span>Admin Dashboard</span>
                  </Button>
                </Link>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
