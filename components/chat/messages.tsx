'use client'

import { Bot, TriangleAlert } from 'lucide-react'

import { Markdown } from '@/components/chat/markdown'
import type { ChatMessage } from '@/lib/chat/storage'
import { cn } from '@/lib/utils'

/**
 * `fresh` marks a message that arrived during this session rather than one
 * loaded back from storage. Only fresh messages animate — replaying the whole
 * cascade every time a thread is resumed would make history feel slow.
 */
function UserBubble({ content, fresh }: { content: string; fresh: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'max-w-[85%] origin-bottom-right rounded-2xl rounded-tr-sm bg-ink-100 px-4 py-3 text-[15px] leading-relaxed font-light whitespace-pre-wrap text-ink-900 shadow-sm sm:max-w-xl sm:px-5 sm:text-base',
          fresh && 'animate-bubble-in',
        )}
      >
        {content}
      </div>
    </div>
  )
}

/**
 * Retrieved chunks, shown as the "Context Applied" block from the design.
 * Mono, because every value here comes from the vector index.
 */
function ContextApplied({ sources }: { sources: NonNullable<ChatMessage['sources']> }) {
  return (
    <div className="max-w-fit rounded-lg border border-border bg-ink-50 px-3 py-2">
      <span className="mb-1 block text-[10px] font-bold tracking-wider text-ink-400 uppercase">
        Context Applied
      </span>
      {/* <ul className="space-y-0.5 font-mono text-[10px] text-ink-600">
        {sources.map((source, index) => (
          <li key={index} className="flex items-center gap-1.5">
            <span className="h-1 w-1 shrink-0 rounded-full bg-ink-300" />
            <span className="truncate">{source.label || source.source || 'Document'}</span>
            {typeof source.similarity === 'number' ? (
              <span className="text-ink-400">
                {(source.similarity * 100).toFixed(0)}%
              </span>
            ) : null}
          </li>
        ))}
      </ul> */}
    </div>
  )
}

/**
 * The answer sits in its own surface bubble, mirroring the user's — Design.md
 * specifies `surface` for system bubbles. Cornered on the avatar side so the
 * pair reads as a conversation rather than two unrelated blocks.
 */
function AssistantMessage({
  message,
  fresh,
}: {
  message: ChatMessage
  fresh: boolean
}) {
  return (
    <div className="flex gap-2.5 sm:gap-4">
      <div
        className={cn(
          'mt-1 flex h-8 w-8 shrink-0 origin-bottom items-center justify-center rounded-lg shadow-soft',
          message.failed ? 'bg-alert/10 text-alert' : 'bg-ink-900 text-brand',
          fresh && 'animate-bubble-in',
        )}
      >
        {message.failed ? (
          <TriangleAlert className="h-4 w-4" />
        ) : (
          <Bot className="h-4.5 w-4.5" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-3">
        {message.sources?.length ? <ContextApplied sources={message.sources} /> : null}

        <div
          className={cn(
            'origin-bottom-left overflow-hidden rounded-2xl rounded-tl-sm border px-4 py-3.5 shadow-soft sm:px-5 sm:py-4',
            message.failed
              ? 'border-alert/20 bg-alert/5'
              : 'border-border bg-surface',
            fresh && 'animate-bubble-in',
          )}
        >
          {message.failed ? (
            // Failure text is ours, not the model's — plain, no markdown pass.
            <div className="text-[15px] leading-relaxed whitespace-pre-wrap text-alert sm:text-base">
              {message.content}
            </div>
          ) : (
            <Markdown reveal={fresh}>{message.content}</Markdown>
          )}
        </div>
      </div>
    </div>
  )
}

export function MessageList({
  messages,
  freshIds,
}: {
  messages: ChatMessage[]
  freshIds: ReadonlySet<string>
}) {
  return (
    <>
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserBubble
            key={message.id}
            content={message.content}
            fresh={freshIds.has(message.id)}
          />
        ) : (
          <AssistantMessage
            key={message.id}
            message={message}
            fresh={freshIds.has(message.id)}
          />
        ),
      )}
    </>
  )
}
