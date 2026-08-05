import { describe, expect, it } from 'vitest'
import {
  firstTimersAtRisk,
  rebookDueAt,
  rebookRates,
  type Visit,
} from '@/domain/retention/windows'

/**
 * Whether somebody came back, and whether it is fair to ask yet.
 *
 * Both of the traps tested here make a retention dashboard quietly wrong rather
 * than obviously broken, which is why they are worth pinning down: a number
 * that is merely pessimistic gets believed, and then acted on.
 */

const NOW = new Date('2026-06-01T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function visit(client: string, stylist: string, daysAgo: number): Visit {
  return { clientProfileId: client, stylistProfileId: stylist, at: day(daysAgo) }
}

describe('did they come back', () => {
  it('counts a return inside the window', () => {
    const visits = [visit('ada', 'wren', 200)]
    const all = [...visits, visit('ada', 'wren', 150)]
    expect(rebookRates(visits, all, NOW)).toEqual([
      { stylistProfileId: 'wren', eligible: 1, returned: 1, rate: 1 },
    ])
  })

  it('does not count one that took too long', () => {
    const visits = [visit('ada', 'wren', 300)]
    const all = [...visits, visit('ada', 'wren', 100)] // 200 days later
    expect(rebookRates(visits, all, NOW)[0]).toMatchObject({ eligible: 1, returned: 0, rate: 0 })
  })

  it('will not count a visit whose window has not closed yet', () => {
    /*
     * A client seen last Tuesday has not failed to return — they have not been
     * asked to. Counting them as a failure drags every recent period down, so
     * the number always looks worse than the salon is and always improves the
     * moment you stop looking.
     */
    const visits = [visit('ada', 'wren', 5)]
    expect(rebookRates(visits, visits, NOW)).toEqual([])
  })

  it('still counts a recent visit the client has already returned from', () => {
    // Not a prediction — a fact. Dropping it understates a salon doing well now.
    const visits = [visit('ada', 'wren', 20)]
    const all = [...visits, visit('ada', 'wren', 2)]
    expect(rebookRates(visits, all, NOW)[0]).toMatchObject({ eligible: 1, returned: 1 })
  })

  it('counts a return to anybody in the salon', () => {
    /*
     * A client who came back and saw somebody else is a client the salon kept.
     * The stylist cut is about who brought them in — blaming a colourist
     * because the client's next booking was a cut is how a good number becomes
     * a bad argument.
     */
    const visits = [visit('ada', 'wren', 200)]
    const all = [...visits, visit('ada', 'sam', 160)]
    expect(rebookRates(visits, all, NOW)[0]).toMatchObject({
      stylistProfileId: 'wren',
      returned: 1,
    })
  })

  it('says nothing rather than zero when nobody was eligible', () => {
    // A rate of 0 reads as "nobody came back". Null reads as "we cannot say".
    expect(rebookRates([], [], NOW)).toEqual([])
  })

  it('sorts the best first', () => {
    const visits = [
      visit('a', 'wren', 200),
      visit('b', 'wren', 200),
      visit('c', 'sam', 200),
      visit('d', 'sam', 200),
    ]
    const all = [...visits, visit('a', 'wren', 150), visit('c', 'sam', 150), visit('d', 'sam', 150)]
    const rates = rebookRates(visits, all, NOW)
    expect(rates.map((r) => r.stylistProfileId)).toEqual(['sam', 'wren'])
    expect(rates[0]?.rate).toBe(1)
    expect(rates[1]?.rate).toBe(0.5)
  })
})

describe('first-timers worth calling', () => {
  const ada = { clientProfileId: 'ada', stylistProfileId: 'wren', firstVisitAt: day(45) }

  it('lists somebody past the grace period who has not returned', () => {
    expect(firstTimersAtRisk([ada], new Set(), NOW)).toEqual([{ ...ada, daysSince: 45 }])
  })

  it('leaves alone somebody who was in last week', () => {
    // Chasing a client who was always coming back in six weeks is how a
    // retention feature becomes the reason they do not.
    const recent = { ...ada, firstVisitAt: day(8) }
    expect(firstTimersAtRisk([recent], new Set(), NOW)).toEqual([])
  })

  it('drops somebody who came back', () => {
    expect(firstTimersAtRisk([ada], new Set(['ada']), NOW)).toEqual([])
  })

  it('stops calling them a first-timer eventually', () => {
    // Two years on this is not an intervention, it is a lapsed client — a
    // different list and a different conversation.
    const long = { ...ada, firstVisitAt: day(400) }
    expect(firstTimersAtRisk([long], new Set(), NOW)).toEqual([])
  })

  it('puts the most urgent first', () => {
    const order = firstTimersAtRisk(
      [
        { ...ada, clientProfileId: 'late', firstVisitAt: day(80) },
        { ...ada, clientProfileId: 'soon', firstVisitAt: day(32) },
      ],
      new Set(),
      NOW,
    )
    expect(order.map((c) => c.clientProfileId)).toEqual(['soon', 'late'])
  })
})

describe('when to nudge', () => {
  it('uses the interval the plan actually said', () => {
    /*
     * A client told to come back in ten weeks and nudged at six is being sold
     * to. Nudged at ten they are being looked after, and the difference is the
     * whole reason the interval is recorded.
     */
    const due = rebookDueAt(new Date('2026-01-01T00:00:00Z'), 10)
    expect(due?.toISOString()).toBe('2026-03-12T00:00:00.000Z')
  })

  it('does not invent one', () => {
    expect(rebookDueAt(new Date(), null)).toBeNull()
    expect(rebookDueAt(new Date(), 0)).toBeNull()
  })
})
