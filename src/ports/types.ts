/**
 * Shared vocabulary for every port.
 *
 * A port is an interface plus two implementations: a `mock` that needs no
 * credentials and no network, and a `real` one. Both must satisfy the same
 * contract suite (`tests/unit/ports/contract.ts`), which is what stops the
 * mock quietly drifting away from the behaviour it stands in for.
 */

export type AdapterMode = 'mock' | 'real'

/** A real adapter was selected but its credentials are absent. */
export class AdapterNotConfiguredError extends Error {
  constructor(
    readonly port: string,
    readonly missing: readonly string[],
  ) {
    super(
      `The "${port}" port is set to "real" but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set. Either provide credentials or set ${port.toUpperCase()}_ADAPTER=mock.`,
    )
    this.name = 'AdapterNotConfiguredError'
  }
}

/** The provider rejected the request. `retryable` drives job backoff. */
export class AdapterError extends Error {
  constructor(
    readonly port: string,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'AdapterError'
  }
}

export function requireEnv(port: string, values: Record<string, string | undefined>): void {
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length > 0) throw new AdapterNotConfiguredError(port, missing)
}

// ---------------------------------------------------------------------------
// Message sink
// ---------------------------------------------------------------------------

/**
 * Where the mock SMS and email adapters put what they "sent".
 *
 * This exists because `pnpm verify:adapters` runs in the unit test tier, which
 * has NO database and no setup file — deliberately, so domain tests cannot
 * reach one. A mock that wrote straight to `DevOutbox` could not be tested in
 * the tier it belongs to. So the sink is injected: in-memory by default, and
 * the app wires a DevOutbox-backed sink at the composition root.
 */
export interface DeliveredMessage {
  channel: 'SMS' | 'EMAIL'
  to: string
  subject?: string
  body: string
  meta?: Record<string, unknown>
  at: string
}

export interface MessageSink {
  deliver(message: DeliveredMessage): Promise<void>
}

export class InMemoryMessageSink implements MessageSink {
  readonly messages: DeliveredMessage[] = []

  async deliver(message: DeliveredMessage): Promise<void> {
    this.messages.push(message)
  }

  clear(): void {
    this.messages.length = 0
  }

  lastTo(address: string): DeliveredMessage | undefined {
    return [...this.messages].reverse().find((m) => m.to === address)
  }
}

// ---------------------------------------------------------------------------
// Deterministic identifiers
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

/**
 * Stable pseudo-random id for mock adapters.
 *
 * Derived from the input rather than a counter or a clock, so the same call
 * always produces the same id. That is what makes end-to-end runs and recorded
 * fixtures reproducible.
 */
export function mockId(prefix: string, ...parts: unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${prefix}_mock_${digest.slice(0, 24)}`
}

/** A fixed, non-clock timestamp for mock records. Overridable in tests. */
export function mockNow(): string {
  return process.env.MOCK_NOW ?? new Date().toISOString()
}
