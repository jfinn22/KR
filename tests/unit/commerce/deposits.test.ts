import { describe, expect, it } from 'vitest'
import { COLOUR_FLOOR_CENTS, bandName, decideDeposit } from '@/domain/commerce/deposits'
import type { DepositPolicySnapshot } from '@/domain/commerce/pricing'

/**
 * Who decides what a deposit is.
 *
 * Until this existed, two things did: the rules engine computed a figure from
 * percentages hardcoded in its own file and that figure was persisted onto the
 * plan, while the till computed a different one from the salon's actual policy
 * row. Nothing mapped between them — one band is a number 0–3 and the other is
 * a string — so a client could be quoted one number and asked for another, and
 * neither side would ever know.
 */

const PERCENT: DepositPolicySnapshot = {
  mode: 'PERCENT',
  percentBps: 2000,
  minCents: 2500,
  refundableUntilHours: 48,
}

const FLAT: DepositPolicySnapshot = {
  mode: 'FLAT',
  flatCents: 10_000,
  minCents: 0,
  refundableUntilHours: 72,
}

const base = {
  band: 2 as const,
  isChemical: true,
  serviceTotalCents: 22_000,
}

describe('translating the engine’s band', () => {
  it('names every band the policy tiers are keyed by', () => {
    expect(bandName(0)).toBe('NONE')
    expect(bandName(1)).toBe('LOW')
    expect(bandName(2)).toBe('STANDARD')
    expect(bandName(3)).toBe('HIGH')
  })
})

describe('which policy wins', () => {
  it('takes the one attached to the service over the salon default', () => {
    const result = decideDeposit({ ...base, servicePolicy: FLAT, salonPolicy: PERCENT })
    expect(result.amountCents).toBe(10_000)
    expect(result.source).toBe('SERVICE_POLICY')
  })

  it('falls back to the salon default', () => {
    const result = decideDeposit({ ...base, salonPolicy: PERCENT })
    expect(result.amountCents).toBe(4_400)
    expect(result.source).toBe('SALON_POLICY')
  })
})

describe('a salon that has configured nothing', () => {
  /*
   * The $50 colour floor. A salon with no deposit policy still loses a
   * four-hour slot when somebody does not turn up, and most of a day's takings
   * from that chair with it.
   */
  it('still takes something for a colour', () => {
    const result = decideDeposit({ ...base, isChemical: true })
    expect(result.amountCents).toBe(COLOUR_FLOOR_CENTS)
    expect(result.source).toBe('COLOUR_FLOOR')
  })

  it('takes nothing for a cut, which can usually be filled', () => {
    const result = decideDeposit({ ...base, isChemical: false })
    expect(result.amountCents).toBe(0)
    expect(result.source).toBe('NONE')
  })

  // A deposit larger than the job reads to a client as a scam.
  it('never asks for more than the appointment is worth', () => {
    const result = decideDeposit({ ...base, isChemical: true, serviceTotalCents: 3_000 })
    expect(result.amountCents).toBe(3_000)
  })

  it('yields to a real policy the moment there is one', () => {
    const result = decideDeposit({ ...base, salonPolicy: PERCENT })
    expect(result.source).toBe('SALON_POLICY')
    expect(result.amountCents).not.toBe(COLOUR_FLOOR_CENTS)
  })
})

describe('what the risk band may do', () => {
  const tiered: DepositPolicySnapshot = {
    mode: 'TIERED',
    percentBps: 2000,
    minCents: 0,
    refundableUntilHours: 48,
    tiers: {
      LOW: { percentBps: 1000 },
      STANDARD: { percentBps: 2000 },
      HIGH: { percentBps: 5000 },
    },
  }

  it('raises the figure for a risky booking', () => {
    const result = decideDeposit({ ...base, band: 3, salonPolicy: tiered })
    expect(result.amountCents).toBe(11_000)
    expect(result.raisedByRisk).toBe(true)
    expect(result.rationale).toMatch(/more risk/i)
  })

  /*
   * The rule the whole function exists for. A salon that says 20% means at
   * least 20% — the engine deciding somebody is low-risk is not permission to
   * charge them less than the salon's own terms, and a deposit quietly smaller
   * than the price list is a decision no owner made.
   */
  it('never lowers it, however safe the client looks', () => {
    const result = decideDeposit({ ...base, band: 1, salonPolicy: tiered })
    expect(result.amountCents).toBe(4_400)
    expect(result.raisedByRisk).toBe(false)
  })

  it('holds the line even at band zero', () => {
    const result = decideDeposit({ ...base, band: 0, salonPolicy: PERCENT })
    expect(result.amountCents).toBe(4_400)
  })
})

describe('the salon’s ceiling', () => {
  it('caps whatever any policy would have taken', () => {
    const result = decideDeposit({
      ...base,
      salonPolicy: { ...PERCENT, percentBps: 9000 },
      capCents: 5_000,
    })
    expect(result.amountCents).toBe(5_000)
  })

  it('caps the colour floor too', () => {
    const result = decideDeposit({ ...base, isChemical: true, capCents: 2_000 })
    expect(result.amountCents).toBe(2_000)
  })
})

describe('what the client is told', () => {
  it('always says something, even at zero', () => {
    expect(decideDeposit({ ...base, isChemical: false }).rationale).toBeTruthy()
  })

  it('carries the refund window off the policy', () => {
    expect(decideDeposit({ ...base, salonPolicy: FLAT }).refundableUntilHours).toBe(72)
  })
})
