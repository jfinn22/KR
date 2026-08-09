import { Prisma } from '@prisma/client'
import { unsafeDb } from '@/server/db/client'
import {
  fromEpochMinutes,
  localDateOfEpochMinutes,
  toEpochMinutes,
} from '@/domain/scheduling/zoned'
import { DomainError } from '@/server/errors'
import { invalidateAvailabilityCache } from './loader'
import { assessCancellation } from '@/server/services/commerce'
import type { PhaseChain, Slot } from '@/domain/scheduling/types'

/**
 * Holds and bookings.
 *
 * The solver proposes; this disposes. Every guarantee that actually protects a
 * client's slot is enforced here or by the database:
 *
 *  - Overlaps are rejected by a Postgres exclusion constraint (23P01), not by
 *    an application check that a concurrent request could race past.
 *  - Holds live in the same table as bookings, so a hold genuinely reserves.
 *  - Counting limits an exclusion constraint cannot express — concurrent
 *    clients, daily chemical services — are guarded by an advisory lock.
 *  - Confirming a hold PROMOTES its segments rather than deleting and
 *    reinserting them, so there is never an instant where the slot is free.
 */

export class SlotTakenError extends DomainError {
  constructor() {
    super('CONFLICT', 'That time was just taken. Here are the next available slots.')
  }
}

const PG_EXCLUSION_VIOLATION = '23P01'

function isSlotConflict(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2010 wraps a raw query failure; the driver code is in the meta.
    const code = (err.meta as { code?: string } | undefined)?.code
    if (code === PG_EXCLUSION_VIOLATION) return true
  }
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes(PG_EXCLUSION_VIOLATION) ||
    message.includes('segment_stylist_no_overlap') ||
    message.includes('segment_resource_no_overlap')
  )
}

/**
 * Serialise writers contending for the same stylist on the same day.
 *
 * Only needed for the counting invariants; the overlap constraint handles
 * itself. Scoped to (stylist, local date) so two stylists never block each
 * other and a busy salon is not serialised through one lock.
 */
async function lockStylistDay(
  tx: Prisma.TransactionClient,
  stylistId: string,
  localDate: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${stylistId}:${localDate}`}, 0))`
}

/**
 * Drop expired holds that are about to be contended.
 *
 * An exclusion constraint cannot reference now(), so an expired hold still
 * physically blocks its slot until something removes it. The hold.expire job
 * does this on a schedule; this does it opportunistically for exactly the rows
 * we are about to fight over, so a stalled worker cannot keep a slot locked.
 */
async function purgeExpiredHolds(
  tx: Prisma.TransactionClient,
  stylistId: string,
  resourceIds: readonly string[],
): Promise<void> {
  await tx.appointmentSegment.deleteMany({
    where: {
      state: 'HOLD',
      holdExpiresAt: { lt: new Date() },
      OR: [
        { stylistProfileId: stylistId },
        ...(resourceIds.length > 0 ? [{ resourceId: { in: [...resourceIds] } }] : []),
      ],
    },
  })
}

export interface CreateHoldInput {
  salonId: string
  locationId: string
  clientProfileId: string | null
  slot: Slot
  chain: PhaseChain
  servicePlanId?: string | null
  servicePlanSessionId?: string | null
  ttlSeconds: number
  createdByUserId?: string | null
  idempotencyKey?: string | null
  reason?: string | null
}

export async function createHold(
  input: CreateHoldInput,
): Promise<{ holdId: string; expiresAt: Date }> {
  const { slot, chain } = input
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000)
  const resourceIds = slot.placements
    .map((p) => p.resourceId)
    .filter((r): r is string => r !== null)
  const localDate = slot.localDate

  try {
    return await unsafeDb.$transaction(async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.bookingHold.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        })
        if (existing) return { holdId: existing.id, expiresAt: existing.expiresAt }
      }

      await purgeExpiredHolds(tx, slot.stylistId, resourceIds)
      await lockStylistDay(tx, slot.stylistId, localDate)

      const hold = await tx.bookingHold.create({
        data: {
          salonId: input.salonId,
          locationId: input.locationId,
          clientProfileId: input.clientProfileId,
          primaryStylistId: slot.stylistId,
          servicePlanId: input.servicePlanId ?? null,
          servicePlanSessionId: input.servicePlanSessionId ?? null,
          startsAt: fromEpochMinutes(slot.startMin),
          endsAt: fromEpochMinutes(slot.endMin),
          expiresAt,
          createdByUserId: input.createdByUserId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          reason: input.reason ?? null,
          payloadJson: { chain: chain as never, placements: slot.placements as never },
        },
      })

      await tx.appointmentSegment.createMany({
        data: slot.placements.map((placement) => {
          const link = chain[placement.index]!
          return {
            salonId: input.salonId,
            locationId: input.locationId,
            bookingHoldId: hold.id,
            stylistProfileId: slot.stylistId,
            resourceId: placement.resourceId,
            kind: link.kind,
            sequence: placement.index,
            startsAt: fromEpochMinutes(placement.interval.start),
            endsAt: fromEpochMinutes(placement.interval.end),
            blocksStylist: link.blocksStylist,
            blocksResource: link.blocksResource,
            state: 'HOLD' as const,
            holdExpiresAt: expiresAt,
          }
        }),
      })

      return { holdId: hold.id, expiresAt }
    })
  } catch (err) {
    if (isSlotConflict(err)) throw new SlotTakenError()
    throw err
  } finally {
    invalidateAvailabilityCache(input.salonId)
  }
}

export async function releaseHold(salonId: string, holdId: string): Promise<void> {
  await unsafeDb.$transaction(async (tx) => {
    const hold = await tx.bookingHold.findFirst({
      where: { id: holdId, salonId },
      select: { id: true, status: true },
    })
    // Consumed holds own live appointment segments. Deleting by bookingHoldId
    // after promote would wipe a real booking — only ACTIVE holds are free to
    // tear down, and only HOLD-state segments go with them.
    if (!hold || hold.status !== 'ACTIVE') return

    await tx.appointmentSegment.deleteMany({
      where: { salonId, bookingHoldId: holdId, state: 'HOLD' },
    })
    await tx.bookingHold.updateMany({
      where: { salonId, id: holdId, status: 'ACTIVE' },
      data: { status: 'RELEASED' },
    })
  })
  invalidateAvailabilityCache(salonId)
}

export interface BookFromHoldInput {
  salonId: string
  holdId: string
  clientProfileId: string
  services: readonly {
    serviceId: string
    serviceVariantId?: string | null
    plannedDurationMin: number
    priceCents: number
  }[]
  consultationId?: string | null
  source?: 'CLIENT_PORTAL' | 'FRONT_DESK' | 'WAITLIST' | 'REBOOK' | 'IMPORT'
  clientNote?: string | null
  createdByUserId?: string | null
  depositCents?: number
  timeZone: string
}

export interface BookingResult {
  appointmentId: string
  startsAt: Date
  endsAt: Date
  checkInToken: string
  /** The deposit this booking owes, PENDING and not yet asked for. */
  depositId?: string | null
}

/**
 * Turn a hold into a booking.
 *
 * The whole thing is one transaction, and the segments are UPDATEd from HOLD to
 * ACTIVE rather than recreated — delete-then-insert would open a window, however
 * brief, in which the slot appeared free to a concurrent booker.
 */
export async function bookFromHold(input: BookFromHoldInput): Promise<BookingResult> {
  try {
    return await unsafeDb.$transaction(async (tx) => {
      const hold = await tx.bookingHold.findFirst({
        where: { id: input.holdId, salonId: input.salonId },
        include: { segments: true },
      })

      if (!hold) throw new DomainError('NOT_FOUND', 'That hold no longer exists.')
      if (hold.status === 'CONSUMED') {
        throw new DomainError('CONFLICT', 'That hold has already been booked.')
      }
      if (hold.status !== 'ACTIVE' || hold.expiresAt < new Date()) {
        throw new DomainError('CONFLICT', 'That hold expired. Please pick a time again.')
      }

      const localDate = localDateOfEpochMinutes(toEpochMinutes(hold.startsAt), input.timeZone)
      await lockStylistDay(tx, hold.primaryStylistId, localDate)

      const checkInToken = `chk_${hold.id}`

      const appointment = await tx.appointment.create({
        data: {
          salonId: input.salonId,
          locationId: hold.locationId,
          clientProfileId: input.clientProfileId,
          primaryStylistId: hold.primaryStylistId,
          servicePlanId: hold.servicePlanId,
          servicePlanSessionId: hold.servicePlanSessionId,
          consultationId: input.consultationId ?? null,
          status: 'BOOKED',
          source: input.source ?? 'CLIENT_PORTAL',
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
          estimatedDurationMin: Math.round(
            (hold.endsAt.getTime() - hold.startsAt.getTime()) / 60_000,
          ),
          estimatedTotalCents: input.services.reduce((sum, s) => sum + s.priceCents, 0),
          clientNote: input.clientNote ?? null,
          checkInToken,
          createdByUserId: input.createdByUserId ?? null,
        },
      })

      for (const [index, service] of input.services.entries()) {
        await tx.appointmentService.create({
          data: {
            salonId: input.salonId,
            appointmentId: appointment.id,
            serviceId: service.serviceId,
            serviceVariantId: service.serviceVariantId ?? null,
            stylistProfileId: hold.primaryStylistId,
            sequence: index,
            plannedDurationMin: service.plannedDurationMin,
            priceCents: service.priceCents,
          },
        })
      }

      // Promote, never recreate. Clear bookingHoldId so a later releaseHold
      // (decline/sweep racing accept) cannot delete these segments by hold id.
      await tx.appointmentSegment.updateMany({
        where: { bookingHoldId: hold.id },
        data: {
          state: 'ACTIVE',
          holdExpiresAt: null,
          appointmentId: appointment.id,
          bookingHoldId: null,
        },
      })

      await tx.bookingHold.update({
        where: { id: hold.id },
        data: { status: 'CONSUMED' },
      })

      /*
       * PENDING means owed, not held. Nothing has been asked of a card inside
       * this transaction and nothing should be — a card network call inside a
       * transaction holding a slot-exclusion lock blocks every other booker
       * for as long as the bank takes to answer.
       *
       * The id comes back out so the caller can authorise it immediately
       * afterwards, outside the lock.
       */
      let depositId: string | null = null
      if (input.depositCents && input.depositCents > 0) {
        const deposit = await tx.deposit.create({
          data: {
            salonId: input.salonId,
            clientProfileId: input.clientProfileId,
            appointmentId: appointment.id,
            servicePlanId: hold.servicePlanId,
            amountCents: input.depositCents,
            status: 'PENDING',
          },
          select: { id: true },
        })
        depositId = deposit.id
      }

      if (hold.servicePlanSessionId) {
        await tx.servicePlanSession.update({
          where: { id: hold.servicePlanSessionId },
          data: { status: 'BOOKED' },
        })
      }

      // Committed with the booking, so a confirmation can never be lost
      // because a provider was down at the moment of commit.
      await tx.outbox.create({
        data: {
          salonId: input.salonId,
          topic: 'appointment.booked',
          payloadJson: {
            appointmentId: appointment.id,
            clientProfileId: input.clientProfileId,
            startsAt: appointment.startsAt.toISOString(),
          },
        },
      })

      return {
        appointmentId: appointment.id,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        checkInToken,
        depositId,
      }
    })
  } catch (err) {
    if (isSlotConflict(err)) throw new SlotTakenError()
    throw err
  } finally {
    invalidateAvailabilityCache(input.salonId)
  }
}

/** Book directly, without a client-facing hold. Front desk and seed use this. */
export async function bookDirect(
  input: Omit<CreateHoldInput, 'ttlSeconds'> & Omit<BookFromHoldInput, 'holdId' | 'salonId'>,
): Promise<BookingResult> {
  const { holdId } = await createHold({ ...input, ttlSeconds: 120 })
  return bookFromHold({ ...input, salonId: input.salonId, holdId })
}

export interface CancelInput {
  salonId: string
  appointmentId: string
  reason?: string | null
  cancelledByUserId?: string | null
  markNoShow?: boolean
}

export async function cancelAppointment(input: CancelInput): Promise<void> {
  await unsafeDb.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: { id: input.appointmentId, salonId: input.salonId },
      select: { id: true, version: true, status: true, servicePlanSessionId: true },
    })
    if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')

    // Optimistic lock: a concurrent reschedule must not be silently clobbered.
    const updated = await tx.appointment.updateMany({
      where: { id: appointment.id, version: appointment.version },
      data: {
        status: input.markNoShow ? 'NO_SHOW' : 'CANCELLED',
        cancelledAt: new Date(),
        ...(input.markNoShow ? { noShowAt: new Date() } : {}),
        cancellationReason: input.reason ?? null,
        cancelledByUserId: input.cancelledByUserId ?? null,
        version: { increment: 1 },
      },
    })
    if (updated.count === 0) {
      throw new DomainError('CONFLICT', 'Someone else just changed this appointment.')
    }

    // Free the time immediately so the waitlist can be offered it.
    await tx.appointmentSegment.deleteMany({ where: { appointmentId: appointment.id } })

    // The session returns to PLANNED; the link back is owned by Appointment,
    // and deleting the appointment's segments is what frees the time.
    if (appointment.servicePlanSessionId) {
      await tx.servicePlanSession.update({
        where: { id: appointment.servicePlanSessionId },
        data: { status: 'PLANNED' },
      })
    }

    await tx.outbox.create({
      data: {
        salonId: input.salonId,
        topic: input.markNoShow ? 'appointment.no_show' : 'appointment.cancelled',
        payloadJson: { appointmentId: appointment.id },
      },
    })
  })

  invalidateAvailabilityCache(input.salonId)

  /*
   * Now settle the money, outside the transaction because it talks to the
   * payment provider.
   *
   * `assessCancellation` has existed since commerce was written and had zero
   * callers — so no cancellation has ever produced a fee record, and no
   * no-show has ever kept its deposit. Cancelling was free, whenever you did
   * it, which is the exact thing deposits exist to prevent.
   *
   * Deliberately not fatal. The appointment IS cancelled — the time is already
   * freed and the client already told — and throwing here because a card
   * network was slow would leave a cancelled appointment reported as failed.
   */
  try {
    await assessCancellation({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      isNoShow: input.markNoShow,
    })
  } catch (error) {
    await unsafeDb.outbox.create({
      data: {
        salonId: input.salonId,
        topic: 'cancellation.assessment_failed',
        payloadJson: { appointmentId: input.appointmentId, error: String(error) },
      },
    })
  }
}

