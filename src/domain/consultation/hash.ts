import { createHash } from 'node:crypto'

/**
 * Stable, sorted-key JSON. Two structurally equal objects always produce the
 * same string regardless of key insertion order, which is what makes the input
 * and ruleset hashes reproducible across machines and across time.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Date) return value.toISOString()

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) out[k] = sortValue(v)
  return out
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function hashOf(value: unknown): string {
  return sha256(canonicalJson(value))
}
