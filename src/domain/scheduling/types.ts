import type { Interval } from './interval'
import type { BookingWindow } from './window'

export type PhaseKind = 'BUFFER_BEFORE' | 'ACTIVE' | 'PROCESSING' | 'RINSE' | 'BUFFER_AFTER'
export type ResourceType = 'CHAIR' | 'BASIN' | 'PROCESSING_SEAT' | 'ROOM' | 'DRYER'

/**
 * One link in an appointment's shape.
 *
 * `blocksStylist = false` on a PROCESSING link is the single fact that makes
 * interleaving possible: such a link never enters the stylist's busy set, so a
 * colourist is free during someone else's development time.
 */
export interface PhaseLink {
  kind: PhaseKind
  label: string
  durationMin: number
  blocksStylist: boolean
  blocksResource: boolean
  requiresResourceType: ResourceType | null
  serviceId: string | null
}

export type PhaseChain = readonly PhaseLink[]

export interface SchedulingSettings {
  slotGranularityMin: number
  minBookingLeadMin: number
  maxAdvanceDays: number
  allowFinishAfterCloseMin: number
  /** Off by default: interleaving is the highest-variance feature in the product. */
  interleaveEnabled: boolean
  maxConcurrentClients: number
  /** A processing gap shorter than this is not worth handing to another client. */
  minInterleaveMin: number
}

export interface CandidateStylist {
  stylistId: string
  /** Working hours ∩ location open, minus time off and blocked exceptions. */
  workIntervals: readonly Interval[]
  /** Segments where `blocksStylist` is true. PROCESSING segments are absent. */
  busyIntervals: readonly Interval[]
  /**
   * Full span of each in-flight appointment, blocking or not. Used for the
   * concurrency cap, which an exclusion constraint cannot express.
   */
  clientIntervals: readonly Interval[]
  /** localDate → count, for the daily chemical-service ceiling. */
  dailyChemicalCounts: Readonly<Record<string, number>>
  maxDailyChemicalServices: number | null
  maxConcurrentClients: number | null
  leadMinOverride: number | null
  /** Skill code → level, for capability filtering. */
  skills: Readonly<Record<string, number>>
  acceptsNewClients: boolean
  /** Ranking input only. */
  preferenceRank: number
}

export interface CandidateResource {
  resourceId: string
  type: ResourceType
  busyIntervals: readonly Interval[]
}

export interface AvailabilityRequest {
  /** Local dates, inclusive. */
  fromDate: string
  toDate: string
  nowMin: number
  timeZone: string
  /** localDate → the location's open intervals that day, already in UTC minutes. */
  openIntervals: Readonly<Record<string, readonly Interval[]>>
  settings: SchedulingSettings
  chain: PhaseChain
  candidates: readonly CandidateStylist[]
  resources: readonly CandidateResource[]
  requiredSkill: { code: string; level: number } | null
  isNewClient: boolean
  /** Contains a chemical service, for the daily cap. */
  isChemical: boolean
  constraints: {
    /**
     * Absolute bounds in epoch minutes, for spacing rather than preference —
     * the multi-session planner uses them to keep session 2 inside the six-to-
     * ten week gap the engine set. Renamed from `earliestMin`/`latestMin`,
     * which read as minutes-of-day and were validated that way in the booking
     * action (0–1440) while the solver treated them as absolute. Nothing
     * passed them from that side, so the disagreement never fired.
     */
    notBeforeMin?: number | null
    notAfterMin?: number | null
    /**
     * Days and times somebody has ruled out — the stylist at approval, or the
     * client on the waitlist. Local, recurring, and a different thing from the
     * absolute bounds above. Absent means anything the salon is open for.
     */
    window?: BookingWindow | null
    pinnedStylistId: string | null
  }
  /** Cap on returned slots per local day. */
  maxPerDay?: number
}

export interface PhasePlacement {
  index: number
  kind: PhaseKind
  label: string
  interval: Interval
  resourceId: string | null
}

export interface Slot {
  startMin: number
  endMin: number
  stylistId: string
  localDate: string
  placements: readonly PhasePlacement[]
  /** True when this booking would hand its processing gap to another client. */
  offersInterleave: boolean
  score: number
}

/** Why no slot could be offered — actionable rather than an empty list. */
export type UnavailableReason =
  'NO_CAPABLE_STYLIST' | 'OUTSIDE_BOOKING_WINDOW' | 'FULLY_BOOKED' | 'BLOCKED_BY_PREREQUISITE'

export interface AvailabilityResult {
  slots: readonly Slot[]
  reason: UnavailableReason | null
  /** Diagnostics for the front desk: why each stylist was excluded. */
  excluded: readonly { stylistId: string; reason: string }[]
}
