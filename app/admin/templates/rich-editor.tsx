'use client'

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { Bold, Code2, Heading, Italic, Link2, List, Pilcrow, Type } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * The body editor: a visual mode for people writing an email, and a source mode
 * for people who want the exact HTML.
 *
 * Both edit the same string. `body_html` is what gets sent, so the source view
 * is authoritative and the visual view is a convenience over it — not a
 * separate document format that has to be converted at save time. That is the
 * whole reason the toggle is safe: switching modes cannot lose anything,
 * because there is only ever one representation.
 *
 * Formatting uses `document.execCommand`. It is deprecated and its replacement
 * is not implemented anywhere, so every editor of this size either uses it or
 * ships a 100 KB library to reimplement it. For six buttons on a settings page,
 * the deprecated API that works in every browser today is the right trade.
 */

export type EditorMode = 'visual' | 'html'

export interface RichEditorHandle {
  /** Inserts text at the caret, in whichever mode is showing. */
  insert(text: string): void
}

interface RichEditorProps {
  value: string
  onChange: (value: string) => void
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  ref?: Ref<RichEditorHandle>
  id?: string
}

const toolbarButton =
  'flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40'

export function RichEditor({
  value,
  onChange,
  mode,
  onModeChange,
  ref,
  id,
}: RichEditorProps) {
  const visualRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)

  // Writing to innerHTML on every render would reset the caret to the start of
  // the document on every keystroke. Typing already leaves the two in sync, so
  // this only fires for changes that came from somewhere else — a mode switch,
  // a variable insertion, a reset to the default.
  useEffect(() => {
    const element = visualRef.current
    if (mode === 'visual' && element && element.innerHTML !== value) {
      element.innerHTML = value
    }
  }, [mode, value])

  useImperativeHandle(
    ref,
    () => ({
      insert(text: string) {
        if (mode === 'html') {
          const textarea = sourceRef.current
          if (!textarea) return

          const start = textarea.selectionStart ?? value.length
          const end = textarea.selectionEnd ?? start

          onChange(`${value.slice(0, start)}${text}${value.slice(end)}`)

          // The value change re-renders before the caret can be moved, so the
          // reposition waits a frame. Without it the caret jumps to the end and
          // inserting two variables in a row puts them in the wrong order.
          requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(start + text.length, start + text.length)
          })
          return
        }

        const element = visualRef.current
        if (!element) return

        element.focus()
        // insertText rather than insertHTML: a variable token is literal text,
        // and going through the HTML path would escape or reinterpret it.
        document.execCommand('insertText', false, text)
        onChange(element.innerHTML)
      },
    }),
    [mode, onChange, value],
  )

  const command = (name: string, argument?: string) => {
    const element = visualRef.current
    if (!element) return

    element.focus()
    document.execCommand(name, false, argument)
    onChange(element.innerHTML)
  }

  const insertLink = () => {
    const url = prompt('Link address', 'https://')
    if (!url || url === 'https://') return
    command('createLink', url)
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-soft">
      <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-ink-50/60 px-2 py-1.5">
        <button
          type="button"
          onClick={() => command('bold')}
          disabled={mode === 'html'}
          className={toolbarButton}
          title="Bold"
          aria-label="Bold"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => command('italic')}
          disabled={mode === 'html'}
          className={toolbarButton}
          title="Italic"
          aria-label="Italic"
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={insertLink}
          disabled={mode === 'html'}
          className={toolbarButton}
          title="Link"
          aria-label="Insert link"
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-4 w-px bg-border" />

        <button
          type="button"
          onClick={() => command('formatBlock', 'h2')}
          disabled={mode === 'html'}
          className={toolbarButton}
          title="Heading"
          aria-label="Heading"
        >
          <Heading className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => command('formatBlock', 'p')}
          disabled={mode === 'html'}
          className={toolbarButton}
          title="Paragraph"
          aria-label="Paragraph"
        >
          <Pilcrow className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => command('insertUnorderedList')}
          disabled={mode === 'html'}
          className={toolbarButton}
          title="Bullet list"
          aria-label="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </button>

        {/* Mode switch sits at the far end — it changes the whole surface, not
            the selection, so it should not read as one more format button. */}
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface p-0.5">
          <button
            type="button"
            onClick={() => onModeChange('visual')}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium tracking-wide uppercase transition-colors',
              mode === 'visual'
                ? 'bg-ink-900 text-white'
                : 'text-ink-500 hover:text-ink-900',
            )}
          >
            <Type className="h-3 w-3" />
            Visual
          </button>
          <button
            type="button"
            onClick={() => onModeChange('html')}
            className={cn(
              'flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium tracking-wide uppercase transition-colors',
              mode === 'html' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900',
            )}
          >
            <Code2 className="h-3 w-3" />
            HTML
          </button>
        </div>
      </div>

      {mode === 'visual' ? (
        <div
          id={id}
          ref={visualRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          onInput={(event) => onChange(event.currentTarget.innerHTML)}
          onPaste={(event) => {
            // Paste as plain text. A paste out of Word or a webmail thread
            // otherwise drops several kilobytes of foreign markup — font tags,
            // class names, `mso-` styles — into a template that has to render
            // in mail clients this app cannot test against.
            event.preventDefault()
            const text = event.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
            onChange(event.currentTarget.innerHTML)
          }}
          className="rich-body min-h-72 max-w-none overflow-y-auto px-4 py-3 text-sm leading-relaxed text-ink-900 outline-none"
        />
      ) : (
        <textarea
          id={id}
          ref={sourceRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          aria-label="Email body HTML"
          className="min-h-72 w-full resize-y bg-surface px-4 py-3 font-mono text-xs leading-relaxed text-ink-900 outline-none"
        />
      )}
    </div>
  )
}
