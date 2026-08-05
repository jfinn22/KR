import { fitsWithin, merge, overlaps, peakCoverage, subtract, type Interval } from './interval'
import { chainDuration, chainOffersInterleave } from './chain'
import { eachLocalDate, localDateOfEpochMinutes, localTimeToEpochMinutes } from './zoned'
import { ANY_TIME, allowsDate, isNarrowed, startBoundsOn } from './window'
import type {
  AvailabilityRequest,
  AvailabilityResult,
  CandidateResource,
  CandidateStylist,
  PhaseChain,
  PhasePlacement,
  Slot,
} from './types'

/**
 * The availability solver.
 *
 * Pure interval arithmetic over a snapshot the repository layer assembles. It
 * answers one question — "when could this specific plan actually happen?" — and
 * it answers it the way a salon would: the stylist has to be free for the parts
 * that need them, a chair has to exist, and the whole thing has to finish before
 * the lights go off.
 *
 * The database is the final authority on whether a slot is still free; this
 * proposes, the exclusion constraint disposes.
 */
export function computeAvailability(request: AvailabilityRequest): AvailabilityResult {
  const { settings, chain } = request
  const excluded: { stylistId: string; reason: string }[] = []

  if (chain.length === 0) {
    return { slots: [], reason: 'FULLY_BOOKED', excluded }
  }

  // --- 1. Which stylists could do this at all? ----------------------------
  const capable = request.candidates.filter((c) => {
    if (
      request.constraints.pinnedStylistId &&
      c.stylistId !== request.constraints.pinnedStylistId
    ) {
      return false
    }
    if (request.requiredSkill) {
      const level = c.skills[request.requiredSkill.code] ?? 0
      if (level < request.requiredSkill.level) {
        excluded.push({
          stylistId: c.stylistId,
          reason: `Not signed off for ${request.requiredSkill.code} at level ${request.requiredSkill.level}`,
        })
        return false
      }
    }
    if (request.isNewClient && !c.acceptsNewClients) {
      excluded.push({ stylistId: c.stylistId, reason: 'Not taking new clients' })
      return false
    }
    return true
  })

  if (capable.length === 0) {
    return { slots: [], reason: 'NO_CAPABLE_STYLIST', excluded }
  }

  // --- 2. The window we are allowed to offer -----------------------------
  const totalMin = chainDuration(chain)
  const horizonEnd = request.nowMin + settings.maxAdvanceDays * 1440
  const windowStart = Math.max(
    request.nowMin + settings.minBookingLeadMin,
    request.constraints.notBeforeMin ?? -Infinity,
  )
  const windowEnd = Math.min(horizonEnd, request.constraints.notAfterMin ?? Infinity)

  if (windowStart >= windowEnd) {
    return { slots: [], reason: 'OUTSIDE_BOOKING_WINDOW', excluded }
  }

  /*
   * What somebody said they could actually do — Tuesdays, mornings, before the
   * wedding. Applied here rather than by filtering the finished list so a
   * narrowed search does not burn its per-day cap on times it is about to
   * throw away, and so a day that is ruled out is never solved at all.
   */
  const window = request.constraints.window ?? ANY_TIME
  const narrowed = isNarrowed(window)

  const dates = eachLocalDate(request.fromDate, request.toDate).filter(
    (localDate) => !narrowed || allowsDate(window, localDate, request.timeZone),
  )
  if (dates.length === 0) {
    return { slots: [], reason: 'OUTSIDE_BOOKING_WINDOW', excluded }
  }
  const granularity = Math.max(5, settings.slotGranularityMin)
  const offersInterleave = chainOffersInterleave(chain)
  const maxPerDay = request.maxPerDay ?? 8

  const slots: Slot[] = []

  for (const localDate of dates) {
    const open = request.openIntervals[localDate] ?? []
    if (open.length === 0) continue

    const closeAt = Math.max(...open.map((i) => i.end)) + settings.allowFinishAfterCloseMin
    const daySlots: Slot[] = []

    // Same arithmetic `allowsStart` uses, in the shape the start generator wants.
    const bounds = narrowed
      ? startBoundsOn(window, localDate, request.timeZone)
      : { earliest: -Infinity, latest: Infinity }

    for (const stylist of capable) {
      const lead = stylist.leadMinOverride ?? settings.minBookingLeadMin
      const earliest = Math.max(windowStart, request.nowMin + lead, bounds.earliest)

      // Daily ceiling on chemical work — a colourist doing six corrections in a
      // day is how a salon ends up running two hours late by lunchtime.
      if (request.isChemical && stylist.maxDailyChemicalServices !== null) {
        const already = stylist.dailyChemicalCounts[localDate] ?? 0
        if (already >= stylist.maxDailyChemicalServices) {
          continue
        }
      }

      const free = subtract(
        merge([...stylist.workIntervals])
          .flatMap((w) =>
            open.map((o) => ({ start: Math.max(w.start, o.start), end: Math.min(w.end, o.end) })),
          )
          .filter((i) => i.end > i.start),
        stylist.busyIntervals,
      )
      if (free.length === 0) continue

      // The closing grace lets the LAST appointment of the day run a little
      // late — the stylist stays on. It must not extend a mid-day gap, which
      // ends because another client is arriving, not because the day is over.
      const dayClose = Math.max(...open.map((o) => o.end))
      const freeForFit =
        settings.allowFinishAfterCloseMin > 0
          ? free.map((f) =>
              f.end === dayClose
                ? { start: f.start, end: f.end + settings.allowFinishAfterCloseMin }
                : f,
            )
          : free

      const maxConcurrent = stylist.maxConcurrentClients ?? settings.maxConcurrentClients

      // Only ever start where the stylist is free — iterating every granularity
      // step across the day would be mostly wasted work.
      const starts = candidateStarts(
        free,
        granularity,
        earliest,
        Math.min(windowEnd - totalMin, bounds.latest),
      )

      for (const start of starts) {
        const placement = placeChain(chain, start, request.resources)
        if (!placement) continue

        const end = start + totalMin
        if (end > closeAt) continue

        // Every phase that needs the stylist must land in free time.
        const stylistOk = placement.every(
          (p) => !needsStylist(chain, p.index) || fitsWithin(freeForFit, p.interval),
        )
        if (!stylistOk) continue

        // Concurrency: how many clients would this stylist have at once?
        const span: Interval = { start, end }
        const concurrent = peakCoverage(stylist.clientIntervals, span) + 1
        if (concurrent > maxConcurrent) continue

        daySlots.push({
          startMin: start,
          endMin: end,
          stylistId: stylist.stylistId,
          localDate,
          placements: placement,
          offersInterleave,
          score: scoreSlot({ start, end }, free, stylist, request),
        })
      }
    }

    daySlots.sort((a, b) => b.score - a.score || a.startMin - b.startMin)
    slots.push(...daySlots.slice(0, maxPerDay))
  }

  slots.sort((a, b) => a.startMin - b.startMin || b.score - a.score)

  return {
    slots,
    reason: slots.length === 0 ? 'FULLY_BOOKED' : null,
    excluded,
  }
}

// ---------------------------------------------------------------------------

function needsStylist(chain: PhaseChain, index: number): boolean {
  return chain[index]?.blocksStylist ?? true
}

/**
 * Candidate start times.
 *
 * Aligned to the granularity grid so a salon's book stays tidy — 15-minute
 * starts rather than 09:07 — but clipped to the stylist's free blocks so we do
 * not test thousands of positions inside their lunch break.
 */
function candidateStarts(
  free: readonly Interval[],
  granularity: number,
  earliest: number,
  latest: number,
): number[] {
  const starts: number[] = []
  for (const block of free) {
    const from = Math.max(block.start, earliest)
    const aligned = Math.ceil(from / granularity) * granularity
    for (let t = aligned; t <= Math.min(block.end, latest); t += granularity) {
      starts.push(t)
    }
  }
  return starts
}

/**
 * Lay the chain out from `start` and assign a concrete resource to each phase
 * that needs one.
 *
 * Assigning a specific resource here rather than counting capacity is what lets
 * the database enforce it: "some chair is free" is not a constraint Postgres can
 * check, but "this chair is not double-booked" is.
 */
function placeChain(
  chain: PhaseChain,
  start: number,
  resources: readonly CandidateResource[],
): PhasePlacement[] | null {
  const placements: PhasePlacement[] = []
  // Resources claimed by earlier phases of this same appointment.
  const claimed = new Map<string, Interval[]>()
  let cursor = start

  for (let index = 0; index < chain.length; index++) {
    const link = chain[index]!
    const span: Interval = { start: cursor, end: cursor + link.durationMin }
    cursor = span.end

    let resourceId: string | null = null

    if (link.requiresResourceType) {
      const candidate = resources.find((r) => {
        if (r.type !== link.requiresResourceType) return false
        if (r.busyIntervals.some((b) => overlaps(b, span))) return false
        const mine = claimed.get(r.resourceId) ?? []
        return !mine.some((b) => overlaps(b, span))
      })
      if (!candidate) return null

      resourceId = candidate.resourceId
      claimed.set(candidate.resourceId, [...(claimed.get(candidate.resourceId) ?? []), span])
    }

    placements.push({
      index,
      kind: link.kind,
      label: link.label,
      interval: span,
      resourceId,
    })
  }

  return placements
}

/**
 * Rank slots the way a salon owner would.
 *
 * Gap-fill dominates: a slot that closes a dead 90-minute hole between two
 * bookings is worth far more than one that starts a fresh afternoon, because the
 * hole is revenue the salon has already lost the chance to sell.
 */
function scoreSlot(
  span: Interval,
  free: readonly Interval[],
  stylist: CandidateStylist,
  request: AvailabilityRequest,
): number {
  const block = free.find((f) => f.start <= span.start && f.end >= span.end)
  const blockLength = block ? block.end - block.start : span.end - span.start
  const used = span.end - span.start

  // 1.0 when the booking exactly fills its gap, tailing off as slack grows.
  const tightness = blockLength > 0 ? used / blockLength : 0

  // Sooner is better, but only mildly — a week out should not beat a good fit.
  const daysOut = (span.start - request.nowMin) / 1440
  const recency = 1 / (1 + daysOut / 14)

  // Preference rank is 0 for the client's usual stylist.
  const preference = 1 / (1 + stylist.preferenceRank)

  return Number((tightness * 6 + recency * 2 + preference * 2).toFixed(4))
}

/**
 * Turn a salon's weekly hours into UTC intervals for a set of local dates.
 *
 * Every conversion goes through the zone, so a spring-forward day genuinely is
 * an hour shorter rather than being silently stretched.
 */
export function openIntervalsForDates(
  dates: readonly string[],
  timeZone: string,
  hoursByDayOfWeek: Readonly<Record<number, readonly { startMinute: number; endMinute: number }[]>>,
  closures: readonly Interval[] = [],
): Record<string, Interval[]> {
  const out: Record<string, Interval[]> = {}

  for (const date of dates) {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay()
    const shifts = hoursByDayOfWeek[dow] ?? []
    const intervals = shifts
      .map((s) => ({
        start: localTimeToEpochMinutes(date, s.startMinute, timeZone),
        end: localTimeToEpochMinutes(date, s.endMinute, timeZone),
      }))
      .filter((i) => i.end > i.start)

    out[date] = closures.length > 0 ? subtract(intervals, closures) : merge(intervals)
  }

  return out
}

/** Group slots by the local day they fall on, for rendering a picker. */
export function groupByLocalDate(slots: readonly Slot[], timeZone: string): Record<string, Slot[]> {
  const out: Record<string, Slot[]> = {}
  for (const slot of slots) {
    const key = slot.localDate || localDateOfEpochMinutes(slot.startMin, timeZone)
    ;(out[key] ??= []).push(slot)
  }
  return out
}
