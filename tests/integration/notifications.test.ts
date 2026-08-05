import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { materialiseNotification } from '@/server/services/notifications'

/**
 * Turning "something happened" into "somebody was told".
 *
 * The materialiser was welded to appointments — it hardcoded
 * APPOINTMENT_BEFORE and required an Appointment — so every other trigger in
 * the enum had nowhere to go. `notificationSend` needs a ScheduledNotification
 * row keyed by dedupeKey and silently returns when there is none, which is why
 * the gap was invisible: nothing errored, clients simply were not told.
 */

const S = 'nt_salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.job.deleteMany({ where: { salonId: S } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'nt-test-salon',
      name: 'Notification Test Salon',
      defaultTimezone: 'America/New_York',
      settings: { create: {} },
      clientProfiles: {
        create: {
          id: 'nt_client',
          firstName: 'Ada',
          lastName: 'Byron',
          email: 'nt-ada@example.com',
        },
      },
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.job.deleteMany({ where: { salonId: S } })
})

const scheduledFor = (refId: string) =>
  unsafeDb.scheduledNotification.findMany({ where: { salonId: S, refId } })

describe('a trigger with no configured schedule', () => {
  it('still reaches the client when the message is part of the service', async () => {
    // A salon that has not written a template has not decided its clients
    // should hear nothing about their own consultation.
    const result = await materialiseNotification({
      salonId: S,
      trigger: 'CONSULT_DECISION',
      refType: 'Consultation',
      refId: 'nt_consult_1',
      clientProfileId: 'nt_client',
    })

    expect(result.scheduled).toBe(1)

    const rows = await scheduledFor('nt_consult_1')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.trigger).toBe('CONSULT_DECISION')
    // Denormalised so the sender knows what this is without a schedule row.
    expect(rows[0]!.scheduleId).toBeNull()
  })

  it('stays silent when the message would be the salon speaking', async () => {
    // A rebooking nudge nobody configured would be putting words in their mouth.
    const result = await materialiseNotification({
      salonId: S,
      trigger: 'REBOOK_DUE',
      refType: 'ClientProfile',
      refId: 'nt_client',
      clientProfileId: 'nt_client',
    })

    expect(result.scheduled).toBe(0)
    expect(await scheduledFor('nt_client')).toHaveLength(0)
  })

  it('queues a job the sender can actually pick up', async () => {
    await materialiseNotification({
      salonId: S,
      trigger: 'CONSULT_DECISION',
      refType: 'Consultation',
      refId: 'nt_consult_2',
      clientProfileId: 'nt_client',
    })

    const rows = await scheduledFor('nt_consult_2')
    const job = await unsafeDb.job.findFirst({
      where: { salonId: S, type: 'notification.send' },
      orderBy: { createdAt: 'desc' },
    })

    // The bug this replaced: a job enqueued for a dedupeKey no row carried.
    expect(job).toBeTruthy()
    expect((job?.payloadJson as { dedupeKey?: string }).dedupeKey).toBe(rows[0]!.dedupeKey)
  })
})

describe('a trigger the salon has configured', () => {
  async function withSchedule(offsetMinutes: number) {
    const template = await unsafeDb.messageTemplate.create({
      data: {
        salonId: S,
        key: 'nt-tpl',
        name: 'Decision',
        channel: 'EMAIL',
        subject: 'Hi',
        body: 'Hello',
      },
    })
    await unsafeDb.notificationSchedule.create({
      data: {
        salonId: S,
        key: 'nt-decision',
        trigger: 'CONSULT_DECISION',
        offsetMinutes,
        channel: 'EMAIL',
        templateId: template.id,
      },
    })
  }

  it('uses the schedule and links it', async () => {
    await withSchedule(0)

    const result = await materialiseNotification({
      salonId: S,
      trigger: 'CONSULT_DECISION',
      refType: 'Consultation',
      refId: 'nt_consult_3',
      clientProfileId: 'nt_client',
    })

    expect(result.scheduled).toBe(1)
    const rows = await scheduledFor('nt_consult_3')
    expect(rows[0]!.scheduleId).toBeTruthy()
  })

  it('does not drop an offset of zero on an event that has just happened', async () => {
    // The old materialiser skipped any sendAt already past, which is right for
    // a reminder before a future appointment and wrong for "this just
    // happened, tell them now".
    await withSchedule(0)

    const result = await materialiseNotification({
      salonId: S,
      trigger: 'CONSULT_DECISION',
      refType: 'Consultation',
      refId: 'nt_consult_4',
      clientProfileId: 'nt_client',
      anchorAt: new Date(),
    })

    expect(result.scheduled).toBe(1)
  })

  it('still drops a reminder that would fire after the thing it reminds about', async () => {
    await withSchedule(-1440)

    const result = await materialiseNotification({
      salonId: S,
      trigger: 'CONSULT_DECISION',
      refType: 'Consultation',
      refId: 'nt_consult_5',
      clientProfileId: 'nt_client',
      // Anchored ten minutes out: "24 hours before" is already long past.
      anchorAt: new Date(Date.now() + 10 * 60_000),
    })

    expect(result.scheduled).toBe(0)
  })
})

describe('materialising twice', () => {
  it('is idempotent, so a retried job does not double-send', async () => {
    for (let i = 0; i < 3; i++) {
      await materialiseNotification({
        salonId: S,
        trigger: 'CONSULT_DECISION',
        refType: 'Consultation',
        refId: 'nt_consult_6',
        clientProfileId: 'nt_client',
      })
    }

    expect(await scheduledFor('nt_consult_6')).toHaveLength(1)
  })
})
