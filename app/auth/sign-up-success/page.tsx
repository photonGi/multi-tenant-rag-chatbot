import Link from 'next/link'
import { MailCheck } from 'lucide-react'

import { AuthShell } from '@/components/console/auth-shell'
import { btnClass } from '@/components/console/ui'

export default function SignUpSuccessPage() {
  return (
    <AuthShell
      title="Check your email"
      subtitle="Confirm your address to finish setting up the account."
      badge="PENDING"
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-ink-50 p-4">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
            <MailCheck className="h-4 w-4" />
          </span>
          <p className="text-xs leading-relaxed text-ink-600">
            We sent a confirmation link to the address you signed up with. Open it to
            activate the account, then sign in.
          </p>
        </div>

        <Link href="/auth/login" className={btnClass('primary', 'lg', 'w-full')}>
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
