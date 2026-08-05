import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { computeAvailability } from '@/domain/scheduling/availability'
import { chainDuration } from '@/domain/scheduling/chain'
import { fromEpochMinutes } from '@/domain/scheduling/zoned'
import { buildChain } from '@/domain/scheduling/chain'
import { describeWindow, windowFrom } from '@/domain/scheduling/window'
import type { BookingWindow } from '@/domain/scheduling/window'
import type { PhaseChain, Slot } from '@/domain/scheduling/types'
import { loadAvailabilityRequest, schedulingSettingsFrom } from './loader'
import { loadPlan, sessionBookability } from '../service-plan'
import { getServices, requiredSkillFor, toChainSpec } from '../catalog'

/**
 * Finding bookable slots for a session of an approved plan.
 *
 * The chain comes from the plan, never from the catalog: it was frozen at
 * approval precisely so that editing a service afterwards cannot reshape an
 * appointment somebody already agreed to. Re-deriving it here would throw that
 * guarantee away at the last possible moment.
 */

export interface SlotSearch {
  salonId: string
  servicePlanId: string
  sequence: number
  locationId?: string | null
  fromDate: string
  toDate: string
  stylistId?: string | null
  /** Any capable stylist, rather than only the one who did the consultation. */
  anyStylist?: boolean
  now?: Date
}

export interface OfferedSlot {
  startsAt: string
  endsAt: string
  stylistId: string
  stylistName: string
  localDate: string
  durationMin: number
  offersInterleave: boolean
  /** Opaque, signed by nothing — re-validated on hold, never trusted alone. */
  token: string
}

export interface SlotSearchResult {
  slots: readonly OfferedSlot[]
  reason: string | null
  bookable: boolean
  earliestDate: string | null
  /**
   * The narrowing in words, or null when there is none.
   *
   * Shown to the client rather than kept quiet: "no times in that range" is
   * infuriating when the reason is a restriction somebody else applied and
   * nobody mentioned.
   */
  restrictedTo: string | null
}

/** The frozen chain for a session, reassembled from the plan's stored JSON. */
export function sessionChain(session: {
  services: readonly { phaseChainJson: unknown; sequence: number }[]
}): PhaseChain {
  return [...session.services]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((s) => (Array.isArray(s.phaseChainJson) ? (s.phaseChainJson as PhaseChain) : []))
}

/**
 * A slot reference the client hands back when they choose one.
 *
 * Deliberately not a signed capability: everything in it is re-checked against
 * live availability before a hold is written, and the database's exclusion
 * constraint is the actual authority. It exists so the confirm step does not
 * need the whole search re-posted.
 */
export function encodeSlot(slot: Slot): string {
  return [slot.stylistId, slot.startMin, slot.endMin, slot.localDate].join('|')
}

export function decodeSlot(
  token: string,
): { stylistId: string; startMin: number; endMin: number; localDate: string } | null {
  const parts = token.split('|')
  if (parts.length !== 4) return null
  const [stylistId, startMin, endMin, localDate] = parts
  if (!stylistId || !startMin || !endMin || !localDate) return null
  const start = Number(startMin)
  const end = Number(endMin)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { stylistId, startMin: start, endMin: end, localDate }
}

export async function findSlots(search: SlotSearch): Promise<SlotSearchResult> {
  const plan = await loadPlan(search.salonId, search.servicePlanId)
  const session = plan.sessions.find((s) => s.sequence === search.sequence)
  if (!session) throw new DomainError('NOT_FOUND', 'That session is not part of this plan.')

  if (session.appointment) {
    throw new DomainError('CONFLICT', 'That session is already booked.')
  }

  /*
   * The window comes off the plan, never off the request.
   *
   * A stylist narrowing an approval to Tuesdays is making a clinical decision
   * about somebody's hair, not expressing a preference — so it is not
   * something the client's own search can widen back out by omitting a field.
   */
  const window = windowFrom(plan)
  const restrictedTo = describeWindow(window)

  // Refuse before searching, so a client is never shown times they cannot take.
  const gate = await sessionBookability(search.salonId, search.servicePlanId, search.sequence)
  if (!gate.bookable) {
    return {
      slots: [],
      reason: gate.reason,
      bookable: false,
      earliestDate: gate.earliestDate,
      restrictedTo,
    }
  }

  const chain = sessionChain(session)
  if (chain.length === 0) {
    throw new DomainError('CONFLICT', 'This session has no services attached.')
  }

  // The hair still needs its gap even when the previous session is done.
  const fromDate =
    gate.earliestDate && gate.earliestDate > search.fromDate ? gate.earliestDate : search.fromDate
  if (fromDate > search.toDate) {
    return {
      slots: [],
      reason: gate.reason,
      bookable: true,
      earliestDate: gate.earliestDate,
      restrictedTo,
    }
  }

  const slots = await solve({
    salonId: search.salonId,
    locationId: search.locationId,
    fromDate,
    toDate: search.toDate,
    chain,
    serviceIds: session.services.map((s) => s.serviceId),
    pinnedStylistId: search.anyStylist ? null : (search.stylistId ?? plan.stylistProfileId),
    window,
    now: search.now,
  })

  return {
    slots: slots.slots,
    reason: slots.slots.length === 0 ? explain(slots.reason, restrictedTo) : null,
    bookable: true,
    earliestDate: gate.earliestDate,
    restrictedTo,
  }
}

/**
 * R7 — the same search, for services nobody has approved a plan for.
 *
 * Everything the plan-based search needed already existed except a way in:
 * `bookDirect` takes an arbitrary slot and chain, the loader is chain-generic,
 * and the solver never knew what a `ServicePlan` was. The only thing missing
 * was a search that does not open with `loadPlan()`.
 *
 * The one real difference, and it is the honest one: the chain is built from
 * the catalog as it stands right now, because there is no frozen chain to
 * read. A plan's chain was deliberately frozen at approval so a later catalog
 * edit could not reshape an appointment somebody agreed to — nobody has
 * agreed to anything here, so live is correct rather than a shortcut.
 *
 * This is what staff booking, processing-gap fill, waitlist matching and the
 * import parallel-run all sit on. It exists once so those four cannot drift.
 */
export interface AdHocSearch {
  salonId: string
  serviceIds: readonly string[]
  locationId?: string | null
  fromDate: string
  toDate: string
  stylistId?: string | null
  /**
   * Narrow to a set of stylists without pinning to one.
   *
   * A waitlist entry says "any of these three", which is neither "this one"
   * nor "anybody" — and the loader has always accepted the list; nothing ever
   * passed it.
   */
  stylistIds?: readonly string[]
  /** True for somebody who has never been in; some stylists are closed to them. */
  isNewClient?: boolean
  /** Narrowing the caller wants, e.g. "inside this processing gap". */
  window?: BookingWindow | null
  now?: Date
}

export async function findSlotsForServices(search: AdHocSearch): Promise<SlotSearchResult> {
  return findSlotsForChain({
    ...search,
    chain: await chainForServices(search.salonId, search.serviceIds),
  })
}

/**
 * Build a chain from the catalog, at whatever the catalog says today.
 *
 * Shared by the ad-hoc search and its resolve step, because a chain that
 * differed between the two would offer a slot the confirm step could not find.
 */
export async function chainForServices(
  salonId: string,
  serviceIds: readonly string[],
): Promise<PhaseChain> {
  if (serviceIds.length === 0) {
    throw new DomainError('INVALID_INPUT', 'Pick at least one service.')
  }

  const [services, settingsRow] = await Promise.all([
    getServices(salonId, serviceIds),
    unsafeDb.salonSettings.findUnique({ where: { salonId } }),
  ])
  if (services.length !== new Set(serviceIds).size) {
    throw new DomainError('NOT_FOUND', 'One of those services is no longer offered.')
  }

  const chain = buildChain(
    services.map((service) =>
      toChainSpec(service, {
        bufferBeforeMin: settingsRow?.defaultBufferBeforeMin ?? 0,
        bufferAfterMin: settingsRow?.defaultBufferAfterMin ?? 10,
      }),
    ),
    { settings: schedulingSettingsFrom(settingsRow) },
  )
  if (chain.length === 0) {
    throw new DomainError('CONFLICT', 'Those services have no phases set up yet.')
  }
  return chain
}

/**
 * The search, given a chain somebody else built.
 *
 * The lowest entry point, and the one an in-person consultation uses: a
 * thirty-minute chat has no service in the catalog behind it, so there is
 * nothing for `chainForServices` to read. Everything above this is a way of
 * arriving at a chain.
 */
export async function findSlotsForChain(input: {
  salonId: string
  locationId?: string | null
  fromDate: string
  toDate: string
  chain: PhaseChain
  serviceIds?: readonly string[]
  stylistId?: string | null
  stylistIds?: readonly string[]
  isNewClient?: boolean
  window?: BookingWindow | null
  now?: Date
}): Promise<SlotSearchResult> {
  const restrictedTo = describeWindow(input.window ?? null)
  const result = await solve({
    ...input,
    serviceIds: input.serviceIds ?? [],
    pinnedStylistId: input.stylistId ?? null,
    window: input.window ?? null,
  })

  return {
    slots: result.slots,
    reason: result.slots.length === 0 ? explain(result.reason, restrictedTo) : null,
    bookable: true,
    earliestDate: null,
    restrictedTo,
  }
}

/**
 * The search itself, with no idea whether a plan was involved.
 *
 * Extracted because there are now several entry points — and two copies of
 * "load, solve, name the stylists, encode the token" is two places for a fix
 * to land in one of.
 */
async function solve(input: {
  salonId: string
  locationId?: string | null
  fromDate: string
  toDate: string
  chain: PhaseChain
  serviceIds: readonly string[]
  pinnedStylistId: string | null
  stylistIds?: readonly string[]
  isNewClient?: boolean
  window: BookingWindow | null
  now?: Date
}): Promise<{ slots: OfferedSlot[]; reason: string | null }> {
  const locationId = input.locationId ?? (await defaultLocationId(input.salonId))

  const request = await loadAvailabilityRequest({
    salonId: input.salonId,
    locationId,
    fromDate: input.fromDate,
    toDate: input.toDate,
    chain: input.chain,
    requiredSkill: await requiredSkillFor(input.salonId, input.serviceIds),
    isChemical: await anyChemical(input.salonId, input.serviceIds),
    isNewClient: input.isNewClient ?? false,
    pinnedStylistId: input.pinnedStylistId,
    stylistIds: input.stylistIds && input.stylistIds.length > 0 ? input.stylistIds : undefined,
    window: input.window,
    now: input.now,
  })

  const result = computeAvailability(request)
  const names = await stylistNames(result.slots.map((s) => s.stylistId))
  const durationMin = chainDuration(input.chain)

  return {
    slots: result.slots.map((slot) => ({
      startsAt: fromEpochMinutes(slot.startMin).toISOString(),
      endsAt: fromEpochMinutes(slot.endMin).toISOString(),
      stylistId: slot.stylistId,
      stylistName: names.get(slot.stylistId) ?? 'Your stylist',
      localDate: slot.localDate,
      durationMin,
      offersInterleave: slot.offersInterleave,
      token: encodeSlot(slot),
    })),
    reason: result.reason,
  }
}

/**
 * Re-find one specific slot.
 *
 * The confirm step calls this rather than trusting the token: between the
 * search and the tap, somebody else may have taken the chair. Returning the
 * freshly solved slot means the placements written into the hold are the ones
 * the solver just verified, not ones reconstructed from a string.
 */
export async function resolveSlot(
  search: SlotSearch & { token: string },
): Promise<{ slot: Slot; chain: PhaseChain; locationId: string } | null> {
  const decoded = decodeSlot(search.token)
  if (!decoded) throw new DomainError('INVALID_INPUT', 'That time is no longer valid.')

  const plan = await loadPlan(search.salonId, search.servicePlanId)
  const session = plan.sessions.find((s) => s.sequence === search.sequence)
  if (!session) throw new DomainError('NOT_FOUND', 'That session is not part of this plan.')

  const chain = sessionChain(session)
  const locationId = search.locationId ?? (await defaultLocationId(search.salonId))
  const serviceIds = session.services.map((s) => s.serviceId)

  const request = await loadAvailabilityRequest({
    salonId: search.salonId,
    locationId,
    fromDate: decoded.localDate,
    toDate: decoded.localDate,
    chain,
    requiredSkill: await requiredSkillFor(search.salonId, serviceIds),
    isChemical: await anyChemical(search.salonId, serviceIds),
    isNewClient: false,
    pinnedStylistId: decoded.stylistId,
    // Also applied here, not only in the search. The token is deliberately
    // unsigned, so this is the step that actually enforces the narrowing: a
    // slot outside it is never solved, so there is nothing to match and the
    // hold is refused.
    window: windowFrom(plan),
    now: search.now,
  })

  const match = computeAvailability(request).slots.find(
    (s) => s.startMin === decoded.startMin && s.stylistId === decoded.stylistId,
  )
  return match ? { slot: match, chain, locationId } : null
}

/**
 * Re-find one ad-hoc slot, the same way the plan-based confirm does.
 *
 * The token is deliberately unsigned and this is why that is safe: between the
 * search and the tap somebody else may have taken the chair, so the slot
 * written into a hold is the one the solver just verified rather than one
 * reconstructed from a string a browser posted back.
 */
export async function resolveSlotForServices(
  // The date range is deliberately absent: this re-solves the token's OWN
  // date, so a caller passing a range would be passing something ignored —
  // and something ignored eventually gets passed wrong.
  search: Omit<AdHocSearch, 'fromDate' | 'toDate'> & { token: string },
): Promise<{ slot: Slot; chain: PhaseChain; locationId: string } | null> {
  const decoded = decodeSlot(search.token)
  if (!decoded) throw new DomainError('INVALID_INPUT', 'That time is no longer valid.')

  const chain = await chainForServices(search.salonId, search.serviceIds)
  const locationId = search.locationId ?? (await defaultLocationId(search.salonId))

  const request = await loadAvailabilityRequest({
    salonId: search.salonId,
    locationId,
    fromDate: decoded.localDate,
    toDate: decoded.localDate,
    chain,
    requiredSkill: await requiredSkillFor(search.salonId, search.serviceIds),
    isChemical: await anyChemical(search.salonId, search.serviceIds),
    isNewClient: search.isNewClient ?? false,
    pinnedStylistId: decoded.stylistId,
    // Applied here too, not only in the search — a caller that narrowed to a
    // processing gap must not be able to widen back out by dropping the field
    // on the confirm call.
    window: search.window ?? null,
    now: search.now,
  })

  const match = computeAvailability(request).slots.find(
    (s) => s.startMin === decoded.startMin && s.stylistId === decoded.stylistId,
  )
  return match ? { slot: match, chain, locationId } : null
}

async function defaultLocationId(salonId: string): Promise<string> {
  const location = await unsafeDb.location.findFirst({
    where: { salonId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!location) throw new DomainError('CONFLICT', 'This salon has no active location.')
  return location.id
}

/** The solver works in ids; a client needs a name on the button. */
async function stylistNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await unsafeDb.stylistProfile.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, displayName: true },
  })
  return new Map(rows.map((r) => [r.id, r.displayName]))
}

async function anyChemical(salonId: string, serviceIds: readonly string[]): Promise<boolean> {
  const count = await unsafeDb.service.count({
    where: { salonId, id: { in: [...serviceIds] }, isChemical: true },
  })
  return count > 0
}

/**
 * Say why, in words a client can act on.
 *
 * A narrowed plan gets the narrowing named. Otherwise "no times in that range"
 * reads as the salon being full, and the client widens the date range again
 * and again against a restriction no amount of widening will move.
 */
function explain(reason: string | null, restrictedTo: string | null): string {
  if (restrictedTo) {
    const suffix = ` Your stylist has held this to ${restrictedTo}.`
    switch (reason) {
      case 'NO_CAPABLE_STYLIST':
        return `Nobody qualified is free in that range.${suffix}`
      default:
        return `No times left in that range.${suffix} Try further ahead.`
    }
  }

  switch (reason) {
    case 'NO_CAPABLE_STYLIST':
      return 'Nobody qualified for this service is taking bookings in that range. Try a wider date range, or ask us to suggest someone.'
    case 'OUTSIDE_BOOKING_WINDOW':
      return 'That is outside how far ahead this salon takes bookings.'
    case 'BLOCKED_BY_PREREQUISITE':
      return 'Something in your plan needs to happen first.'
    case 'FULLY_BOOKED':
    default:
      return 'No times left in that range — an appointment this length needs a longer gap than what is free. Try another week.'
  }
}
