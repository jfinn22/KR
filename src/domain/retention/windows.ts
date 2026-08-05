/**
 * Whether somebody came back, and whether it is fair to ask yet.
 *
 * Pure, because every one of these is a definition rather than a query, and a
 * definition that lives inside a Prisma call is a definition nobody can check.
 * The measurement traps here are not exotic — they are the two that make almost
 * every retention dashboard quietly wrong.
 */

/**
 * How long after a visit a return still counts as coming back.
 *
 * Ninety days, not thirty. A colour client on a six-week cycle and a cut client
 * on a twelve-week one are both loyal, and a window that only sees the first
 * makes the second look like churn — which turns a rebook figure into an
 * argument about hair rather than a measure of the business.
 */
export const REBOOK_WINDOW_DAYS = 90

/**
 * How long a first-timer gets before anyone worries.
 *
 * Thirty days is the point at which a salon can still do something about it —
 * long enough not to chase somebody who was always coming back in six weeks,
 * short enough that the memory of the visit is still there when the salon calls.
 */
export const FIRST_TIMER_GRACE_DAYS = 30

const DAY_MS = 86_400_000

export interface Visit {
  clientProfileId: string
  stylistProfileId: string
  at: Date
}

export interface RebookRate {
  stylistProfileId: string
  /** Visits in the period that had time to be followed by another. */
  eligible: number
  /** How many of those were. */
  returned: number
  /** Null when nothing was eligible — never 0, which reads as "nobody came back". */
  rate: number | null
}

/**
 * What fraction of a stylist's clients came back.
 *
 * Two things this refuses to do, and both are why it is a function rather than
 * a query.
 *
 * It will not count a visit that has not had its window yet. A client seen last
 * Tuesday has not failed to return — they have not been asked to. Counting them
 * as a failure drags every recent period downwards, which makes the number
 * always look worse than the salon is, and always improve when you stop looking.
 *
 * And it counts a return anywhere in the salon, not just to the same stylist. A
 * client who came back and saw somebody else is a client the salon kept. The
 * stylist-level cut is about who brought them in, and blaming a colourist for a
 * client who booked a cut with somebody else is how a good number turns into a
 * bad argument.
 */
export function rebookRates(
  visits: readonly Visit[],
  /** Every visit in the salon, including outside the period, for the return test. */
  allVisits: readonly Visit[],
  asOf: Date,
  windowDays = REBOOK_WINDOW_DAYS,
): RebookRate[] {
  const byClient = new Map<string, number[]>()
  for (const visit of allVisits) {
    const times = byClient.get(visit.clientProfileId) ?? []
    times.push(visit.at.getTime())
    byClient.set(visit.clientProfileId, times)
  }
  for (const times of byClient.values()) times.sort((a, b) => a - b)

  const windowMs = windowDays * DAY_MS
  const tally = new Map<string, { eligible: number; returned: number }>()

  for (const visit of visits) {
    const at = visit.at.getTime()
    const returnedBy = at + windowMs

    const times = byClient.get(visit.clientProfileId) ?? []
    const cameBack = times.some((time) => time > at && time <= returnedBy)

    /*
     * Mature, or already answered. A visit whose window has not closed is only
     * counted if the client has ALREADY come back — that is a fact, not a
     * prediction, and dropping it would understate a salon that is doing well
     * right now.
     */
    if (!cameBack && returnedBy > asOf.getTime()) continue

    const row = tally.get(visit.stylistProfileId) ?? { eligible: 0, returned: 0 }
    row.eligible += 1
    if (cameBack) row.returned += 1
    tally.set(visit.stylistProfileId, row)
  }

  return [...tally.entries()]
    .map(([stylistProfileId, row]) => ({
      stylistProfileId,
      eligible: row.eligible,
      returned: row.returned,
      rate: row.eligible === 0 ? null : row.returned / row.eligible,
    }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))
}

export interface FirstTimer {
  clientProfileId: string
  firstVisitAt: Date
  stylistProfileId: string
}

export interface AtRisk extends FirstTimer {
  daysSince: number
}

/**
 * First-timers who have not come back, and are late enough to be worth a call.
 *
 * The grace period is a floor, not a filter on the other side: somebody whose
 * first visit was yesterday is not at risk, and somebody whose first visit was
 * two years ago is not an intervention any more — they are a lapsed client,
 * which is a different conversation and a different list.
 */
export function firstTimersAtRisk(
  firstTimers: readonly FirstTimer[],
  returned: ReadonlySet<string>,
  asOf: Date,
  graceDays = FIRST_TIMER_GRACE_DAYS,
): AtRisk[] {
  const out: AtRisk[] = []

  for (const client of firstTimers) {
    if (returned.has(client.clientProfileId)) continue

    const daysSince = Math.floor((asOf.getTime() - client.firstVisitAt.getTime()) / DAY_MS)
    if (daysSince < graceDays) continue
    // Past this it is not a first-timer who slipped, it is somebody who left.
    if (daysSince > graceDays * 3) continue

    out.push({ ...client, daysSince })
  }

  // Most urgent first: the ones closest to the edge of being worth calling.
  return out.sort((a, b) => a.daysSince - b.daysSince)
}

/**
 * When to nudge somebody about rebooking.
 *
 * Anchored on the last visit plus the interval the plan actually said, not a
 * fixed number of weeks. A balayage client told to come back in ten weeks and
 * nudged at six is being sold to; nudged at ten they are being looked after,
 * and the difference is the entire reason this platform records the interval.
 */
export function rebookDueAt(lastVisitAt: Date, intervalWeeks: number | null): Date | null {
  if (intervalWeeks === null || intervalWeeks <= 0) return null
  return new Date(lastVisitAt.getTime() + intervalWeeks * 7 * DAY_MS)
}
