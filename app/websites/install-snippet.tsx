'use client'

import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { Btn } from '@/components/cerebros/ui'
import { cn } from '@/lib/utils'
import { DEFAULT_STACK, buildSnippets, type StackId } from '@/lib/widget/snippet'

/**
 * The install step.
 *
 * The stack picker is the whole point: the snippet never changes, but where it
 * goes does, and "which file do I put this in" is what actually stalls an
 * install. Picking a stack rewrites the instruction line above the code, not
 * just the code.
 */
export function InstallSnippet({
  publicKey,
  appUrl,
}: Readonly<{ publicKey: string; appUrl: string }>) {
  const [stackId, setStackId] = useState<StackId>(DEFAULT_STACK)
  const [copied, setCopied] = useState(false)

  const snippets = useMemo(
    () => buildSnippets({ publicKey, appUrl }),
    [publicKey, appUrl],
  )
  const active = snippets.find((entry) => entry.id === stackId) ?? snippets[0]!

  const families = useMemo(() => {
    const grouped = new Map<string, typeof snippets>()
    for (const snippet of snippets) {
      const bucket = grouped.get(snippet.family) ?? []
      bucket.push(snippet)
      grouped.set(snippet.family, bucket)
    }
    return [...grouped.entries()]
  }, [snippets])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked. The snippet is selectable on screen either way.
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {families.map(([family, entries]) => (
          <div key={family} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 font-mono text-[10px] tracking-wider text-ink-400 uppercase">
              {family}
            </span>
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setStackId(entry.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-all',
                  entry.id === active.id
                    ? 'border-ink-900 bg-ink-900 text-surface'
                    : 'border-border bg-surface text-ink-600 hover:border-ink-300 hover:text-ink-900',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-600">{active.where}</p>

      <div className="relative">
        <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-ink-950 p-4 pr-14 font-mono text-[11px] leading-relaxed text-ink-100">
          <code>{active.code}</code>
        </pre>
        <Btn
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label="Copy snippet"
          className="absolute top-2.5 right-2.5 border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-600 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Btn>
      </div>

      {active.note ? (
        <p className="text-[11px] leading-relaxed text-ink-500">{active.note}</p>
      ) : null}
    </div>
  )
}
