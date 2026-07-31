'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Check, Loader2, Plus, RotateCcw, TriangleAlert } from 'lucide-react'

import {
  Alert,
  Btn,
  Label,
  Panel,
  PageHeading,
  Pill,
  SectionTitle,
  TextInput,
} from '@/components/console/ui'
import { AdminFrame, AdminTabs, type AdminCompany } from '@/app/admin/admin-frame'
import { describeError } from '@/lib/errors'
import {
  DEFAULT_MEETING_CONFIRMATION,
  MEETING_CONFIRMATION_KEY,
  TEMPLATE_VARIABLES,
  sampleContext,
  unknownVariables,
} from '@/lib/email/templates'
import { CONNECTION_PUBLIC_COLUMNS, type PublicConnection } from '@/lib/google/connection-shape'
import { createClient } from '@/lib/supabase/client'

import { RichEditor, type EditorMode, type RichEditorHandle } from './rich-editor'
import { TemplatePreview } from './template-preview'

/**
 * The meeting confirmation email.
 *
 * The page is never blank: if the workspace has no row yet, the default from
 * lib/email/templates.ts is written on first visit. Seeding lazily rather than
 * at workspace creation means it also covers every workspace that existed
 * before this feature did, and it keeps one seeding path instead of two that
 * can disagree about what the default is.
 */

interface TemplateRow {
  id: string
  subject: string
  body_html: string
  updated_at: string
}

/** Postgres unique_violation — another tab seeded the same row first. */
const UNIQUE_VIOLATION = '23505'

function TemplateEditor({ company }: { company: AdminCompany }) {
  const supabase = useMemo(() => createClient(), [])
  const editorRef = useRef<RichEditorHandle>(null)

  const [template, setTemplate] = useState<TemplateRow | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [mode, setMode] = useState<EditorMode>('visual')
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const context = useMemo(() => sampleContext(company.name), [company.name])

  useEffect(() => {
    const load = async () => {
      const select = () =>
        supabase
          .from('email_templates')
          .select('id, subject, body_html, updated_at')
          .eq('company_id', company.id)
          .eq('template_key', MEETING_CONFIRMATION_KEY)
          .maybeSingle<TemplateRow>()

      try {
        const { data: existing, error: selectError } = await select()
        if (selectError) throw selectError

        if (existing) {
          setTemplate(existing)
          setSubject(existing.subject)
          setBody(existing.body_html)
          return
        }

        const { data: seeded, error: insertError } = await supabase
          .from('email_templates')
          .insert({
            company_id: company.id,
            template_key: MEETING_CONFIRMATION_KEY,
            subject: DEFAULT_MEETING_CONFIRMATION.subject,
            body_html: DEFAULT_MEETING_CONFIRMATION.body_html,
          })
          .select('id, subject, body_html, updated_at')
          .single<TemplateRow>()

        if (insertError) {
          // Two tabs open on a workspace with no template both try to seed it.
          // The loser reads what the winner wrote rather than showing an error
          // for a row that now exists.
          if (insertError.code === UNIQUE_VIOLATION) {
            const { data: raced } = await select()
            if (raced) {
              setTemplate(raced)
              setSubject(raced.subject)
              setBody(raced.body_html)
              return
            }
          }
          throw insertError
        }

        setTemplate(seeded)
        setSubject(seeded.subject)
        setBody(seeded.body_html)
      } catch (err) {
        console.error('Error loading email template:', describeError(err))
        setError('Failed to load the email template')
        // Still give the owner something to look at and edit.
        setSubject(DEFAULT_MEETING_CONFIRMATION.subject)
        setBody(DEFAULT_MEETING_CONFIRMATION.body_html)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [company.id, supabase])

  // Shown in the preview's From line, so the owner can see the address a lead
  // will actually receive this from. Absent is fine — the preview says so.
  useEffect(() => {
    const loadMailbox = async () => {
      const { data } = await supabase
        .from('oauth_connections')
        .select(CONNECTION_PUBLIC_COLUMNS)
        .eq('company_id', company.id)
        .eq('provider', 'google')
        .maybeSingle<PublicConnection>()

      if (data?.status === 'connected') setConnectedEmail(data.connected_email)
    }

    loadMailbox()
  }, [company.id, supabase])

  const dirty =
    template !== null && (subject !== template.subject || body !== template.body_html)

  const handleSave = useCallback(async () => {
    if (!template) return

    setSaving(true)
    setError('')

    try {
      const { data, error: updateError } = await supabase
        .from('email_templates')
        .update({ subject, body_html: body })
        .eq('id', template.id)
        .select('id, subject, body_html, updated_at')
        .single<TemplateRow>()

      if (updateError) throw updateError

      setTemplate(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Error saving email template:', describeError(err))
      setError('Failed to save the template')
    } finally {
      setSaving(false)
    }
  }, [body, subject, supabase, template])

  const handleReset = () => {
    if (!confirm('Replace the subject and body with the default template?')) return
    setSubject(DEFAULT_MEETING_CONFIRMATION.subject)
    setBody(DEFAULT_MEETING_CONFIRMATION.body_html)
  }

  const unknown = useMemo(
    () => [...new Set([...unknownVariables(subject), ...unknownVariables(body)])],
    [body, subject],
  )

  if (loading) {
    return (
      <>
        <PageHeading title="Email Templates" />
        <AdminTabs active="templates" companyId={company.id} />
        <Panel className="flex items-center gap-3 p-6 font-mono text-xs text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          LOADING TEMPLATE
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeading
        title="Email Templates"
        subtitle="The confirmation a lead receives once the assistant books a meeting."
      >
        {dirty ? <Pill tone="brand">UNSAVED</Pill> : null}
        <Btn variant="outline" onClick={handleReset}>
          <RotateCcw className="h-4 w-4" />
          Reset
        </Btn>
        <Btn onClick={handleSave} disabled={!dirty || saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </Btn>
      </PageHeading>

      <AdminTabs active="templates" companyId={company.id} />

      {error ? <Alert>{error}</Alert> : null}

      {unknown.length > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-brand/20 bg-brand/5 p-4 text-xs leading-relaxed text-ink-600">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span>
            {unknown.map((token) => `{{${token}}}`).join(', ')}{' '}
            {unknown.length === 1 ? 'is not a variable' : 'are not variables'} this app
            fills in — it will be sent to the lead exactly as written. Check the spelling
            against the list below.
          </span>
        </div>
      ) : null}

      {/* Editor and preview side by side above lg. Below that the preview
          follows the editor, because a phone cannot show both at once and the
          thing being edited should come first. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel className="space-y-5 p-5 sm:p-6">
          <SectionTitle>Meeting Confirmation</SectionTitle>

          <div>
            <Label htmlFor="template-subject">Subject</Label>
            <TextInput
              id="template-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Your meeting is confirmed"
            />
          </div>

          <div>
            <Label htmlFor="template-body">Body</Label>
            <RichEditor
              id="template-body"
              ref={editorRef}
              value={body}
              onChange={setBody}
              mode={mode}
              onModeChange={setMode}
            />
            <p className="mt-2 text-[11px] text-ink-400">
              Sent as HTML. Keep it simple — mail clients ignore most modern CSS.
            </p>
          </div>
        </Panel>

        <div className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle className="text-ink-500">Live Preview</SectionTitle>
              <span className="font-mono text-[10px] text-ink-400">DUMMY DATA</span>
            </div>
            <TemplatePreview
              subject={subject}
              bodyHtml={body}
              context={context}
              from={connectedEmail}
            />
          </div>
        </div>
      </div>

      {/* ── Variables ─────────────────────────────────────────────────────── */}
      <Panel className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Braces className="h-4 w-4 text-ink-400" />
          <SectionTitle>Available Variables</SectionTitle>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          Each one is replaced with the real value when the confirmation is sent.
          Anything else in double braces is sent through untouched.
        </p>

        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TEMPLATE_VARIABLES.map((variable) => (
            <li
              key={variable.token}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-ink-50/60 px-3 py-2.5"
            >
              <div className="min-w-0">
                <code className="block font-mono text-[11px] break-all text-ink-900">
                  {`{{${variable.token}}}`}
                </code>
                <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                  {variable.label} — {variable.sample}
                </span>
              </div>
              <button
                type="button"
                onClick={() => editorRef.current?.insert(`{{${variable.token}}}`)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-medium text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-900"
                title={`Insert {{${variable.token}}} into the body`}
              >
                <Plus className="h-3 w-3" />
                Insert
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  )
}

export default function AdminTemplatesPage() {
  return (
    <AdminFrame section="templates" badge="TEMPLATES" loadingLabel="Loading templates">
      {(company) => <TemplateEditor company={company} />}
    </AdminFrame>
  )
}
