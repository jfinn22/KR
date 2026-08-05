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
  await unsafeDb.user.deleteMany({ where: { email: 'nt-rowan@example.com' } })

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
  await unsafeDb.user.deleteMany({ where: { email: 'nt-rowan@example.com' } })
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

describe('the stylist speaking to the client', () => {
  /*
   * `notesToClient` is collected in the decision panel and persisted on both
   * ConsultationReview and ServicePlan. Nothing selected it — so the one part
   * of a decision written in a person's own words reached the client never.
   * The gap was a missing field in a `select`, which is exactly the kind of
   * thing no type error catches.
   */
  it('is carried out of the plan and into what the client reads', async () => {
    const client = await unsafeDb.clientProfile.create({
      data: { salonId: S, firstName: 'Nell', lastName: 'Gwyn', email: 'nt-nell@example.com' },
      select: { id: true },
    })

    const template = await unsafeDb.consultationTemplate.create({
      data: { salonId: S, key: 'nt-consult', version: 1, status: 'PUBLISHED', name: 'Test' },
      select: { id: true, version: true },
    })

    const consultation = await unsafeDb.consultation.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        templateId: template.id,
        templateVersion: template.version,
        status: 'APPROVED',
        requestedServiceIds: [],
      },
      select: { id: true },
    })

    // A ServicePlan needs a stylist, a stylist needs a membership, and a
    // membership needs a user — the graph is required all the way down,
    // because a plan nobody is assigned to is not a plan.
    const user = await unsafeDb.user.create({
      data: { email: 'nt-rowan@example.com', name: 'Rowan' },
      select: { id: true },
    })
    const stylist = await unsafeDb.stylistProfile.create({
      data: {
        salon: { connect: { id: S } },
        displayName: 'Rowan',
        membership: {
          create: { salonId: S, userId: user.id, role: 'STYLIST', status: 'ACTIVE' },
        },
      },
      select: { id: true },
    })

    const note = 'Your ends are drier than the photo suggests — we will go steady.'
    await unsafeDb.servicePlan.create({
      data: {
        salonId: S,
        clientProfileId: client.id,
        consultationId: consultation.id,
        stylistProfileId: stylist.id,
        status: 'APPROVED',
        estimatedTotalMin: 90,
        estimatedTotalCents: 12000,
        rulesetVersion: 'test',
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        notesToClient: note,
      },
    })

    const { consultationContext } = await import('@/server/services/client-portal')
    const view = await consultationContext(S, consultation.id)

    expect(view.notesToClient).toBe(note)
  })
})
