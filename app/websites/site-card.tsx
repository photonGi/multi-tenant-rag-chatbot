'use client'

import { useState } from 'react'
import {
  Check,
  ChevronDown,
  Globe,
  Palette,
  Plus,
  Power,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'

import { Btn, Label, Panel, Pill, TextInput } from '@/components/console/ui'
import { cn } from '@/lib/utils'
import { formatRelative } from '@/lib/chat/storage'
import { displayHost, normalizeOriginPattern } from '@/lib/widget/origins'
import {
  DEFAULT_THEME,
  resolveTheme,
  serializeTheme,
  type WidgetTheme,
} from '@/lib/widget/theme'

import { InstallSnippet } from './install-snippet'
import type { WidgetSite } from './types'

type Section = 'install' | 'origins' | 'appearance' | null

export function SiteCard({
  site,
  appUrl,
  onPatch,
  onDelete,
}: Readonly<{
  site: WidgetSite
  appUrl: string
  onPatch: (id: string, patch: Partial<WidgetSite>) => Promise<void>
  onDelete: (site: WidgetSite) => Promise<void>
}>) {
  const [open, setOpen] = useState<Section>(site.status === 'pending' ? 'install' : null)
  const [busy, setBusy] = useState(false)

  const toggle = (section: Exclude<Section, null>) =>
    setOpen((current) => (current === section ? null : section))

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const primaryHost = site.allowed_origins[0]
    ? displayHost(site.allowed_origins[0])
    : 'No origin set'

  return (
    <Panel className="overflow-hidden">
      {/* ── Summary row ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink-900">{site.name}</span>
            <StatusPill site={site} />
          </div>

          <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-500">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{primaryHost}</span>
            {site.allowed_origins.length > 1 ? (
              <span className="text-ink-400">+{site.allowed_origins.length - 1}</span>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-ink-400">
            <span>{site.load_count.toLocaleString()} LOADS</span>
            <span>{site.message_count.toLocaleString()} MESSAGES</span>
            {site.last_seen_at ? (
              <span>SEEN {formatRelative(new Date(site.last_seen_at).getTime())}</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Btn
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              run(() =>
                onPatch(site.id, {
                  // Back to `pending`, not `active`: re-enabling does not prove
                  // the snippet is still on the page. The next real load does.
                  status: site.status === 'disabled' ? 'pending' : 'disabled',
                }),
              )
            }
            title={site.status === 'disabled' ? 'Enable this widget' : 'Disable this widget'}
          >
            <Power className={cn('h-3.5 w-3.5', site.status !== 'disabled' && 'text-success')} />
            {site.status === 'disabled' ? 'Enable' : 'Disable'}
          </Btn>

          <Btn
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => onDelete(site))}
            aria-label={`Delete ${site.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Btn>
        </div>
      </div>

      {/* ── Unlisted origins ─────────────────────────────────────────────── */}
      {site.pending_origins.length > 0 ? (
        <PendingOrigins site={site} busy={busy} onPatch={onPatch} run={run} />
      ) : null}

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5 border-t border-border/60 px-4 py-2.5 sm:px-5">
        <SectionTab
          icon={<Terminal className="h-3.5 w-3.5" />}
          label="Install"
          active={open === 'install'}
          onClick={() => toggle('install')}
        />
        <SectionTab
          icon={<Globe className="h-3.5 w-3.5" />}
          label={`Origins (${site.allowed_origins.length})`}
          active={open === 'origins'}
          onClick={() => toggle('origins')}
        />
        <SectionTab
          icon={<Palette className="h-3.5 w-3.5" />}
          label="Appearance"
          active={open === 'appearance'}
          onClick={() => toggle('appearance')}
        />
      </div>

      {open === 'install' ? (
        <div className="border-t border-border/60 p-4 sm:p-5">
          <InstallSnippet publicKey={site.public_key} appUrl={appUrl} />
          {site.status === 'pending' ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-ink-50 px-3 py-2 text-[11px] text-ink-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              Waiting for the first page load. This flips to Connected on its own — no
              verification step to click.
            </p>
          ) : null}
        </div>
      ) : null}

      {open === 'origins' ? (
        <div className="border-t border-border/60 p-4 sm:p-5">
          <OriginEditor site={site} busy={busy} onPatch={onPatch} run={run} />
        </div>
      ) : null}

      {open === 'appearance' ? (
        <div className="border-t border-border/60 p-4 sm:p-5">
          <AppearanceEditor site={site} busy={busy} onPatch={onPatch} run={run} />
        </div>
      ) : null}
    </Panel>
  )
}

/**
 * Origins the widget was loaded from but is not allowed to serve.
 *
 * Recording these rather than silently refusing is what turns "my staging
 * deploy shows nothing" from a support conversation into one click.
 */
function PendingOrigins({
  site,
  busy,
  onPatch,
  run,
}: Readonly<{
  site: WidgetSite
  busy: boolean
  onPatch: (id: string, patch: Partial<WidgetSite>) => Promise<void>
  run: (action: () => Promise<void>) => Promise<void>
}>) {
  const without = (origin: string) => site.pending_origins.filter((o) => o !== origin)

  const approve = (origin: string) =>
    run(() =>
      onPatch(site.id, {
        allowed_origins: [...site.allowed_origins, origin],
        pending_origins: without(origin),
      }),
    )

  const dismiss = (origin: string) =>
    run(() => onPatch(site.id, { pending_origins: without(origin) }))

  const count = site.pending_origins.length

  return (
    <div className="border-t border-border/60 bg-warning/5 px-4 py-3 sm:px-5">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink-900">
            {`Loaded from ${count} unlisted ${count === 1 ? 'origin' : 'origins'}`}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
            The widget stayed hidden there. Approve any that are really yours — a
            staging domain or a preview deploy.
          </p>

          <div className="mt-2.5 space-y-1.5">
            {site.pending_origins.map((origin) => (
              <div
                key={origin}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5"
              >
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-700">
                  {origin}
                </code>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => approve(origin)}
                  className="flex h-7 items-center gap-1 rounded-md border border-success/30 bg-success/5 px-2 text-[11px] font-medium text-success transition-colors hover:bg-success/10"
                >
                  <Check className="h-3 w-3" />
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => dismiss(origin)}
                  aria-label={`Dismiss ${origin}`}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ site }: Readonly<{ site: WidgetSite }>) {
  if (site.status === 'disabled') return <Pill tone="neutral">DISABLED</Pill>
  if (site.status === 'active') return <Pill tone="success">CONNECTED</Pill>
  return <Pill tone="brand">AWAITING INSTALL</Pill>
}

function SectionTab({
  icon,
  label,
  active,
  onClick,
}: Readonly<{
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-ink-100 text-ink-900' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
      )}
    >
      {icon}
      {label}
      <ChevronDown className={cn('h-3 w-3 transition-transform', active && 'rotate-180')} />
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function OriginEditor({
  site,
  busy,
  onPatch,
  run,
}: Readonly<{
  site: WidgetSite
  busy: boolean
  onPatch: (id: string, patch: Partial<WidgetSite>) => Promise<void>
  run: (action: () => Promise<void>) => Promise<void>
}>) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const remove = (origin: string) =>
    run(() =>
      onPatch(site.id, {
        allowed_origins: site.allowed_origins.filter((o) => o !== origin),
      }),
    )

  const add = () => {
    const normalized = normalizeOriginPattern(draft)
    if (!normalized) {
      setError('That does not look like a domain. Try example.com or *.example.com.')
      return
    }
    if (site.allowed_origins.includes(normalized)) {
      setError('That origin is already allowed.')
      return
    }

    setError('')
    setDraft('')
    void run(() =>
      onPatch(site.id, {
        allowed_origins: [...site.allowed_origins, normalized],
        pending_origins: site.pending_origins.filter((o) => o !== normalized),
      }),
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-500">
        The widget only runs on these origins. A browser cannot forge the origin it
        reports, so a key copied out of your page is useless anywhere else.
      </p>

      <div className="space-y-1.5">
        {site.allowed_origins.map((origin) => (
          <div
            key={origin}
            className="flex items-center gap-2 rounded-lg border border-border bg-ink-50 px-3 py-2"
          >
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-700">
              {origin}
            </code>
            <button
              type="button"
              disabled={busy || site.allowed_origins.length === 1}
              title={
                site.allowed_origins.length === 1
                  ? 'A site needs at least one origin — add another before removing this.'
                  : `Remove ${origin}`
              }
              onClick={() => remove(origin)}
              aria-label={`Remove ${origin}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-alert/10 hover:text-alert disabled:pointer-events-none disabled:opacity-30"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          value={draft}
          placeholder="staging.example.com or *.example.com"
          onChange={(event) => {
            setDraft(event.target.value)
            setError('')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Btn variant="outline" disabled={busy || !draft.trim()} onClick={add} className="shrink-0">
          <Plus className="h-4 w-4" />
          Add
        </Btn>
      </div>

      {error ? <p className="text-[11px] text-alert">{error}</p> : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AppearanceEditor({
  site,
  busy,
  onPatch,
  run,
}: Readonly<{
  site: WidgetSite
  busy: boolean
  onPatch: (id: string, patch: Partial<WidgetSite>) => Promise<void>
  run: (action: () => Promise<void>) => Promise<void>
}>) {
  const [draft, setDraft] = useState<WidgetTheme>(() => resolveTheme(site.theme))
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof WidgetTheme>(field: K, value: WidgetTheme[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setSaved(false)
  }

  const save = () =>
    run(async () => {
      // Normalised before it is stored, so the column can never hold a value
      // the runtime would have to defend against later. Serialised so the
      // derived foreground is not persisted — it is recomputed from the accent
      // on read, and a stale stored copy would be the one that wins.
      await onPatch(site.id, { theme: serializeTheme(resolveTheme(draft)) })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink-500">
        Changes go live on the next page load. The snippet never changes, so nobody
        has to touch the website again.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`accent-${site.id}`}>Accent colour</Label>
          <div className="flex items-center gap-2">
            <input
              id={`accent-${site.id}`}
              type="color"
              value={draft.accent}
              onChange={(event) => set('accent', event.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-surface p-1"
            />
            <TextInput
              value={draft.accent}
              onChange={(event) => set('accent', event.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div>
          <Label htmlFor={`position-${site.id}`}>Position</Label>
          <div className="flex gap-1.5">
            {(['left', 'right'] as const).map((side) => (
              <button
                key={side}
                type="button"
                onClick={() => set('position', side)}
                className={cn(
                  'h-11 flex-1 rounded-lg border text-xs font-medium capitalize transition-all sm:h-10',
                  draft.position === side
                    ? 'border-ink-900 bg-ink-900 text-surface'
                    : 'border-border bg-surface text-ink-600 hover:border-ink-300',
                )}
              >
                {side}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label htmlFor={`title-${site.id}`}>Title</Label>
          <TextInput
            id={`title-${site.id}`}
            value={draft.title}
            maxLength={40}
            onChange={(event) => set('title', event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`subtitle-${site.id}`}>Subtitle</Label>
          <TextInput
            id={`subtitle-${site.id}`}
            value={draft.subtitle}
            maxLength={80}
            onChange={(event) => set('subtitle', event.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`greeting-${site.id}`}>Opening message</Label>
          <TextInput
            id={`greeting-${site.id}`}
            value={draft.greeting}
            maxLength={300}
            onChange={(event) => set('greeting', event.target.value)}
          />
        </div>

        <div>
          <Label htmlFor={`launcher-${site.id}`}>Launcher label (optional)</Label>
          <TextInput
            id={`launcher-${site.id}`}
            value={draft.launcherLabel ?? ''}
            maxLength={32}
            placeholder="Ask us anything"
            onChange={(event) => set('launcherLabel', event.target.value || null)}
          />
        </div>

        <div>
          <Label htmlFor={`autoopen-${site.id}`}>Open automatically after</Label>
          <div className="flex items-center gap-2">
            <TextInput
              id={`autoopen-${site.id}`}
              type="number"
              min={0}
              max={300}
              value={draft.autoOpenAfter ?? ''}
              placeholder="Never"
              onChange={(event) =>
                set('autoOpenAfter', event.target.value === '' ? null : Number(event.target.value))
              }
            />
            <span className="shrink-0 text-xs text-ink-500">seconds</span>
          </div>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor={`starters-${site.id}`}>Starter questions (one per line, max 4)</Label>
          <textarea
            id={`starters-${site.id}`}
            rows={3}
            value={draft.starters.join('\n')}
            onChange={(event) =>
              set(
                'starters',
                event.target.value.split('\n').filter((line) => line.trim()).slice(0, 4),
              )
            }
            className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-light text-ink-900 shadow-soft transition-all outline-none placeholder:text-ink-400 focus:border-ink-300 focus:ring-1 focus:ring-ink-200"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600">
        <input
          type="checkbox"
          checked={draft.showBranding}
          onChange={(event) => set('showBranding', event.target.checked)}
          className="h-4 w-4 rounded border-border accent-ink-900"
        />
        <span>Show &ldquo;Powered by Multi-Tenant Chatbot&rdquo; in the panel</span>
      </label>

      <div className="flex items-center gap-2 border-t border-border/60 pt-4">
        <Btn disabled={busy} onClick={save}>
          {saved ? <Check className="h-4 w-4" /> : null}
          {saved ? 'Saved' : 'Save appearance'}
        </Btn>
        <Btn
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setDraft({ ...DEFAULT_THEME })
            setSaved(false)
          }}
        >
          Reset to defaults
        </Btn>
      </div>
    </div>
  )
}
