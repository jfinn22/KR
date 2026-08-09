import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'

/**
 * The things that have to happen before the work can.
 *
 * `PreRequirement` rows are written when a consultation is evaluated and read
 * by the handoff card, and until now nothing could ever move one off `PENDING`
 * — `RequirementStatus.SATISFIED`, `WAIVED` and `FAILED` were unreachable, and
 * so were `satisfiedByType`, `satisfiedById` and `satisfiedAt`. A stylist who
 * did the strand test the engine asked for still saw it demanded, on every
 * screen, forever. The only way past a requirement was to ignore it, which is
 * the opposite of what a requirement is for.
 *
 * `StrandTest` is the other half: the model for recording what a strand test
 * actually showed had no writer either, so the evidence had nowhere to live.
 */

export interface RequirementRow {
  id: string
  kind: string
  dueBefore: string
  rationale: string
  status: string
  satisfiedAt: Date | null
  waiveReason: string | null
}

export async function requirementsFor(
  salonId: string,
  opts: { consultationId?: string; servicePlanId?: string },
): Promise<RequirementRow[]> {
  if (!opts.consultationId && !opts.servicePlanId) return []

  return dbFor(salonId).preRequirement.findMany({
    where: {
      salonId,
      ...(opts.consultationId ? { consultationId: opts.consultationId } : {}),
      ...(opts.servicePlanId ? { servicePlanId: opts.servicePlanId } : {}),
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      kind: true,
      dueBefore: true,
      rationale: true,
      status: true,
      satisfiedAt: true,
      waiveReason: true,
    },
  })
}

/**
 * Record what a strand test showed, and answer the requirement that asked for it.
 *
 * The decision drives the requirement's fate rather than the act of testing
 * doing so. A test that says ABORT has not satisfied anything — the hair said
 * no — and marking it SATISFIED because somebody went through the motions is
 * exactly the box-tick this product exists to avoid. `FAILED` is what that
 * value is for, and it has never been written until now.
 */
export async function recordStrandTest(input: {
  salonId: string
  clientProfileId: string
  consultationId?: string | null
  servicePlanId?: string | null
  performedByUserId: string
  startLevel?: number | null
  liftAchievedLevel?: number | null
  integrityAfter?: 'POOR' | 'FAIR' | 'GOOD' | null
  resultNotes?: string | null
  decision: 'PROCEED' | 'MODIFY' | 'ABORT'
  now?: Date
}): Promise<{ strandTestId: string; requirementStatus: string | null }> {
  const db = dbFor(input.salonId)
  const now = input.now ?? new Date()

  const client = await dbFor(input.salonId).clientProfile.findFirst({
    where: { id: input.clientProfileId, salonId: input.salonId },
    select: { id: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not here.')

  return db.$transaction(async (tx) => {
    const test = await tx.strandTest.create({
      data: {
        salonId: input.salonId,
        clientProfileId: input.clientProfileId,
        consultationId: input.consultationId ?? null,
        servicePlanId: input.servicePlanId ?? null,
        performedAt: now,
        performedByUserId: input.performedByUserId,
        startLevel: input.startLevel ?? null,
        liftAchievedLevel: input.liftAchievedLevel ?? null,
        integrityAfter: input.integrityAfter ?? null,
        resultNotes: input.resultNotes ?? null,
        decision: input.decision,
      },
      select: { id: true },
    })

    /*
     * ABORT fails the requirement instead of satisfying it. MODIFY satisfies
     * it: the test did its job, and what it changed is the plan, which is a
     * conversation the stylist is already having with the client in front of
     * them.
     */
    const status = input.decision === 'ABORT' ? 'FAILED' : 'SATISFIED'

    const answered = await tx.preRequirement.updateMany({
      where: {
        salonId: input.salonId,
        kind: 'STRAND_TEST',
        status: 'PENDING',
        ...(input.consultationId
          ? { consultationId: input.consultationId }
          : input.servicePlanId
            ? { servicePlanId: input.servicePlanId }
            : {}),
      },
      data: {
        status,
        satisfiedByType: 'StrandTest',
        satisfiedById: test.id,
        satisfiedAt: now,
      },
    })

    return {
      strandTestId: test.id,
      requirementStatus: answered.count > 0 ? status : null,
    }
  })
}

/**
 * Let it go ahead without the thing that was asked for.
 *
 * `requirement.waive` is granted to owners and managers with a reason
 * REQUIRED — the golden matrix has said `AR` since it was written, and the
 * guard enforces it. So this cannot happen quietly, which is the whole point:
 * the row keeps who decided and why, and that is what somebody reads back when
 * a client's hair comes off six months later.
 */
export async function waiveRequirement(input: {
  salonId: string
  requirementId: string
  waivedByUserId: string
  reason: string
}): Promise<{ status: string }> {
  const db = dbFor(input.salonId)
  const waived = await db.preRequirement.updateMany({
    where: { id: input.requirementId, salonId: input.salonId, status: 'PENDING' },
    data: {
      status: 'WAIVED',
      waivedByUserId: input.waivedByUserId,
      waiveReason: input.reason,
    },
  })

  if (waived.count === 0) {
    throw new DomainError(
      'CONFLICT',
      'That requirement is not outstanding — it may already have been dealt with.',
    )
  }
  return { status: 'WAIVED' }
}

/** What the strand tests on this client have shown, most recent first. */
export async function strandTestsFor(salonId: string, clientProfileId: string) {
  return dbFor(salonId).strandTest.findMany({
    where: { salonId, clientProfileId },
    orderBy: { performedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      performedAt: true,
      startLevel: true,
      liftAchievedLevel: true,
      integrityAfter: true,
      resultNotes: true,
      decision: true,
    },
  })
}
