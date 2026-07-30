/**
 * Best-effort request throttling for the anonymous widget routes.
 *
 * SCOPE, HONESTLY: this is an in-process token bucket. On Vercel it is
 * per-instance, so the effective ceiling is roughly `limit × warm instances`,
 * and it resets on cold start. That is deliberate — it costs nothing, adds no
 * dependency, and stops the realistic abuse case (one page hammering the API,
 * a script looping over a scraped key) dead.
 *
 * It is NOT a defence against a distributed attacker. If widget traffic ever
 * justifies that, swap `consume` for Upstash Redis or Vercel KV; every caller
 * goes through this one function precisely so that swap stays a one-file change.
 */

interface Bucket {
  tokens: number
  updatedAt: number
}

const buckets = new Map<string, Bucket>()

/** Bounds memory if a hostile caller varies the key on every request. */
const MAX_TRACKED_KEYS = 10_000

export interface RateLimitResult {
  ok: boolean
  /** Whole seconds the caller should wait. 0 when allowed. */
  retryAfter: number
  remaining: number
}

/**
 * Continuous refill rather than fixed windows: a fixed window lets a caller
 * spend the whole budget in the last instant of one window and the whole of the
 * next immediately after, which is double the intended rate at the boundary.
 */
export function consume(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  const refillPerMs = limit / (windowSeconds * 1000)

  if (buckets.size > MAX_TRACKED_KEYS) sweep(now, windowSeconds)

  const existing = buckets.get(key)
  const tokens = existing
    ? Math.min(limit, existing.tokens + (now - existing.updatedAt) * refillPerMs)
    : limit

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now })
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)),
      remaining: 0,
    }
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now })
  return { ok: true, retryAfter: 0, remaining: Math.floor(tokens - 1) }
}

/**
 * Drops buckets that have had time to refill completely — those are
 * indistinguishable from a caller that has never been seen, so keeping them
 * costs memory and buys nothing.
 */
function sweep(now: number, windowSeconds: number): void {
  const cutoff = now - windowSeconds * 1000
  for (const [key, bucket] of buckets) {
    if (bucket.updatedAt < cutoff) buckets.delete(key)
  }

  // Still oversized after the sweep means genuine concurrent load rather than
  // stale entries. Insertion order makes the oldest keys the first evicted.
  if (buckets.size > MAX_TRACKED_KEYS) {
    const excess = buckets.size - MAX_TRACKED_KEYS
    let removed = 0
    for (const key of buckets.keys()) {
      buckets.delete(key)
      if (++removed >= excess) break
    }
  }
}

/**
 * Best available client identifier. Vercel sets x-forwarded-for; the left-most
 * entry is the client, the rest are proxies.
 *
 * Spoofable in general, which is why it is only ever one half of a composite
 * key — the other half is the public key, which is bounded by its own limit.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
