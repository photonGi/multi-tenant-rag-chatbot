'use client'

import { Suspense, useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import { n8nClient } from '@/lib/n8n/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Send, ArrowLeft, Loader, MessageSquare } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function ChatbotPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('company_id')
  const supabase = createClient()

  const [company, setCompany] = useState<any>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const initChat = async () => {
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

        // Get or create conversation
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          router.push('/auth/login')
          return
        }

        // Check for existing conversation
        const { data: existingConv } = await supabase
          .from('conversations')
          .select('*')
          .eq('company_id', companyId)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        let convId = existingConv?.id

        if (!convId) {
          // Create new conversation
          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert([{ company_id: companyId, user_id: user.id }])
            .select()
            .single()

          if (convError) throw convError
          convId = newConv.id
        }

        setConversationId(convId)

        // Load messages
        const { data: messagesData, error: messagesError } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true })

        if (messagesError) throw messagesError
        setMessages(messagesData || [])
      } catch (err) {
        console.error('Error initializing chat:', describeError(err))
        setError('Failed to initialize chat')
      } finally {
        setLoading(false)
      }
    }

    initChat()
  }, [companyId, router, supabase])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !conversationId || !company) {
      return
    }

    setSending(true)
    setError('')
    const userMessage = input.trim()
    setInput('')

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError('Not authenticated')
        setSending(false)
        return
      }

      // Add user message to database
      const { data: userMsg, error: userMsgError } = await supabase
        .from('messages')
        .insert([
          {
            conversation_id: conversationId,
            user_id: user.id,
            role: 'user',
            content: userMessage,
          },
        ])
        .select()
        .single()

      if (userMsgError) throw userMsgError

      // Add to local messages
      setMessages((prev) => [
        ...prev,
        {
          id: userMsg.id,
          role: 'user' as const,
          content: userMessage,
          created_at: userMsg.created_at,
        },
      ])

      // Get response from n8n
      const response = await n8nClient.chat({
        api_key: company.api_key,
        question: userMessage,
      })

      // Add assistant message to database
      const { data: assistantMsg, error: assistantMsgError } = await supabase
        .from('messages')
        .insert([
          {
            conversation_id: conversationId,
            user_id: user.id,
            role: 'assistant',
            content: response.answer,
          },
        ])
        .select()
        .single()

      if (assistantMsgError) throw assistantMsgError

      // Add to local messages
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsg.id,
          role: 'assistant' as const,
          content: response.answer,
          created_at: assistantMsg.created_at,
        },
      ])
    } catch (err: any) {
      console.error('Error sending message:', describeError(err))
      setError(err.message || 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <p className="text-foreground">Loading chat...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
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
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                <h1 className="text-xl font-bold text-foreground">
                  {company?.name} Chat
                </h1>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-semibold text-foreground mb-2">
                Welcome to {company?.name} Chat
              </p>
              <p className="text-muted-foreground">
                Ask questions about your uploaded documents
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <Card
                  className={`max-w-md px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  <p
                    className={`text-xs mt-1 ${
                      msg.role === 'user'
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {new Date(msg.created_at).toLocaleTimeString()}
                  </p>
                </Card>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* Input Area */}
      <footer className="border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {error && <div className="text-sm text-destructive mb-2">{error}</div>}
          <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
            <Input
              type="text"
              placeholder="Ask a question..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={sending || !input.trim()}
              size="sm"
              className="flex items-center space-x-2"
            >
              {sending ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </form>
        </div>
      </footer>
    </div>
  )
}

export default function ChatbotPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <p className="text-foreground">Loading chat...</p>
        </div>
      }
    >
      <ChatbotPageContent />
    </Suspense>
  )
}
