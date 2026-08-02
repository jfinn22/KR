import { computeAvailability } from './availability'
import { addDays, localDateOfEpochMinutes } from './zoned'
import type { AvailabilityRequest, PhaseChain, Slot } from './types'

/**
 * Booking a whole multi-session plan at once.
 *
 * A correction plan is only honest if the client can actually get all three
 * appointments. Offering session one and hoping session two exists in eight
 * weeks is how a salon ends up with a half-finished blonde and an angry client,
 * so the whole sequence is solved together.
 */

export interface PlannedSessionRequest {
  sequence: number
  label: string
  chain: PhaseChain
  minDaysAfterPrevious: number | null
  maxDaysAfterPrevious: number | null
  /** Continuity: the same stylist must do every session. */
  requiresSameStylist: boolean
}

export interface MultiSessionRequest {
  sessions: readonly PlannedSessionRequest[]
  /** Everything except the chain and the date window, which vary per session. */
  base: Omit<AvailabilityRequest, 'chain' | 'fromDate' | 'toDate' | 'constraints'>
  searchFromDate: string
  /** How far past the earliest date to look for each session. */
  searchWindowDays: number
  pinnedStylistId: string | null
}

export interface MultiSessionResult {
  /** One slot per session, in order. Empty when no complete plan is possible. */
  booking: readonly Slot[]
  complete: boolean
  /** The first session that could not be placed, when incomplete. */
  failedAtSequence: number | null
  reason: string | null
}

/** Bounded so a pathological plan cannot spin. */
const MAX_BRANCH_PER_SESSION = 20

/**
 * Depth-first with backtracking.
 *
 * Greedy-earliest alone fails a real case: taking the very first slot for
 * session one can push session two past its maximum gap, when starting a day
 * later would have let the whole sequence land. So a dead end unwinds and tries
 * the next candidate rather than giving up.
 */
export function solveMultiSession(request: MultiSessionRequest): MultiSessionResult {
  const ordered = [...request.sessions].sort((a, b) => a.sequence - b.sequence)
  if (ordered.length === 0) {
    return { booking: [], complete: true, failedAtSequence: null, reason: null }
  }

  const chosen: Slot[] = []
  let deepestFailure = ordered[0]!.sequence
  let failureReason: string | null = null

  const search = (index: number): boolean => {
    if (index >= ordered.length) return true

    const session = ordered[index]!
    const previous = chosen[index - 1]
    const timeZone = request.base.timeZone

    let fromDate = request.searchFromDate
    let latestMin: number | null = null

    if (previous) {
      const previousDate = localDateOfEpochMinutes(previous.endMin, timeZone)
      fromDate = addDays(previousDate, session.minDaysAfterPrevious ?? 0)
      if (session.maxDaysAfterPrevious !== null) {
        // The gap is measured from the end of the previous appointment.
        latestMin = previous.endMin + session.maxDaysAfterPrevious * 1440
      }
    }

    const toDate = addDays(fromDate, request.searchWindowDays)

    const pinned =
      session.requiresSameStylist && previous
        ? previous.stylistId
        : (request.pinnedStylistId ?? null)

    const result = computeAvailability({
      ...request.base,
      chain: session.chain,
      fromDate,
      toDate,
      constraints: {
        earliestMin: previous ? previous.endMin : null,
        latestMin,
        pinnedStylistId: pinned,
      },
    })

    if (result.slots.length === 0) {
      if (session.sequence >= deepestFailure) {
        deepestFailure = session.sequence
        failureReason =
          result.reason === 'NO_CAPABLE_STYLIST'
            ? 'No stylist is signed off for this session.'
            : previous
              ? `Nothing available within the ${session.minDaysAfterPrevious ?? 0}–${
                  session.maxDaysAfterPrevious ?? '∞'
                } day window after the previous session.`
              : 'Nothing available in the search window.'
      }
      return false
    }

    for (const candidate of result.slots.slice(0, MAX_BRANCH_PER_SESSION)) {
      chosen[index] = candidate
      if (search(index + 1)) return true
    }

    chosen.length = index
    return false
  }

  const complete = search(0)

  return {
    booking: complete ? chosen : chosen.slice(),
    complete,
    failedAtSequence: complete ? null : deepestFailure,
    reason: complete ? null : failureReason,
  }
}

/**
 * Whether a session may be booked yet, given what has actually happened.
 *
 * Session two of a lightening plan is not bookable until session one is done —
 * not merely booked. The hair has to have had the six weeks.
 */
export function sessionIsBookable(input: {
  sequence: number
  minDaysAfterPrevious: number | null
  previousCompletedAtMin: number | null
  previousStatus: 'PLANNED' | 'BOOKED' | 'COMPLETED' | 'SKIPPED' | 'CANCELLED' | null
  nowMin: number
}): { bookable: boolean; earliestMin: number | null; reason: string | null } {
  if (input.sequence === 1) return { bookable: true, earliestMin: null, reason: null }

  if (input.previousStatus === 'SKIPPED' || input.previousStatus === 'CANCELLED') {
    return { bookable: true, earliestMin: null, reason: null }
  }

  if (input.previousStatus !== 'COMPLETED' || input.previousCompletedAtMin === null) {
    return {
      bookable: false,
      earliestMin: null,
      reason: 'The previous session in this plan has not happened yet.',
    }
  }

  const earliest = input.previousCompletedAtMin + (input.minDaysAfterPrevious ?? 0) * 1440
  if (input.nowMin < earliest && (input.minDaysAfterPrevious ?? 0) > 0) {
    const days = Math.ceil((earliest - input.nowMin) / 1440)
    return {
      bookable: true,
      earliestMin: earliest,
      reason: `Your hair needs another ${days} day${days === 1 ? '' : 's'} before this session.`,
    }
  }

  return { bookable: true, earliestMin: earliest, reason: null }
}
