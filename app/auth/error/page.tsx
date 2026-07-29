import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

import { AuthShell } from '@/components/cerebros/auth-shell'
import { btnClass } from '@/components/cerebros/ui'

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>
}) {
  const params = await searchParams

  return (
    <AuthShell
      title="Sorry, something went wrong"
      subtitle="That sign-in link could not be completed."
      badge="ERROR"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-alert/20 bg-alert/5 p-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-alert/10 text-alert">
            <TriangleAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            {params?.error ? (
              <>
                <span className="block text-[10px] font-bold tracking-wider text-ink-400 uppercase">
                  Code
                </span>
                <code className="mt-1 block font-mono text-xs break-all text-ink-900">
                  {params.error}
                </code>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-ink-600">
                An unspecified error occurred.
              </p>
            )}
          </div>
        </div>

        <Link href="/auth/login" className={btnClass('primary', 'lg', 'w-full')}>
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
