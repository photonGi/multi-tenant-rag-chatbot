'use client'

import { useMemo } from 'react'

import { renderTemplate, type TemplateContext } from '@/lib/email/templates'

/**
 * The template rendered against dummy data, as an inbox would show it.
 *
 * It renders inside a sandboxed iframe rather than with dangerouslySetInnerHTML,
 * for two reasons that both matter:
 *
 *  1. Isolation in the honest direction. The console's stylesheet — Tailwind's
 *     preflight in particular, which strips heading sizes and list markers —
 *     would repaint the template into something no mail client will produce. In
 *     its own document the HTML gets browser defaults, which is much closer to
 *     what a recipient sees.
 *  2. The body is tenant-authored HTML being displayed in an authenticated
 *     console. `sandbox` with no allowances means no script in it runs, no form
 *     in it submits, and nothing in it can reach the page around it.
 */

interface TemplatePreviewProps {
  subject: string
  bodyHtml: string
  context: TemplateContext
  from: string | null
}

export function TemplatePreview({ subject, bodyHtml, context, from }: TemplatePreviewProps) {
  // Not named `document`: this component renders in the browser, and shadowing
  // the global inside it is the kind of thing that reads fine until someone
  // adds a line that expected the real one.
  const previewDocument = useMemo(() => {
    const rendered = renderTemplate(bodyHtml, context)

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 20px;
        background: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        font-size: 15px;
        line-height: 1.6;
        color: #18181b;
        overflow-wrap: anywhere;
      }
      img { max-width: 100%; }
    </style>
  </head>
  <body>${rendered}</body>
</html>`
  }, [bodyHtml, context])

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-soft">
      {/* The envelope around the message: what a recipient reads before they
          open it, and the part an owner is most likely to get wrong. */}
      <div className="space-y-1.5 border-b border-border/60 bg-ink-50/60 px-4 py-3">
        <div className="flex gap-2 text-[11px]">
          <span className="w-14 shrink-0 font-mono text-[10px] tracking-wider text-ink-400 uppercase">
            From
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-ink-600">
            {from ?? 'your connected mailbox'}
          </span>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="w-14 shrink-0 font-mono text-[10px] tracking-wider text-ink-400 uppercase">
            To
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-ink-600">
            {context.lead_email}
          </span>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="w-14 shrink-0 font-mono text-[10px] tracking-wider text-ink-400 uppercase">
            Subject
          </span>
          <span className="min-w-0 flex-1 font-medium text-ink-900">
            {renderTemplate(subject, context) || (
              <span className="text-ink-400 italic">No subject</span>
            )}
          </span>
        </div>
      </div>

      <iframe
        // Empty sandbox: no scripts, no forms, no navigation, no access to this
        // page. The preview only has to be looked at.
        sandbox=""
        srcDoc={previewDocument}
        title="Email preview"
        className="h-96 w-full border-0 bg-white"
      />
    </div>
  )
}
