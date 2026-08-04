import { describe, expect, it } from 'vitest'
import { chainStats, releasesStylist, type PhaseDraft } from '@/domain/scheduling/chain-stats'
import { buildChain, chainStylistMinutes } from '@/domain/scheduling/chain'

/**
 * The phase editor and the solver must agree about what is free.
 *
 * They did not. This module carried its own `INTERLEAVE_MIN = 20` while
 * `applyInterleavePolicy` used the salon's `minInterleaveMin`, default 25 — and
 * it ignored `interleaveEnabled` entirely, which is OFF by default. So a fresh
 * salon splitting out a 40-minute processing phase was shown a gold "free to
 * hand on" figure for time the calendar would never release, and the front desk
 * would find the gap unbookable.
 *
 * These tests assert the editor's arithmetic against the real chain builder
 * rather than against a copy of its rules.
 */

const ON = { interleaveEnabled: true, minInterleaveMin: 25 }
const OFF = { interleaveEnabled: false, minInterleaveMin: 25 }

const active = (min: number): PhaseDraft => ({
  kind: 'ACTIVE',
  label: 'Application',
  durationMin: min,
  requiresStylist: true,
  requiresResourceType: 'CHAIR',
  isScalable: true,
})

const processing = (min: number): PhaseDraft => ({
  kind: 'PROCESSING',
  label: 'Processing',
  durationMin: min,
  requiresStylist: false,
  requiresResourceType: 'PROCESSING_SEAT',
  isScalable: false,
})

/** The seeded balayage: 90 active / 40 processing / 45 active. */
const BALAYAGE = [active(90), processing(40), active(45)]

describe('chainStats against the salon policy', () => {
  it('releases a long enough gap when the salon has opted in', () => {
    const stats = chainStats(BALAYAGE, ON)
    expect(stats.totalMin).toBe(175)
    expect(stats.stylistMin).toBe(135)
    expect(stats.interleavableMin).toBe(40)
  })

  it('releases nothing when the salon has interleaving switched off', () => {
    const stats = chainStats(BALAYAGE, OFF)
    expect(stats.totalMin).toBe(175)
    // The stylist is held for the processing too — which is what the solver
    // does, and what the editor used to hide.
    expect(stats.stylistMin).toBe(175)
    expect(stats.interleavableMin).toBe(0)
  })

  it('withholds a gap under the salon minimum', () => {
    // 20 minutes cleared the old hardcoded threshold and fails the real one.
    const stats = chainStats([active(60), processing(20), active(30)], ON)
    expect(stats.interleavableMin).toBe(0)
    expect(stats.stylistMin).toBe(110)
  })

  it('combines adjacent freed phases into one stretch', () => {
    const stats = chainStats([active(30), processing(30), processing(30), active(20)], ON)
    expect(stats.interleavableMin).toBe(60)
  })

  it('counts a trailing gap, because the stylist is released before the end', () => {
    const stats = chainStats([active(45), processing(30)], ON)
    expect(stats.interleavableMin).toBe(30)
  })

  it('treats a non-processing phase that needs nobody as simply free', () => {
    // The solver's policy only gates PROCESSING, so this must not be gated
    // either — the two have to agree on the edge case as well as the norm.
    const dryer: PhaseDraft = { ...processing(15), kind: 'ACTIVE' }
    expect(releasesStylist(dryer, ON)).toBe(true)
    expect(releasesStylist(dryer, OFF)).toBe(true)
  })
})

describe('the editor agrees with the chain the solver actually places', () => {
  const spec = {
    serviceId: 'svc_balayage',
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    phases: BALAYAGE.map((phase, index) => ({
      sequence: index,
      kind: phase.kind,
      label: phase.label,
      durationMin: phase.durationMin,
      requiresStylist: phase.requiresStylist,
      requiresResourceType: phase.requiresResourceType,
      isScalable: phase.isScalable,
    })),
  }

  it.each([
    ['opted in', ON],
    ['opted out', OFF],
  ])('holds the same stylist minutes when %s', (_label, settings) => {
    const chain = buildChain([spec], {
      settings: {
        slotGranularityMin: 15,
        minBookingLeadMin: 120,
        maxAdvanceDays: 90,
        allowFinishAfterCloseMin: 15,
        maxConcurrentClients: 2,
        ...settings,
      },
    })

    expect(chainStats(BALAYAGE, settings).stylistMin).toBe(chainStylistMinutes(chain))
  })
})
