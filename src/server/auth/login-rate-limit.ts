import { createHash } from 'node:crypto'

/**
 * Best-effort login spray protection.
 *
 * Buckets are in-process: fine for a single Node worker and for CI. Put an
 * edge rate limit in front of `/api/auth` in multi-instance production — this
 * is the application-level floor, not the whole ceiling.
 */

interface Bucket {
  count: number
  resetAt: number
}

const WINDOW_MS = 15 * 60_000
const MAX_ATTEMPTS = 10
const buckets = new Map<string, Bucket>()

function keyFor(email: string, address: string): string {
  return createHash('sha256').update(`${email.toLowerCase().trim()}|${address}`).digest('hex')
}

export function loginRateLimited(email: string, address: string): boolean {
  const key = keyFor(email, address)
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  bucket.count += 1
  return bucket.count > MAX_ATTEMPTS
}

/** Test helper. */
export function resetLoginRateLimit(): void {
  buckets.clear()
}
