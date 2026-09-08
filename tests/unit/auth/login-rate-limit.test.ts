import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  loginRateLimited,
  resetLoginRateLimit,
} from '@/server/auth/login-rate-limit'

/**
 * The login limiter had a `resetLoginRateLimit` marked "test helper" and no
 * test using it, so the only thing exercising it was the Playwright suite —
 * which tripped it, mid-run, and failed on auth in specs about imports and
 * insights. It is cheap and deterministic to test here, and once it is, the
 * e2e harness has no business fighting it.
 */

const ADDRESS = 'credentials'

beforeEach(() => {
  resetLoginRateLimit()
  delete process.env.ADAPTER_MODE
  delete process.env.E2E_ALLOW_MOCK
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  resetLoginRateLimit()
})

describe('login rate limit', () => {
  it('allows exactly MAX_ATTEMPTS before it starts refusing', () => {
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      expect(loginRateLimited('owner@aurora.test', ADDRESS), `attempt ${i}`).toBe(false)
    }
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)
  })

  it('keeps counting once refused, so a spray cannot walk it back', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 5; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)
  })

  it('buckets per address as well as per email', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', 'credentials')
    expect(loginRateLimited('owner@aurora.test', 'credentials')).toBe(true)
    // A different address is a different bucket — the first attempt there is fine.
    expect(loginRateLimited('owner@aurora.test', '203.0.113.7')).toBe(false)
  })

  it('treats the email case- and whitespace-insensitively', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    expect(loginRateLimited('  OWNER@Aurora.TEST  ', ADDRESS)).toBe(true)
  })

  it('does not leak between accounts', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)
    expect(loginRateLimited('client@aurora.test', ADDRESS)).toBe(false)
  })

  it('forgives once the window has passed', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)

    vi.advanceTimersByTime(WINDOW_MS + 1)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(false)
  })

  it('is still armed one tick before the window closes', () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    vi.advanceTimersByTime(WINDOW_MS - 1)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)
  })
})

describe('the e2e harness exemption', () => {
  /*
   * Both halves of the gate are required, and the second is the one `src/env.ts`
   * says never to set in a real deploy. Either alone must leave the limiter on,
   * or a misconfigured deploy running mock adapters would silently lose it.
   */
  it('stands down for a Playwright run against mock adapters', () => {
    process.env.ADAPTER_MODE = 'mock'
    process.env.E2E_ALLOW_MOCK = '1'
    for (let i = 0; i < MAX_ATTEMPTS * 10; i++) {
      expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(false)
    }
  })

  it('accepts the boolean spelling of the opt-in', () => {
    process.env.ADAPTER_MODE = 'mock'
    process.env.E2E_ALLOW_MOCK = 'true'
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(false)
    }
  })

  it('stays armed on mock adapters without the explicit opt-in', () => {
    process.env.ADAPTER_MODE = 'mock'
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)
  })

  it('stays armed when the opt-in is set but the adapters are real', () => {
    process.env.ADAPTER_MODE = 'live'
    process.env.E2E_ALLOW_MOCK = '1'
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) loginRateLimited('owner@aurora.test', ADDRESS)
    expect(loginRateLimited('owner@aurora.test', ADDRESS)).toBe(true)
  })
})
