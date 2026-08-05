import type { DepositBand as RiskBand } from '@/domain/consultation/types'
import { computeDeposit, type DepositPolicySnapshot, type DepositBand } from './pricing'

/**
 * Who decides what a deposit is.
 *
 * Until now, two things did. The rules engine computed a figure from its own
 * hardcoded percentages and that figure was persisted onto `ServicePlan`; the
 * till computed a different figure from the salon's actual `DepositPolicy` row
 * and charged that. Nothing mapped between them — the engine's band is a
 * number 0–3 and the till's is a string — so a client was quoted one number and
 * asked for another, and neither side knew.
 *
 * This makes commerce the authority, which is the right way round: the engine
 * knows how risky a job is, and a salon knows what it charges. The engine keeps
 * returning a BAND and stops returning money.
 *
 * The order of precedence, most specific first:
 *
 *  1. The policy attached to the service (`Service.depositPolicyId`), which has
 *     been in the schema since it was written and read by nothing.
 *  2. The salon's default policy.
 *  3. The colour floor — a chemical service with no policy at all takes $50,
 *     because a salon that has not configured deposits still loses a four-hour
 *     colour slot when somebody does not turn up.
 *
 * And one rule over the top of all three: the risk band may RAISE the amount,
 * never lower it. A salon that says 20% means at least 20%; the engine deciding
 * somebody is low-risk is not permission to charge them less than the salon's
 * own terms.
 */

/** Cents a chemical service takes when the salon has configured nothing. */
export const COLOUR_FLOOR_CENTS = 5_000

/** The engine's 0–3 band, in the words the policy tiers are keyed by. */
const BAND_NAMES: Record<RiskBand, DepositBand> = {
  0: 'NONE',
  1: 'LOW',
  2: 'STANDARD',
  3: 'HIGH',
}

export function bandName(band: RiskBand): DepositBand {
  return BAND_NAMES[band] ?? 'STANDARD'
}

export interface DepositDecision {
  amountCents: number
  /** What the client is told, in one sentence. */
  rationale: string
  refundableUntilHours: number
  /** Which of the three sources set the figure, for the audit trail. */
  source: 'SERVICE_POLICY' | 'SALON_POLICY' | 'COLOUR_FLOOR' | 'NONE'
  /** True when the risk band pushed it above what the policy alone would take. */
  raisedByRisk: boolean
}

export interface DepositInput {
  /** The policy on the most specific service in the basket, if it has one. */
  servicePolicy?: DepositPolicySnapshot | null
  /** The salon's default. */
  salonPolicy?: DepositPolicySnapshot | null
  /** From the rules engine. Risk, not money. */
  band: RiskBand
  /** Any chemical service in the basket — what the colour floor keys on. */
  isChemical: boolean
  serviceTotalCents: number
  /** The salon's absolute ceiling, whatever any policy says. */
  capCents?: number
}

/**
 * The one place a deposit becomes a number.
 *
 * Pure, so the figure a client is quoted at approval and the figure the till
 * asks for are the same arithmetic on the same inputs rather than two
 * implementations that agree by coincidence until they do not.
 */
export function decideDeposit(input: DepositInput): DepositDecision {
  const band = bandName(input.band)
  const policy = input.servicePolicy ?? input.salonPolicy ?? null
  const source = input.servicePolicy
    ? 'SERVICE_POLICY'
    : input.salonPolicy
      ? 'SALON_POLICY'
      : input.isChemical
        ? 'COLOUR_FLOOR'
        : 'NONE'

  /*
   * No policy anywhere. A cut takes nothing — the salon loses 45 minutes and
   * can usually fill it. A colour takes the floor, because the slot is four
   * hours long and a no-show on it is most of a day's takings from that chair.
   */
  if (!policy) {
    if (!input.isChemical) {
      return {
        amountCents: 0,
        rationale: 'No deposit needed for this booking.',
        refundableUntilHours: 48,
        source: 'NONE',
        raisedByRisk: false,
      }
    }

    const floor = Math.min(COLOUR_FLOOR_CENTS, input.serviceTotalCents)
    return {
      amountCents: capped(floor, input.capCents),
      rationale: 'A deposit to hold a colour appointment. It comes off your final bill.',
      refundableUntilHours: 48,
      source: 'COLOUR_FLOOR',
      raisedByRisk: false,
    }
  }

  /*
   * The policy's own answer, computed at STANDARD — the band the salon's rates
   * are written for. This is the baseline the risk band may raise from.
   */
  const base = computeDeposit({
    policy,
    band: 'STANDARD',
    serviceTotalCents: input.serviceTotalCents,
    capCents: input.capCents,
  })

  const risked = computeDeposit({
    policy,
    band,
    serviceTotalCents: input.serviceTotalCents,
    capCents: input.capCents,
  })

  /*
   * Raise, never lower. `Math.max` rather than taking the banded figure
   * outright, because a TIERED policy with a low tier for LOW would otherwise
   * let the engine discount the salon's own terms — and a deposit quietly
   * smaller than the price list is a decision no owner made.
   *
   * The one exception is a band of NONE with a policy that also takes nothing,
   * which is already zero on both sides.
   */
  const amountCents = Math.max(base.amountCents, risked.amountCents)
  const raisedByRisk = amountCents > base.amountCents

  return {
    amountCents,
    rationale: raisedByRisk
      ? `${risked.rationale} This booking carries more risk than usual, so the deposit is higher.`
      : base.rationale,
    refundableUntilHours: risked.refundableUntilHours,
    source,
    raisedByRisk,
  }
}

function capped(value: number, capCents?: number): number {
  const rounded = Math.max(0, Math.round(value))
  return capCents === undefined ? rounded : Math.min(rounded, capCents)
}
