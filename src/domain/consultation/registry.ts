import type { Ruleset } from './types'
import { RULESET as V2026_01_01 } from './rules/v2026-01-01'

/**
 * Published rulesets, by version.
 *
 * A published version is immutable. To change behaviour, copy the directory
 * forward, bump the version, edit there, and register it here — so a
 * consultation approved last spring still evaluates to exactly what the
 * stylist saw when they approved it.
 */
const REGISTRY: Record<string, Ruleset> = {
  [V2026_01_01.version]: V2026_01_01,
}

export const DEFAULT_RULESET_VERSION = V2026_01_01.version

export function getRuleset(version?: string | null): Ruleset {
  if (!version) return REGISTRY[DEFAULT_RULESET_VERSION]!
  const found = REGISTRY[version]
  if (!found) {
    throw new Error(
      `Unknown ruleset version "${version}". Published versions are immutable and must stay ` +
        `registered so historical evaluations remain replayable.`,
    )
  }
  return found
}

export function listRulesetVersions(): string[] {
  return Object.keys(REGISTRY).sort()
}

export { V2026_01_01 }
