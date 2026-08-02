import { unsafeDb } from '@/server/db/client'
import { openIntervalsForDates } from '@/domain/scheduling/availability'
import { chainSignature } from '@/domain/scheduling/chain'
import {
  addDays,
  eachLocalDate,
  localDateOfEpochMinutes,
  localTimeToEpochMinutes,
  toEpochMinutes,
} from '@/domain/scheduling/zoned'
import type { Interval } from '@/domain/scheduling/interval'
import type {
  AvailabilityRequest,
  CandidateResource,
  CandidateStylist,
  PhaseChain,
  SchedulingSettings,
} from '@/domain/scheduling/types'

/**
 * Turns the database into the snapshot the solver needs.
 *
 * Five indexed queries and no logic: every decision lives in the pure domain
 * layer. Keeping the loader dumb is what lets the solver be tested without a
 * database at all.
 */

export interface LoadOptions {
  salonId: string
  locationId: string
  fromDate: string
  toDate: string
  chain: PhaseChain
  requiredSkill: { code: string; level: number } | null
  isChemical: boolean
  isNewClient: boolean
  stylistIds?: readonly string[]
  pinnedStylistId?: string | null
  earliestMin?: number | null
  latestMin?: number | null
  now?: Date
}

const toInterval = (start: Date, end: Date): Interval => ({
  start: toEpochMinutes(start),
  end: toEpochMinutes(end),
})

/**
 * A short in-process cache.
 *
 * A client flicking between days in the picker re-runs the same query many
 * times over a few seconds. Twenty seconds is long enough to absorb that and
 * short enough that a colleague's booking shows up almost immediately — and the
 * database is still the final authority, so a stale read costs at worst one
 * "that slot was just taken".
 */
const CACHE_TTL_MS = 20_000
const cache = new Map<string, { at: number; value: AvailabilityRequest }>()

export function invalidateAvailabilityCache(salonId?: string): void {
  if (!salonId) return cache.clear()
  for (const key of cache.keys()) if (key.startsWith(`${salonId}:`)) cache.delete(key)
}

export async function loadAvailabilityRequest(opts: LoadOptions): Promise<AvailabilityRequest> {
  const now = opts.now ?? new Date()
  const nowMin = toEpochMinutes(now)

  const cacheKey = [
    opts.salonId,
    opts.locationId,
    opts.fromDate,
    opts.toDate,
    chainSignature(opts.chain),
    opts.pinnedStylistId ?? '-',
    (opts.stylistIds ?? []).join(','),
    opts.requiredSkill ? `${opts.requiredSkill.code}:${opts.requiredSkill.level}` : '-',
    Math.floor(nowMin / 5),
  ].join(':')

  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const [salon, location, settingsRow] = await Promise.all([
    unsafeDb.salon.findUniqueOrThrow({
      where: { id: opts.salonId },
      select: { defaultTimezone: true },
    }),
    unsafeDb.location.findUniqueOrThrow({
      where: { id: opts.locationId },
      select: { timezone: true },
    }),
    unsafeDb.salonSettings.findUnique({ where: { salonId: opts.salonId } }),
  ])

  const timeZone = location.timezone || salon.defaultTimezone
  const settings: SchedulingSettings = {
    slotGranularityMin: settingsRow?.slotGranularityMin ?? 15,
    minBookingLeadMin: settingsRow?.minBookingLeadMin ?? 120,
    maxAdvanceDays: settingsRow?.maxAdvanceDays ?? 120,
    allowFinishAfterCloseMin: settingsRow?.allowFinishAfterCloseMin ?? 15,
    interleaveEnabled: settingsRow?.interleaveEnabled ?? false,
    maxConcurrentClients: settingsRow?.maxConcurrentClients ?? 2,
    minInterleaveMin: settingsRow?.minInterleaveMin ?? 25,
  }

  const dates = eachLocalDate(opts.fromDate, opts.toDate)
  // Widen the window by a day either side so an appointment straddling
  // midnight, or a shift that starts before it, is still seen.
  const rangeStart = new Date(`${addDays(opts.fromDate, -1)}T00:00:00Z`)
  const rangeEnd = new Date(`${addDays(opts.toDate, 2)}T00:00:00Z`)

  const [stylistRows, hoursRows, exceptionRows, timeOffRows, segmentRows, resourceRows] =
    await Promise.all([
      unsafeDb.stylistProfile.findMany({
        where: {
          salonId: opts.salonId,
          isActive: true,
          ...(opts.stylistIds ? { id: { in: [...opts.stylistIds] } } : {}),
          ...(opts.pinnedStylistId ? { id: opts.pinnedStylistId } : {}),
        },
        select: {
          id: true,
          acceptsNewClients: true,
          bookingLeadMin: true,
          maxConcurrentClients: true,
          maxDailyChemicalServices: true,
          skills: { select: { skillCode: true, level: true } },
        },
      }),
      unsafeDb.workingHours.findMany({
        where: { salonId: opts.salonId },
        select: {
          stylistProfileId: true,
          locationId: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
        },
      }),
      unsafeDb.scheduleException.findMany({
        where: { salonId: opts.salonId, date: { gte: rangeStart, lte: rangeEnd } },
        select: {
          stylistProfileId: true,
          date: true,
          kind: true,
          startMinute: true,
          endMinute: true,
        },
      }),
      unsafeDb.timeOff.findMany({
        where: {
          salonId: opts.salonId,
          status: 'APPROVED',
          startsAt: { lt: rangeEnd },
          endsAt: { gt: rangeStart },
        },
        select: { stylistProfileId: true, startsAt: true, endsAt: true },
      }),
      unsafeDb.appointmentSegment.findMany({
        where: {
          salonId: opts.salonId,
          locationId: opts.locationId,
          startsAt: { lt: rangeEnd },
          endsAt: { gt: rangeStart },
          state: { in: ['ACTIVE', 'HOLD'] },
          // An expired hold is not a reservation any more.
          OR: [{ state: 'ACTIVE' }, { holdExpiresAt: { gt: now } }],
        },
        select: {
          stylistProfileId: true,
          resourceId: true,
          appointmentId: true,
          bookingHoldId: true,
          blocksStylist: true,
          blocksResource: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      unsafeDb.resource.findMany({
        where: { salonId: opts.salonId, locationId: opts.locationId, isBookable: true },
        select: { id: true, type: true },
      }),
    ])

  // --- Location opening hours ---------------------------------------------
  const salonHours: Record<number, { startMinute: number; endMinute: number }[]> = {}
  for (const row of hoursRows) {
    if (row.stylistProfileId) continue
    if (row.locationId && row.locationId !== opts.locationId) continue
    ;(salonHours[row.dayOfWeek] ??= []).push({
      startMinute: row.startMinute,
      endMinute: row.endMinute,
    })
  }

  const closures = exceptionRows
    .filter((e) => !e.stylistProfileId && e.kind === 'CLOSED')
    .map((e) => {
      const date = e.date.toISOString().slice(0, 10)
      return {
        start: localDateToMinutes(date, e.startMinute ?? 0, timeZone),
        end: localDateToMinutes(date, e.endMinute ?? 1440, timeZone),
      }
    })

  const openIntervals = openIntervalsForDates(dates, timeZone, salonHours, closures)

  // --- Per-stylist availability -------------------------------------------
  const candidates: CandidateStylist[] = stylistRows.map((row) => {
    const own: Record<number, { startMinute: number; endMinute: number }[]> = {}
    for (const h of hoursRows) {
      if (h.stylistProfileId !== row.id) continue
      ;(own[h.dayOfWeek] ??= []).push({ startMinute: h.startMinute, endMinute: h.endMinute })
    }

    // A stylist with no hours of their own works the salon's.
    const source = Object.keys(own).length > 0 ? own : salonHours
    const perDay = openIntervalsForDates(dates, timeZone, source)

    const extra = exceptionRows
      .filter((e) => e.stylistProfileId === row.id && e.kind === 'OPEN')
      .map((e) => {
        const date = e.date.toISOString().slice(0, 10)
        return {
          start: localDateToMinutes(date, e.startMinute ?? 0, timeZone),
          end: localDateToMinutes(date, e.endMinute ?? 1440, timeZone),
        }
      })

    const blocked = [
      ...exceptionRows
        .filter((e) => e.stylistProfileId === row.id && e.kind === 'CLOSED')
        .map((e) => {
          const date = e.date.toISOString().slice(0, 10)
          return {
            start: localDateToMinutes(date, e.startMinute ?? 0, timeZone),
            end: localDateToMinutes(date, e.endMinute ?? 1440, timeZone),
          }
        }),
      ...timeOffRows
        .filter((t) => t.stylistProfileId === row.id)
        .map((t) => toInterval(t.startsAt, t.endsAt)),
    ]

    const work = [...Object.values(perDay).flat(), ...extra]

    const mine = segmentRows.filter((s) => s.stylistProfileId === row.id)

    // Only stylist-blocking segments make them busy; processing segments do not,
    // which is exactly what allows interleaving.
    const busy = [
      ...mine.filter((s) => s.blocksStylist).map((s) => toInterval(s.startsAt, s.endsAt)),
      ...blocked,
    ]

    // Full appointment spans, for the concurrency cap.
    const byAppointment = new Map<string, Interval>()
    for (const s of mine) {
      const key = s.appointmentId ?? s.bookingHoldId ?? `${s.startsAt.toISOString()}`
      const span = toInterval(s.startsAt, s.endsAt)
      const existing = byAppointment.get(key)
      byAppointment.set(
        key,
        existing
          ? { start: Math.min(existing.start, span.start), end: Math.max(existing.end, span.end) }
          : span,
      )
    }

    const dailyChemicalCounts: Record<string, number> = {}
    for (const span of byAppointment.values()) {
      const date = localDateOfEpochMinutes(span.start, timeZone)
      dailyChemicalCounts[date] = (dailyChemicalCounts[date] ?? 0) + 1
    }

    return {
      stylistId: row.id,
      workIntervals: work,
      busyIntervals: busy,
      clientIntervals: [...byAppointment.values()],
      dailyChemicalCounts,
      maxDailyChemicalServices: row.maxDailyChemicalServices,
      maxConcurrentClients: row.maxConcurrentClients,
      leadMinOverride: row.bookingLeadMin,
      skills: Object.fromEntries(row.skills.map((s) => [s.skillCode, s.level])),
      acceptsNewClients: row.acceptsNewClients,
      preferenceRank: opts.pinnedStylistId === row.id ? 0 : 1,
    }
  })

  const resources: CandidateResource[] = resourceRows.map((r) => ({
    resourceId: r.id,
    type: r.type,
    busyIntervals: segmentRows
      .filter((s) => s.resourceId === r.id && s.blocksResource)
      .map((s) => toInterval(s.startsAt, s.endsAt)),
  }))

  const value: AvailabilityRequest = {
    fromDate: opts.fromDate,
    toDate: opts.toDate,
    nowMin,
    timeZone,
    openIntervals,
    settings,
    chain: opts.chain,
    candidates,
    resources,
    requiredSkill: opts.requiredSkill,
    isNewClient: opts.isNewClient,
    isChemical: opts.isChemical,
    constraints: {
      earliestMin: opts.earliestMin ?? null,
      latestMin: opts.latestMin ?? null,
      pinnedStylistId: opts.pinnedStylistId ?? null,
    },
  }

  cache.set(cacheKey, { at: Date.now(), value })
  return value
}

/** Every local→UTC conversion in this file goes through the domain module. */
function localDateToMinutes(localDate: string, minute: number, timeZone: string): number {
  return localTimeToEpochMinutes(localDate, minute, timeZone)
}
