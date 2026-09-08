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

export const WINDOW_MS = 15 * 60_000
export const MAX_ATTEMPTS = 10
const buckets = new Map<string, Bucket>()

function keyFor(email: string, address: string): string {
  return createHash('sha256').update(`${email.toLowerCase().trim()}|${address}`).digest('hex')
}

/**
 * The Playwright suite is not a password spray.
 *
 * Every e2e test signs in, and most of them sign in as the same owner, so a
 * full run makes far more than ten attempts on one address inside the fifteen
 * minute window. Past the tenth, `authorize` returns null for the rest of the
 * run and the suite fails with CredentialsSignin on tests that have nothing to
 * do with auth — which reads as "login is broken" rather than "the harness
 * tripped a limiter working exactly as designed". The buckets are in-process,
 * so there is no way to clear them from the test runner either.
 *
 * The gate is the one `src/env.ts` already defines for this: a production build
 * running against mock adapters, opted into explicitly. `ADAPTER_MODE` is never
 * `mock` in a real deploy — production refuses to boot that way unless
 * `E2E_ALLOW_MOCK` is set, which the env schema documents as "never set this in
 * a real deploy". So this cannot disarm the limiter anywhere it matters.
 *
 * Read at call time rather than at module load: the e2e server sets these in
 * its own environment, and a module-level constant would bake in whatever the
 * build happened to see.
 */
function isE2eHarness(): boolean {
  return (
    process.env.ADAPTER_MODE === 'mock' &&
    (process.env.E2E_ALLOW_MOCK === '1' || process.env.E2E_ALLOW_MOCK === 'true')
  )
}

export function loginRateLimited(email: string, address: string): boolean {
  if (isE2eHarness()) return false

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
