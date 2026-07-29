'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown renderer for assistant answers.
 *
 * The model returns markdown — bold runs, bullet lists, headings, occasionally
 * tables — so rendering it as plain text left the raw asterisks and dashes on
 * screen.
 *
 * Raw HTML stays disabled: react-markdown ignores embedded HTML unless
 * rehype-raw is added, and adding it would make every indexed document a script
 * vector. Do not add it.
 */
const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,

  strong: ({ children }) => (
    <strong className="font-semibold text-ink-900">{children}</strong>
  ),

  em: ({ children }) => <em className="italic">{children}</em>,

  h1: ({ children }) => (
    <h1 className="text-lg font-semibold tracking-tight text-ink-900">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold tracking-tight text-ink-900">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold tracking-tight text-ink-900">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-xs font-semibold tracking-wider text-ink-500 uppercase">
      {children}
    </h4>
  ),

  ul: ({ children }) => (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-ink-400">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="space-y-2 leading-relaxed [&>p]:inline">{children}</li>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-ink-900 underline decoration-ink-300 underline-offset-2 transition-colors hover:decoration-brand"
    >
      {children}
    </a>
  ),

  code: ({ className, children }) => {
    // react-markdown marks fenced blocks with a language- class; anything
    // without one is an inline span.
    const isBlock = /language-/.test(className ?? '')

    if (isBlock) {
      return (
        <code className="font-mono text-xs leading-relaxed text-ink-900">
          {children}
        </code>
      )
    }

    return (
      <code className="rounded border border-border bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-900">
        {children}
      </code>
    )
  },

  // Wide content scrolls inside its own box rather than stretching the column.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg border border-border bg-ink-50 p-4">
      {children}
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="space-y-2 border-l-2 border-ink-200 pl-4 text-ink-600">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="border-border" />,

  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-ink-50">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border">{children}</tbody>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2 text-[10px] font-bold tracking-wider text-ink-400 uppercase">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-4 py-2.5 text-ink-900">{children}</td>,
}

/**
 * `reveal` cascades the top-level blocks in on first paint (see `.md-reveal` in
 * globals.css). Leave it off for answers replayed from history — they should
 * already be on screen, not re-perform their arrival.
 */
export function Markdown({
  children,
  reveal = false,
}: {
  children: string
  reveal?: boolean
}) {
  return (
    <div className={`space-y-3 text-base text-ink-900${reveal ? ' md-reveal' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
