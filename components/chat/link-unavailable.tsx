import { Link2Off, Unplug } from 'lucide-react'

export type UnavailableReason = 'malformed' | 'revoked'

/**
 * Terminal state for a public chat link that cannot work.
 *
 * Deliberately calm — no alert red, no error codes. The visitor did nothing
 * wrong and has no way to fix it themselves, so the page states what happened
 * and points them at the one person who can help.
 *
 * The two reasons are genuinely distinguishable: `malformed` means the key
 * could not belong to any workspace (checked locally, no request made), while
 * `revoked` means the workflow refused it. Nothing here reveals whether a
 * workspace exists, so a guessed key learns nothing from the wording.
 */
export function ChatLinkUnavailable({ reason }: { reason: UnavailableReason }) {
  const copy =
    reason === 'malformed'
      ? {
          icon: <Link2Off className="h-6 w-6" />,
          title: 'This chat link looks incomplete',
          body: 'The address is missing part of its workspace key — links often get cut short when they are copied out of a message or an email.',
          hint: 'Ask whoever shared it to send the full link.',
        }
      : {
          icon: <Unplug className="h-6 w-6" />,
          title: 'This chat link is no longer active',
          body: 'The workspace behind it has been removed, or its link was regenerated — which retires every link shared before it.',
          hint: 'Ask whoever shared it for the current link.',
        }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md animate-slide-up">
        <div className="rounded-xl border border-border bg-surface p-6 text-center shadow-elevated sm:p-8">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-ink-50 text-ink-400">
            {copy.icon}
          </div>

          <h1 className="text-lg font-semibold tracking-tight text-balance text-ink-900">
            {copy.title}
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-pretty text-ink-500">
            {copy.body}
          </p>

          <p className="mt-5 border-t border-border/60 pt-5 text-xs leading-relaxed text-ink-400">
            {copy.hint}
          </p>
        </div>

        <p className="mt-6 text-center font-mono text-[10px] tracking-wider text-ink-300 uppercase">
          Nothing you typed was sent anywhere
        </p>
      </div>
    </div>
  )
}
