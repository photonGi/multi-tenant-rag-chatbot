'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Database,
  LayoutGrid,
  LogOut,
  MessageSquareText,
  Bot,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

export type ConsoleSection = 'workspaces' | 'documents' | 'chat' | 'admin'

type NavItem = {
  id: ConsoleSection
  label: string
  icon: LucideIcon
  href: string | null
  newTab?: boolean
}

/**
 * Documents / Chat / Admin are workspace-scoped, so they stay inert until a
 * workspace is selected rather than linking somewhere that would bounce back.
 */
function useNavItems(companyId?: string | null, chatHref?: string | null): NavItem[] {
  return [
    { id: 'workspaces', label: 'Workspaces', icon: LayoutGrid, href: '/' },
    {
      id: 'documents',
      label: 'Documents',
      icon: Database,
      href: companyId ? `/documents?company_id=${companyId}` : null,
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageSquareText,
      href: chatHref ?? null,
      newTab: true,
    },
    {
      id: 'admin',
      label: 'Admin',
      icon: SlidersHorizontal,
      href: companyId ? `/admin?company_id=${companyId}` : null,
    },
  ]
}

function useSignOut() {
  const router = useRouter()

  return React.useCallback(async () => {
    await createClient().auth.signOut()
    router.push('/auth/login')
  }, [router])
}

/**
 * Left rail. 64px fixed width, 40x40 buttons, tooltip on every icon-only
 * control — the spec treats those tooltips as an accessibility requirement.
 * Hidden below md, where the bottom bar takes over.
 */
function NavRail({ active, items }: { active: ConsoleSection; items: NavItem[] }) {
  const signOut = useSignOut()

  return (
    <nav className="relative z-50 hidden h-full w-16 shrink-0 flex-col items-center border-r border-border bg-surface py-5 md:flex">
      <Link
        href="/"
        className="mb-8 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-white shadow-soft transition-colors hover:bg-ink-800"
      >
        <Bot className="h-5 w-5" />
      </Link>

      <div className="flex w-full flex-col items-center gap-3">
        {items.map(({ id, label, icon: Icon, href, newTab }) => {
          const className = cn(
            'flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200',
            active === id
              ? 'bg-ink-900 text-surface shadow-md'
              : 'text-ink-400 hover:bg-ink-100 hover:text-ink-900',
          )

          if (!href) {
            return (
              <span
                key={id}
                data-tooltip={`${label} — select a workspace first`}
                className={cn(className, 'cursor-not-allowed opacity-30')}
                aria-disabled
              >
                <Icon className="h-4.5 w-4.5" />
              </span>
            )
          }

          return (
            <Link
              key={id}
              href={href}
              data-tooltip={label}
              target={newTab ? '_blank' : undefined}
              rel={newTab ? 'noreferrer' : undefined}
              className={className}
            >
              <Icon className="h-4.5 w-4.5" />
            </Link>
          )
        })}
      </div>

      <div className="mt-auto flex flex-col items-center gap-5 pb-1">
        <span
          data-tooltip="Vector index: live"
          className="flex h-4 w-4 cursor-help items-center justify-center"
        >
          <span className="h-2 w-2 animate-pulse-slow rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
        </span>
        <button
          type="button"
          onClick={signOut}
          data-tooltip="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </nav>
  )
}

/**
 * Mobile navigation. A 64px rail costs a sixth of a phone's width, so below md
 * the same destinations move to a bottom bar where thumbs already are, with
 * roomier targets than the rail's 40px squares.
 */
function NavBar({ active, items }: { active: ConsoleSection; items: NavItem[] }) {
  const signOut = useSignOut()

  return (
    <nav className="pb-safe-bar fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border bg-surface/95 backdrop-blur-sm md:hidden">
      {items.map(({ id, label, icon: Icon, href, newTab }) => {
        const className =
          'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors'

        if (!href) {
          return (
            <span
              key={id}
              className={cn(className, 'text-ink-400 opacity-30')}
              aria-disabled
            >
              <Icon className="h-5 w-5" />
              {label}
            </span>
          )
        }

        return (
          <Link
            key={id}
            href={href}
            target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noreferrer' : undefined}
            className={cn(
              className,
              'active:bg-ink-50',
              active === id ? 'text-ink-900' : 'text-ink-400',
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5" />
              {active === id ? (
                <span className="absolute -bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand" />
              ) : null}
            </span>
            {label}
          </Link>
        )
      })}

      <button
        type="button"
        onClick={signOut}
        className={cn(
          'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium text-ink-400 transition-colors',
          'active:bg-ink-50',
        )}
      >
        <LogOut className="h-5 w-5" />
        Sign out
      </button>
    </nav>
  )
}

/**
 * Console frame: rail (or bottom bar) + sticky glass header + scrolling
 * viewport. The chat module deliberately does not use this — it ships its own
 * shell so it stays independent of the authenticated console.
 */
export function ConsoleShell({
  active,
  companyId,
  chatHref,
  eyebrow,
  badge,
  meta,
  actions,
  children,
}: {
  active: ConsoleSection
  companyId?: string | null
  chatHref?: string | null
  eyebrow: string
  badge?: string
  meta?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const items = useNavItems(companyId, chatHref)

  return (
    // h-dvh rather than h-screen: mobile browsers report 100vh as the height
    // with the URL bar retracted, which pushes content below the fold.
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <NavRail active={active} items={items} />

      <main className="flex h-full w-full flex-1 flex-col bg-canvas/30">
        <header className="sticky top-0 z-40 flex w-full items-center justify-between gap-3 border-b border-border/40 bg-canvas/90 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4 md:px-8">
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight text-ink-900 uppercase">
                {eyebrow}
              </span>
              {badge ? (
                <span className="hidden shrink-0 rounded border border-ink-200 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 sm:inline">
                  {badge}
                </span>
              ) : null}
            </div>
            {meta ? (
              <div className="mt-0.5 flex items-center gap-2 truncate font-mono text-[10px] text-ink-500">
                {meta}
              </div>
            ) : null}
          </div>

          {actions ? (
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">{actions}</div>
          ) : null}
        </header>

        {/* Bottom padding clears the mobile bar; on md+ the rail is beside. */}
        <div className="relative flex flex-1 flex-col overflow-y-auto pb-24 md:pb-0">
          {children}
        </div>
      </main>

      <NavBar active={active} items={items} />
    </div>
  )
}

/** Full-viewport loading state, styled as a system boot line. */
export function ConsoleLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="flex items-center gap-3 font-mono text-xs text-ink-500">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
        {label.toUpperCase()}
        <span className="animate-blink">_</span>
      </div>
    </div>
  )
}
