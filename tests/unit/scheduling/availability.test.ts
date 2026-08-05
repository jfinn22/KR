import { describe, expect, it } from 'vitest'
import { computeAvailability } from '@/domain/scheduling/availability'
import {
  buildChain,
  chainDuration,
  chainOffersInterleave,
  chainStylistMinutes,
  type ServiceChainSpec,
} from '@/domain/scheduling/chain'
import { localTimeToEpochMinutes } from '@/domain/scheduling/zoned'
import { ANY_TIME, maskOf, type BookingWindow } from '@/domain/scheduling/window'
import type {
  AvailabilityRequest,
  CandidateResource,
  CandidateStylist,
  SchedulingSettings,
} from '@/domain/scheduling/types'

const TZ = 'America/New_York'
const DATE = '2026-06-15' // a Monday
const at = (hour: number, minute = 0) => localTimeToEpochMinutes(DATE, hour * 60 + minute, TZ)

const SETTINGS: SchedulingSettings = {
  slotGranularityMin: 15,
  minBookingLeadMin: 0,
  maxAdvanceDays: 90,
  allowFinishAfterCloseMin: 0,
  interleaveEnabled: false,
  maxConcurrentClients: 2,
  minInterleaveMin: 25,
}

/** Balayage: 90 minutes of work, 40 processing, 45 to tone and finish. */
const BALAYAGE: ServiceChainSpec = {
  serviceId: 'svc_bal',
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  phases: [
    {
      kind: 'ACTIVE',
      label: 'Application',
      durationMin: 90,
      requiresStylist: true,
      requiresResourceType: 'CHAIR',
      isScalable: true,
    },
    {
      kind: 'PROCESSING',
      label: 'Processing',
      durationMin: 40,
      requiresStylist: false,
      requiresResourceType: 'PROCESSING_SEAT',
      isScalable: false,
    },
    {
      kind: 'ACTIVE',
      label: 'Tone & finish',
      durationMin: 45,
      requiresStylist: true,
      requiresResourceType: 'CHAIR',
      isScalable: true,
    },
  ],
}

const CUT: ServiceChainSpec = {
  serviceId: 'svc_cut',
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  phases: [
    {
      kind: 'ACTIVE',
      label: 'Cut & finish',
      durationMin: 45,
      requiresStylist: true,
      requiresResourceType: 'CHAIR',
      isScalable: true,
    },
  ],
}

function stylist(overrides: Partial<CandidateStylist> = {}): CandidateStylist {
  return {
    stylistId: 'sty_1',
    workIntervals: [{ start: at(9), end: at(17) }],
    busyIntervals: [],
    clientIntervals: [],
    dailyChemicalCounts: {},
    maxDailyChemicalServices: null,
    maxConcurrentClients: null,
    leadMinOverride: null,
    skills: { BALAYAGE: 5 },
    acceptsNewClients: true,
    preferenceRank: 0,
    ...overrides,
  }
}

function resources(chairs = 3, seats = 2): CandidateResource[] {
  return [
    ...Array.from({ length: chairs }, (_, n) => ({
      resourceId: `chair_${n}`,
      type: 'CHAIR' as const,
      busyIntervals: [],
    })),
    ...Array.from({ length: seats }, (_, n) => ({
      resourceId: `seat_${n}`,
      type: 'PROCESSING_SEAT' as const,
      busyIntervals: [],
    })),
  ]
}

function request(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  const settings = overrides.settings ?? SETTINGS
  return {
    fromDate: DATE,
    toDate: DATE,
    nowMin: at(8),
    timeZone: TZ,
    openIntervals: { [DATE]: [{ start: at(9), end: at(17) }] },
    settings,
    chain: buildChain([CUT], { settings }),
    candidates: [stylist()],
    resources: resources(),
    requiredSkill: null,
    isNewClient: false,
    isChemical: false,
    constraints: { notBeforeMin: null, notAfterMin: null, pinnedStylistId: null },
    maxPerDay: 100,
    ...overrides,
  }
}

describe('chain building', () => {
  const chain = buildChain([BALAYAGE], { settings: SETTINGS })

  it('produces the phase sequence, buffers included', () => {
    expect(chain.map((l) => l.kind)).toEqual(['ACTIVE', 'PROCESSING', 'ACTIVE'])
    expect(chainDuration(chain)).toBe(175)
  })

  it('adds buffers when the service declares them', () => {
    const withBuffer = buildChain([CUT], { settings: SETTINGS })
    expect(withBuffer.map((l) => l.kind)).toEqual(['ACTIVE', 'BUFFER_AFTER'])
    expect(chainDuration(withBuffer)).toBe(55)
  })

  it('scales only the scalable phases — processing is chemistry, not volume', () => {
    const long = buildChain([BALAYAGE], { settings: SETTINGS, scalableFactor: 1.4 })
    const processing = long.find((l) => l.kind === 'PROCESSING')!
    expect(processing.durationMin).toBe(40)
    expect(chainDuration(long)).toBeGreaterThan(chainDuration(chain))
  })

  it('marks the stylist as blocked during processing when interleaving is off', () => {
    expect(chainOffersInterleave(chain)).toBe(false)
    expect(chainStylistMinutes(chain)).toBe(175)
  })

  it('frees the stylist during a long enough gap when interleaving is on', () => {
    const on = buildChain([BALAYAGE], {
      settings: { ...SETTINGS, interleaveEnabled: true },
    })
    expect(chainOffersInterleave(on)).toBe(true)
    expect(chainStylistMinutes(on)).toBe(135)
  })

  it('will not hand over a gap that is too short to be useful', () => {
    const quick: ServiceChainSpec = {
      ...BALAYAGE,
      phases: BALAYAGE.phases.map((p) => (p.kind === 'PROCESSING' ? { ...p, durationMin: 10 } : p)),
    }
    const chainWithShortGap = buildChain([quick], {
      settings: { ...SETTINGS, interleaveEnabled: true },
    })
    // Nobody can be seen in ten minutes; dropping a client into it is worse
    // than leaving the stylist idle.
    expect(chainOffersInterleave(chainWithShortGap)).toBe(false)
  })

  it('combines multiple services under one pair of buffers', () => {
    const combined = buildChain([BALAYAGE, CUT], { settings: SETTINGS })
    expect(combined.filter((l) => l.kind === 'BUFFER_AFTER')).toHaveLength(1)
  })
})

describe('basic availability', () => {
  it('offers slots across an empty day', () => {
    const result = computeAvailability(request())
    expect(result.reason).toBeNull()
    expect(result.slots.length).toBeGreaterThan(20)
  })

  it('aligns starts to the granularity grid', () => {
    const result = computeAvailability(request())
    for (const slot of result.slots) {
      expect((slot.startMin - at(9)) % 15).toBe(0)
    }
  })

  it('never offers a slot that would run past closing', () => {
    const result = computeAvailability(request())
    for (const slot of result.slots) {
      expect(slot.endMin).toBeLessThanOrEqual(at(17))
    }
  })

  it('respects a grace period past closing when the salon allows one', () => {
    const result = computeAvailability(
      request({ settings: { ...SETTINGS, allowFinishAfterCloseMin: 30 } }),
    )
    const latest = Math.max(...result.slots.map((s) => s.endMin))
    expect(latest).toBeGreaterThan(at(17))
    expect(latest).toBeLessThanOrEqual(at(17, 30))
  })

  it('honours the minimum booking lead time', () => {
    const result = computeAvailability(
      request({ nowMin: at(10), settings: { ...SETTINGS, minBookingLeadMin: 120 } }),
    )
    expect(Math.min(...result.slots.map((s) => s.startMin))).toBeGreaterThanOrEqual(at(12))
  })

  it('returns nothing on a day the salon is closed', () => {
    const result = computeAvailability(request({ openIntervals: { [DATE]: [] } }))
    expect(result.slots).toEqual([])
    expect(result.reason).toBe('FULLY_BOOKED')
  })
})

describe('existing bookings', () => {
  it('never overlaps a busy interval', () => {
    const busy = [{ start: at(11), end: at(13) }]
    const result = computeAvailability(request({ candidates: [stylist({ busyIntervals: busy })] }))
    for (const slot of result.slots) {
      expect(slot.startMin >= at(13) || slot.endMin <= at(11)).toBe(true)
    }
  })

  it('will not straddle a gap between two bookings', () => {
    // Free 09:00–11:00 and 12:00–17:00. A 55-minute service cannot start at
    // 10:30 and finish at 11:25 by borrowing across the busy block.
    const busy = [{ start: at(11), end: at(12) }]
    const result = computeAvailability(request({ candidates: [stylist({ busyIntervals: busy })] }))
    expect(result.slots.some((s) => s.startMin === at(10, 30))).toBe(false)
    expect(result.slots.some((s) => s.startMin === at(10, 0))).toBe(true)
  })

  it('fills a gap exactly the size of the service', () => {
    const busy = [
      { start: at(9), end: at(11) },
      { start: at(11, 55), end: at(17) },
    ]
    const result = computeAvailability(request({ candidates: [stylist({ busyIntervals: busy })] }))
    expect(result.slots.map((s) => s.startMin)).toContain(at(11))
  })

  it('reports FULLY_BOOKED when the day is solid', () => {
    const result = computeAvailability(
      request({ candidates: [stylist({ busyIntervals: [{ start: at(9), end: at(17) }] })] }),
    )
    expect(result.slots).toEqual([])
    expect(result.reason).toBe('FULLY_BOOKED')
  })
})

describe('interleaving during processing', () => {
  const interleaveSettings = { ...SETTINGS, interleaveEnabled: true }

  it('the stylist is not blocked during a usable processing gap', () => {
    const chain = buildChain([BALAYAGE], { settings: interleaveSettings })
    const processing = chain.find((l) => l.kind === 'PROCESSING')!
    expect(processing.blocksStylist).toBe(false)
  })

  it('a second client can be booked into the first one’s development time', () => {
    // Client A is mid-balayage: active 09:00-10:30, processing 10:30-11:10,
    // finish 11:10-11:55. The stylist is genuinely free in the middle 40.
    const busy = [
      { start: at(9), end: at(10, 30) },
      { start: at(10, 70 / 60 + 10), end: at(11, 55) },
    ]
    const result = computeAvailability(
      request({
        settings: interleaveSettings,
        candidates: [
          stylist({
            busyIntervals: [
              { start: at(9), end: at(10, 30) },
              { start: at(11, 10), end: at(11, 55) },
            ],
            clientIntervals: [{ start: at(9), end: at(11, 55) }],
          }),
        ],
        chain: buildChain(
          [{ ...CUT, phases: [{ ...CUT.phases[0]!, durationMin: 30 }], bufferAfterMin: 0 }],
          { settings: interleaveSettings },
        ),
      }),
    )
    expect(busy.length).toBe(2)
    expect(result.slots.some((s) => s.startMin === at(10, 30))).toBe(true)
  })

  it('refuses to exceed the concurrency cap', () => {
    // Two clients already in flight, cap of 2 — no third may be added.
    const result = computeAvailability(
      request({
        settings: { ...interleaveSettings, maxConcurrentClients: 2 },
        candidates: [
          stylist({
            clientIntervals: [
              { start: at(9), end: at(12) },
              { start: at(9, 30), end: at(12) },
            ],
          }),
        ],
      }),
    )
    for (const slot of result.slots) {
      expect(slot.startMin).toBeGreaterThanOrEqual(at(12))
    }
  })
})

describe('resources', () => {
  it('assigns a concrete chair to every phase that needs one', () => {
    const result = computeAvailability(request())
    const slot = result.slots[0]!
    const active = slot.placements.filter((p) => p.kind === 'ACTIVE')
    expect(active.every((p) => p.resourceId?.startsWith('chair_'))).toBe(true)
  })

  it('routes processing to a processing seat, not a chair', () => {
    const result = computeAvailability(
      request({ chain: buildChain([BALAYAGE], { settings: SETTINGS }) }),
    )
    const processing = result.slots[0]!.placements.find((p) => p.kind === 'PROCESSING')!
    expect(processing.resourceId).toMatch(/^seat_/)
  })

  it('offers nothing when every chair is taken', () => {
    const busyChairs = resources(1, 2).map((r) =>
      r.type === 'CHAIR' ? { ...r, busyIntervals: [{ start: at(9), end: at(17) }] } : r,
    )
    const result = computeAvailability(request({ resources: busyChairs }))
    expect(result.slots).toEqual([])
  })

  it('picks a free chair when one of several is busy', () => {
    const mixed = resources(2, 2).map((r) =>
      r.resourceId === 'chair_0' ? { ...r, busyIntervals: [{ start: at(9), end: at(17) }] } : r,
    )
    const result = computeAvailability(request({ resources: mixed }))
    expect(result.slots.length).toBeGreaterThan(0)
    expect(result.slots[0]!.placements[0]!.resourceId).toBe('chair_1')
  })
})

describe('stylist filtering', () => {
  it('excludes a stylist without the required skill, and says why', () => {
    const result = computeAvailability(
      request({
        candidates: [stylist({ skills: { BALAYAGE: 2 } })],
        requiredSkill: { code: 'BALAYAGE', level: 4 },
      }),
    )
    expect(result.slots).toEqual([])
    expect(result.reason).toBe('NO_CAPABLE_STYLIST')
    expect(result.excluded[0]!.reason).toMatch(/signed off/)
  })

  it('excludes a stylist not taking new clients, for a new client only', () => {
    const candidates = [stylist({ acceptsNewClients: false })]
    expect(computeAvailability(request({ candidates, isNewClient: true })).slots).toEqual([])
    expect(
      computeAvailability(request({ candidates, isNewClient: false })).slots.length,
    ).toBeGreaterThan(0)
  })

  it('honours a pinned stylist', () => {
    const result = computeAvailability(
      request({
        candidates: [stylist({ stylistId: 'a' }), stylist({ stylistId: 'b' })],
        constraints: { notBeforeMin: null, notAfterMin: null, pinnedStylistId: 'b' },
      }),
    )
    expect(result.slots.every((s) => s.stylistId === 'b')).toBe(true)
  })

  it('enforces a daily ceiling on chemical services', () => {
    const capped = stylist({ maxDailyChemicalServices: 3, dailyChemicalCounts: { [DATE]: 3 } })
    expect(computeAvailability(request({ candidates: [capped], isChemical: true })).slots).toEqual(
      [],
    )
    // A non-chemical service is unaffected by the chemical cap.
    expect(
      computeAvailability(request({ candidates: [capped], isChemical: false })).slots.length,
    ).toBeGreaterThan(0)
  })

  it('applies a per-stylist lead time override', () => {
    const result = computeAvailability(
      request({ nowMin: at(9), candidates: [stylist({ leadMinOverride: 240 })] }),
    )
    expect(Math.min(...result.slots.map((s) => s.startMin))).toBeGreaterThanOrEqual(at(13))
  })
})

describe('constraints and ranking', () => {
  it('respects an earliest bound from a multi-session gap', () => {
    const result = computeAvailability(
      request({ constraints: { notBeforeMin: at(14), notAfterMin: null, pinnedStylistId: null } }),
    )
    expect(Math.min(...result.slots.map((s) => s.startMin))).toBeGreaterThanOrEqual(at(14))
  })

  it('respects a latest bound', () => {
    const result = computeAvailability(
      request({ constraints: { notBeforeMin: null, notAfterMin: at(12), pinnedStylistId: null } }),
    )
    expect(Math.max(...result.slots.map((s) => s.endMin))).toBeLessThanOrEqual(at(12))
  })

  it('returns OUTSIDE_BOOKING_WINDOW when the bounds cross', () => {
    const result = computeAvailability(
      request({
        constraints: { notBeforeMin: at(16), notAfterMin: at(10), pinnedStylistId: null },
      }),
    )
    expect(result.reason).toBe('OUTSIDE_BOOKING_WINDOW')
  })

  /*
   * The narrowing a stylist applies at approval. Distinct from the absolute
   * bounds above: those are a multi-session gap in epoch minutes, these are
   * local days and wall-clock times that recur.
   */
  describe('a booking window', () => {
    const narrowed = (window: Partial<BookingWindow>) =>
      computeAvailability(
        request({
          constraints: { pinnedStylistId: null, window: { ...ANY_TIME, ...window } },
        }),
      )

    it('changes nothing when it narrows nothing', () => {
      const open = computeAvailability(request())
      expect(narrowed({}).slots).toEqual(open.slots)
    })

    // DATE is a Monday, so a Tuesdays-only plan has nothing here.
    it('drops a day the mask excludes', () => {
      expect(narrowed({ dayOfWeekMask: maskOf([2]) }).slots).toEqual([])
    })

    it('keeps a day it includes', () => {
      expect(narrowed({ dayOfWeekMask: maskOf([1]) }).slots.length).toBeGreaterThan(0)
    })

    it('holds starts to the time of day', () => {
      const result = narrowed({ windowStartMinute: 11 * 60, windowEndMinute: 13 * 60 })
      expect(result.slots.length).toBeGreaterThan(0)
      for (const slot of result.slots) {
        expect(slot.startMin).toBeGreaterThanOrEqual(at(11))
        expect(slot.startMin).toBeLessThanOrEqual(at(13))
      }
    })

    /*
     * The bar is on the start, not the finish. Bounding the finish would
     * return nothing for exactly the long, difficult services this exists to
     * control — and returning nothing reads to a client as "fully booked".
     */
    it('lets a long appointment run past the end of the window', () => {
      const result = computeAvailability(
        request({
          chain: buildChain([BALAYAGE], { settings: SETTINGS }),
          resources: resources(2, 1),
          constraints: {
            pinnedStylistId: null,
            window: { ...ANY_TIME, windowStartMinute: 9 * 60, windowEndMinute: 10 * 60 },
          },
        }),
      )
      expect(result.slots.length).toBeGreaterThan(0)
      expect(Math.max(...result.slots.map((s) => s.endMin))).toBeGreaterThan(at(10))
    })

    it('says the window is why, not that the salon is full', () => {
      expect(narrowed({ dayOfWeekMask: maskOf([2]) }).reason).toBe('OUTSIDE_BOOKING_WINDOW')
    })

    it('spends its per-day cap on times inside the window', () => {
      // The cap is applied per day after ranking. Filtering the finished list
      // instead of the candidate starts would have thrown away most of these.
      const result = computeAvailability(
        request({
          maxPerDay: 3,
          constraints: {
            pinnedStylistId: null,
            window: { ...ANY_TIME, windowStartMinute: 15 * 60, windowEndMinute: 16 * 60 },
          },
        }),
      )
      expect(result.slots).toHaveLength(3)
      expect(result.slots.every((s) => s.startMin >= at(15))).toBe(true)
    })

    it('composes with the absolute bounds rather than replacing them', () => {
      const result = computeAvailability(
        request({
          constraints: {
            notBeforeMin: at(13),
            pinnedStylistId: null,
            window: { ...ANY_TIME, windowStartMinute: 9 * 60, windowEndMinute: 15 * 60 },
          },
        }),
      )
      expect(result.slots.length).toBeGreaterThan(0)
      // Later of the two floors, earlier of the two ceilings.
      expect(Math.min(...result.slots.map((s) => s.startMin))).toBeGreaterThanOrEqual(at(13))
      expect(Math.max(...result.slots.map((s) => s.startMin))).toBeLessThanOrEqual(at(15))
    })
  })

  // Gap-fill is the metric salon owners actually care about.
  it('ranks a slot that exactly fills a dead gap above one with slack', () => {
    const busy = [
      { start: at(9), end: at(10) },
      { start: at(10, 55), end: at(13) },
    ]
    const result = computeAvailability(request({ candidates: [stylist({ busyIntervals: busy })] }))
    const gapFiller = result.slots.find((s) => s.startMin === at(10))!
    const openAfternoon = result.slots.find((s) => s.startMin === at(15))!
    expect(gapFiller.score).toBeGreaterThan(openAfternoon.score)
  })

  it('caps the number of slots returned per day', () => {
    const result = computeAvailability(request({ maxPerDay: 3 }))
    expect(result.slots).toHaveLength(3)
  })
})

describe('every returned slot is genuinely bookable', () => {
  // The invariant that matters: whatever we offer must survive being booked.
  it('no offered slot overlaps a busy interval or misses a resource', () => {
    const busy = [
      { start: at(10), end: at(11) },
      { start: at(14), end: at(15, 30) },
    ]
    const result = computeAvailability(
      request({
        candidates: [stylist({ busyIntervals: busy })],
        chain: buildChain([BALAYAGE], { settings: SETTINGS }),
        resources: resources(2, 1),
        isChemical: true,
      }),
    )

    expect(result.slots.length).toBeGreaterThan(0)

    for (const slot of result.slots) {
      for (const placement of slot.placements) {
        for (const block of busy) {
          const clashes =
            placement.interval.start < block.end && block.start < placement.interval.end
          expect(clashes, `phase ${placement.label} overlaps a booking`).toBe(false)
        }
        if (placement.kind === 'ACTIVE') expect(placement.resourceId).not.toBeNull()
      }
      expect(slot.endMin - slot.startMin).toBe(175)
      expect(slot.startMin).toBeGreaterThanOrEqual(at(9))
      expect(slot.endMin).toBeLessThanOrEqual(at(17))
    }
  })
})
