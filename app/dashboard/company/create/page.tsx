'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'

import { ConsoleShell } from '@/components/cerebros/console-shell'
import {
  Alert,
  Btn,
  Label,
  Panel,
  SectionTitle,
  TextInput,
  btnClass,
} from '@/components/cerebros/ui'
import { createClient } from '@/lib/supabase/client'
import { describeError } from '@/lib/errors'
import { generateApiKey } from '@/lib/api-key'

const PROVISIONING_STEPS = [
  'A workspace key is generated and stored against the workspace',
  'Documents you upload are chunked and embedded into an isolated index',
  'A public chat link is issued for the workspace',
  'Retrieval never crosses workspace boundaries',
]

export default function CreateWorkspacePage() {
  const router = useRouter()
  const supabase = createClient()

  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!name.trim()) {
      setError('Please enter a workspace name')
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

      const { data, error: createError } = await supabase
        .from('companies')
        .insert([{ name: name.trim(), api_key: generateApiKey(), owner_id: user.id }])
        .select()
        .single()

      if (createError) throw createError

      router.push(`/?company_id=${data.id}`)
    } catch (err) {
      console.error('Error creating company:', describeError(err))
      setError(describeError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConsoleShell
      active="workspaces"
      eyebrow="RAG Console"
      badge="PROVISIONING"
      meta={<span>NEW WORKSPACE</span>}
      actions={
        <Link href="/" className={btnClass('outline', 'md')}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-2xl animate-fade-in space-y-6 p-4 pb-12 sm:p-6 md:p-10 md:pb-20">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-ink-900">
            Create Workspace
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            An isolated document index with its own key and public chat link.
          </p>
        </div>

        <Panel className="p-5 sm:p-6">
          <form onSubmit={handleCreate} className="space-y-5">
            <div>
              <Label htmlFor="workspace-name">Workspace Name</Label>
              <TextInput
                id="workspace-name"
                type="text"
                placeholder="e.g. Acme Corporation"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={loading}
                autoFocus
              />
              <p className="mt-2 text-[11px] text-ink-400">
                Shown as the title on the workspace&apos;s public chat page.
              </p>
            </div>

            {error ? <Alert>{error}</Alert> : null}

            <Btn type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Provisioning…
                </>
              ) : (
                'Create Workspace'
              )}
            </Btn>
          </form>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <SectionTitle>What happens next</SectionTitle>
          <ul className="mt-4 space-y-3">
            {PROVISIONING_STEPS.map((step) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-brand/10 text-brand">
                  <Check className="h-3 w-3" />
                </span>
                <span className="text-xs leading-relaxed text-ink-600">{step}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </ConsoleShell>
  )
}
