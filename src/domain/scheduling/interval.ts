/**
 * Half-open `[start, end)` intervals over epoch minutes.
 *
 * Half-open is the whole game: an appointment ending at 10:00 and one starting
 * at 10:00 do not overlap, so back-to-back bookings are legal while genuine
 * overlaps are not. The same convention is used by the Postgres exclusion
 * constraint (`tstzrange(..., '[)')`), so the solver and the database agree.
 */

export interface Interval {
  start: number
  end: number
}

export function interval(start: number, end: number): Interval {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError('Interval bounds must be finite')
  }
  if (end < start) throw new RangeError(`Interval end ${end} precedes start ${start}`)
  return { start, end }
}

export const isEmpty = (i: Interval): boolean => i.end <= i.start

export const duration = (i: Interval): number => i.end - i.start

/**
 * An empty interval contains no points, so it overlaps nothing — a zero-length
 * phase must not block a chair it never occupies.
 */
export const overlaps = (a: Interval, b: Interval): boolean =>
  !isEmpty(a) && !isEmpty(b) && a.start < b.end && b.start < a.end

export const contains = (outer: Interval, inner: Interval): boolean =>
  inner.start >= outer.start && inner.end <= outer.end

export const containsPoint = (i: Interval, t: number): boolean => t >= i.start && t < i.end

/** Sort ascending and coalesce anything touching or overlapping. */
export function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => !isEmpty(i)).sort((a, b) => a.start - b.start)
  const out: Interval[] = []

  for (const current of sorted) {
    const last = out[out.length - 1]
    // `<=` because [9,10) and [10,11) are contiguous and should coalesce.
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      out.push({ ...current })
    }
  }
  return out
}

/** Everything in `from` that is not in any of `remove`. */
export function subtract(from: readonly Interval[], remove: readonly Interval[]): Interval[] {
  const blockers = merge(remove)
  let result = merge(from)

  for (const blocker of blockers) {
    const next: Interval[] = []
    for (const piece of result) {
      if (!overlaps(piece, blocker)) {
        next.push(piece)
        continue
      }
      if (piece.start < blocker.start) next.push({ start: piece.start, end: blocker.start })
      if (piece.end > blocker.end) next.push({ start: blocker.end, end: piece.end })
    }
    result = next
  }
  return result
}

/** The overlap between two interval sets. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = merge(a)
  const right = merge(b)
  const out: Interval[] = []

  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i]!.start, right[j]!.start)
    const end = Math.min(left[i]!.end, right[j]!.end)
    if (start < end) out.push({ start, end })
    if (left[i]!.end < right[j]!.end) i++
    else j++
  }
  return out
}

/** Whether `candidate` fits entirely inside one of the free intervals. */
export function fitsWithin(free: readonly Interval[], candidate: Interval): boolean {
  return free.some((f) => contains(f, candidate))
}

/**
 * How many intervals cover each point, as a step function.
 *
 * Used for resource capacity: at any moment we need to know how many chairs are
 * already taken, which is a sweep over start/end events rather than a scan.
 */
export function coverageAt(intervals: readonly Interval[], t: number): number {
  let count = 0
  for (const i of intervals) if (containsPoint(i, t)) count++
  return count
}

/** The maximum simultaneous coverage anywhere inside `window`. */
export function peakCoverage(intervals: readonly Interval[], window: Interval): number {
  const events: { at: number; delta: number }[] = []
  for (const i of intervals) {
    if (!overlaps(i, window)) continue
    events.push({ at: Math.max(i.start, window.start), delta: 1 })
    events.push({ at: Math.min(i.end, window.end), delta: -1 })
  }
  // Ends before starts at the same instant — half-open again.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta)

  let current = 0
  let peak = 0
  for (const e of events) {
    current += e.delta
    peak = Math.max(peak, current)
  }
  return peak
}

export function totalDuration(intervals: readonly Interval[]): number {
  return merge(intervals).reduce((sum, i) => sum + duration(i), 0)
}
