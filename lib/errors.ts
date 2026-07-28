/**
 * Turns an unknown thrown value into a readable message.
 *
 * Supabase's error classes (PostgrestError, AuthError) define `message` and
 * friends as non-enumerable, so `console.error('...', error)` prints `{}` and
 * hides the real cause. Always run errors through this before logging them.
 */
export function describeError(error: unknown): string {
  if (!error) return 'Unknown error'

  if (typeof error === 'object') {
    const { message, code, details, hint } = error as {
      message?: string
      code?: string
      details?: string
      hint?: string
    }

    const parts = [message, details, hint].filter(Boolean)
    if (parts.length > 0) {
      return code ? `${parts.join(' — ')} (${code})` : parts.join(' — ')
    }
  }

  if (typeof error === 'string') return error

  return String(error)
}
