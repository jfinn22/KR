import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import {
  addEndpoint,
  deliverWebhooks,
  emitWebhook,
  listEndpoints,
  removeEndpoint,
  signWebhook,
  syncExternalBusy,
  verifyWebhook,
} from '@/server/services/integrations'

/**
 * A salon's events reaching a salon's own systems.
 *
 * The signing scheme, the topic vocabulary and the emitter were all built with
 * the integrations work, and nothing stored a URL — so there was nowhere for an
 * event to go, while the pricing page sold API_ACCESS as "The API". Worse, the
 * emitter wrote into `Outbox`, which is the platform's own notification
 * pipeline: calling it would have double-fired the client-facing messages
 * `outboxDispatch` materialises from the same topic names.
 */

const S = 'wh_salon'
const STYLIST = 'wh_sty'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@wh.test' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'wh-salon',
      name: 'Webhook Test Salon',
      defaultTimezone: 'Europe/London',
      settings: { create: {} },
      locations: { create: { id: 'wh_loc', name: 'Main', timezone: 'Europe/London' } },
    },
  })

  const user = await unsafeDb.user.create({ data: { email: 'sty@wh.test', name: 'Kit' } })
  const membership = await unsafeDb.membership.create({
    data: { salonId: S, userId: user.id, role: 'STYLIST' },
  })
  await unsafeDb.stylistProfile.create({
    data: {
      id: STYLIST,
      salonId: S,
      membershipId: membership.id,
      displayName: 'Kit',
      defaultLocationId: 'wh_loc',
    },
  })
}

beforeEach(seed)
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@wh.test' } } })
})

/** A fetch that records what it was given and answers however the test says. */
function stubFetch(status: number) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: String(init.body),
    })
    return new Response(null, { status })
  })
  return calls
}

describe('registering an endpoint', () => {
  it('refuses anything that is not https', async () => {
    await expect(
      addEndpoint({ salonId: S, url: 'http://example.com/hook', topics: [] }),
    ).rejects.toThrow(/start with https/)
  })

  it('refuses something that is not a web address at all', async () => {
    await expect(addEndpoint({ salonId: S, url: 'not a url', topics: [] })).rejects.toThrow(
      /web address/,
    )
  })

  it('mints a secret and never lists it again', async () => {
    const { secret } = await addEndpoint({
      salonId: S,
      url: 'https://example.com/hook',
      topics: [],
    })
    expect(secret).toMatch(/^whsec_/)

    /*
     * The one credential here stored in the clear, because a signature the
     * receiver can verify needs both sides to hold the same value. So the
     * listing must never carry it — that is the only thing standing between a
     * settings screen and somebody else's forgeable events.
     */
    const listed = await listEndpoints(S)
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(secret)
  })
})

describe('queueing an event', () => {
  it('writes one delivery per endpoint that wants the topic', async () => {
    await addEndpoint({ salonId: S, url: 'https://a.example.com/h', topics: ['appointment.booked'] })
    await addEndpoint({ salonId: S, url: 'https://b.example.com/h', topics: [] })
    await addEndpoint({
      salonId: S,
      url: 'https://c.example.com/h',
      topics: ['payment.captured'],
    })

    // Two want it: the one that named it, and the one that named nothing.
    const result = await emitWebhook({
      salonId: S,
      topic: 'appointment.booked',
      payload: { appointmentId: 'apt_1' },
    })
    expect(result.queued).toBe(2)
  })

  it('does not touch the platform notification outbox', async () => {
    /*
     * The old emitter wrote an `Outbox` row, which is the queue that turns a
     * topic into a text message to a client. Emitting a webhook would have sent
     * the client a second copy of every notification.
     */
    const before = await unsafeDb.outbox.count({ where: { salonId: S } })
    await addEndpoint({ salonId: S, url: 'https://a.example.com/h', topics: [] })
    await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: {} })

    expect(await unsafeDb.outbox.count({ where: { salonId: S } })).toBe(before)
  })

  it('queues nothing when nobody is listening', async () => {
    const result = await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: {} })
    expect(result.queued).toBe(0)
  })
})

describe('delivering', () => {
  it('posts a body the receiver can verify, and marks it delivered', async () => {
    const { secret } = await addEndpoint({
      salonId: S,
      url: 'https://example.com/hook',
      topics: [],
    })
    await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: { appointmentId: 'a1' } })

    const calls = stubFetch(200)
    const result = await deliverWebhooks()

    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(calls).toHaveLength(1)

    // The whole point of the exercise: the receiver can prove it came from us.
    const call = calls[0]!
    expect(
      verifyWebhook({
        secret,
        body: call.body,
        timestamp: Number(call.headers['x-salon-timestamp']),
        signature: call.headers['x-salon-signature'] ?? '',
      }),
    ).toBe(true)

    const delivery = await unsafeDb.webhookDelivery.findFirstOrThrow({ where: { salonId: S } })
    expect(delivery.status).toBe('DELIVERED')
    expect(delivery.responseCode).toBe(200)
  })

  it('refuses a signature made with the wrong secret', async () => {
    const body = JSON.stringify({ topic: 'appointment.booked' })
    const timestamp = Math.floor(Date.now() / 1000)

    expect(
      verifyWebhook({
        secret: 'whsec_right',
        body,
        timestamp,
        signature: signWebhook('whsec_wrong', body, timestamp),
      }),
    ).toBe(false)
  })

  it('refuses a signature that is valid but old', async () => {
    /*
     * A signature over the body alone is valid forever, so a request captured
     * once could be replayed indefinitely. The timestamp is what closes that.
     */
    const body = JSON.stringify({ topic: 'appointment.booked' })
    const stale = Math.floor(Date.now() / 1000) - 3600

    expect(
      verifyWebhook({
        secret: 'whsec_x',
        body,
        timestamp: stale,
        signature: signWebhook('whsec_x', body, stale),
      }),
    ).toBe(false)
  })

  it('leaves a failed delivery pending so the next sweep tries again', async () => {
    await addEndpoint({ salonId: S, url: 'https://example.com/hook', topics: [] })
    await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: {} })

    stubFetch(500)
    expect(await deliverWebhooks()).toEqual({ sent: 0, failed: 1 })

    const delivery = await unsafeDb.webhookDelivery.findFirstOrThrow({ where: { salonId: S } })
    expect(delivery.status).toBe('PENDING')
    expect(delivery.attempts).toBe(1)
    expect(delivery.error).toContain('500')

    // And the endpoint carries the failure, so the screen can say so.
    const [endpoint] = await listEndpoints(S)
    expect(endpoint?.failureCount).toBe(1)
    expect(endpoint?.lastError).toContain('500')
  })

  it('gives up on a delivery that has failed too many times', async () => {
    await addEndpoint({ salonId: S, url: 'https://example.com/hook', topics: [] })
    await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: {} })

    stubFetch(500)
    for (let attempt = 0; attempt < 8; attempt += 1) await deliverWebhooks()

    const delivery = await unsafeDb.webhookDelivery.findFirstOrThrow({ where: { salonId: S } })
    expect(delivery.status).toBe('FAILED')
  })

  it('clears the failure count once one lands', async () => {
    await addEndpoint({ salonId: S, url: 'https://example.com/hook', topics: [] })
    await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: {} })

    stubFetch(500)
    await deliverWebhooks()
    expect((await listEndpoints(S))[0]?.failureCount).toBe(1)

    vi.unstubAllGlobals()
    stubFetch(200)
    await deliverWebhooks()

    const [endpoint] = await listEndpoints(S)
    expect(endpoint?.failureCount).toBe(0)
    expect(endpoint?.lastError).toBeNull()
  })

  it('removing an endpoint takes its deliveries with it', async () => {
    const { id } = await addEndpoint({ salonId: S, url: 'https://example.com/h', topics: [] })
    await emitWebhook({ salonId: S, topic: 'appointment.booked', payload: {} })
    expect(await unsafeDb.webhookDelivery.count({ where: { salonId: S } })).toBe(1)

    await removeEndpoint(S, id)
    expect(await unsafeDb.webhookDelivery.count({ where: { salonId: S } })).toBe(0)
  })

  it('refuses to remove an endpoint belonging to another salon', async () => {
    const { id } = await addEndpoint({ salonId: S, url: 'https://example.com/h', topics: [] })
    await expect(removeEndpoint('some_other_salon', id)).rejects.toThrow(/no longer exists/)
  })
})

describe('mirroring an external calendar', () => {
  it('replaces only its own rows, so two sources cannot delete each other', async () => {
    /*
     * A stylist can plausibly have a personal calendar and a salon-wide one
     * connected at once. A sync that cleared the table would make the two take
     * it in turns to erase each other, and the diary would flicker.
     */
    await unsafeDb.externalBusy.create({
      data: {
        salonId: S,
        stylistProfileId: STYLIST,
        startsAt: new Date('2026-06-01T09:00:00Z'),
        endsAt: new Date('2026-06-01T10:00:00Z'),
        source: 'somebody-else',
      },
    })

    await syncExternalBusy({
      salonId: S,
      stylistProfileId: STYLIST,
      timeZone: 'Europe/London',
      days: 1,
      today: '2026-06-01',
    })

    const survivors = await unsafeDb.externalBusy.findMany({
      where: { salonId: S, source: 'somebody-else' },
    })
    expect(survivors).toHaveLength(1)
  })

  it('writes nothing when no calendar is connected', async () => {
    const result = await syncExternalBusy({
      salonId: S,
      stylistProfileId: STYLIST,
      timeZone: 'Europe/London',
      days: 3,
      today: '2026-06-01',
    })

    expect(result.mirrored).toBe(0)
  })
})
