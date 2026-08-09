import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { describeShade } from '@/domain/hair/tone'
import type { EvaluationResult } from '@/domain/consultation/types'
import { consultationPhotos, inspirationPhotos, journeyFor } from './photos'
import { validPatchTest } from './compliance'

/**
 * Everything the person doing the hair needs, before they pick up a brush.
 *
 * A consultation is done once, by whoever was free, possibly six weeks before
 * the appointment and possibly by somebody who is off that day. What they
 * learned then is spread across nine tables — answers, flags, photos, tagged
 * references, the plan, the last formula, the client's notes, their patch test
 * and their no-show history — and the stylist standing at the chair has none of
 * it unless they go and look for it in nine places.
 *
 * They will not. They will ask the client, who will say "just a bit off the
 * ends" and not mention the box dye, and the whole consultation was for
 * nothing.
 *
 * So: one screen, assembled once, ordered by what actually changes what the
 * stylist does. The ordering is the design. Anything that would stop the
 * appointment comes first; anything that changes the formula comes second;
 * everything else is context.
 */

export interface HandoffCard {
  appointment: {
    id: string
    startsAt: Date
    endsAt: Date
    status: string
    estimatedDurationMin: number
    serviceNames: string[]
    stylistName: string | null
    /** Whoever wrote the plan, if it was not this stylist. */
    consultedBy: string | null
    internalNote: string | null
    clientNote: string | null
    /**
     * Which consultation this came from, carried out rather than dropped.
     *
     * The requirements the engine raised hang off it, and answering one — doing
     * the strand test it asked for — needs to say which consultation it is
     * answering. Without this the screen can show a requirement and offer no
     * way to satisfy it, which is the state this whole model was in.
     */
    consultationId: string | null
  }
  client: {
    id: string
    name: string
    completedVisits: number
    noShowCount: number
    internalNotes: string | null
    allergies: string[]
    /** A reaction on record outranks everything else on this screen. */
    priorReactionToColor: boolean
    scalpSensitivity: string | null
    /** Null when the salon has never taken one, which is itself worth seeing. */
    patchTestValidUntil: Date | null
  }
  /** Anything that would stop the appointment. First on the screen. */
  stoppers: {
    kind: 'FLAG' | 'PATCH_TEST' | 'REQUIREMENT'
    severity: 'BLOCKER' | 'HIGH' | 'CAUTION' | 'INFO'
    title: string
    detail: string
    /** How it was got past, when somebody got past it. */
    overriddenBy: string | null
    overrideReason: string | null
  }[]
  /** What was on the hair last time. The single most useful thing here. */
  lastFormula: {
    at: Date
    stylistName: string
    purpose: string
    developerVolume: number | null
    ratio: string | null
    processingTimeMin: number | null
    technique: string | null
    applicationNotes: string | null
    resultRating: number | null
    resultNotes: string | null
    components: { role: string; product: string; parts: number | null }[]
  } | null
  /** What the client is pointing at, and what they tagged on it. */
  references: {
    id: string
    url: string | null
    clientNote: string | null
    attributes: { key: string; value: string }[]
  }[]
  /** Their own hair, as they photographed it. */
  photos: { id: string; url: string | null; view: string }[]
  /** Where this visit sits in the plan they agreed to. */
  journey: Awaited<ReturnType<typeof journeyFor>>
  plan: {
    sequence: number | null
    total: number
    label: string | null
    notesToClient: string | null
    /** The shade they asked for, in words, if they picked one. */
    targetShade: string | null
  } | null
}

const SEVERITY_ORDER = { BLOCKER: 0, HIGH: 1, CAUTION: 2, INFO: 3 } as const

/**
 * Whatever the consultation put in the allergies field, as a list of strings.
 *
 * Json, so it could be anything a template's answer shape produced — an array,
 * a single string, or something older. A stylist reading this panel needs the
 * words, not a parse error, so anything unrecognisable becomes nothing rather
 * than throwing on the one screen that must always render.
 */
function readAllergies(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
  }
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()]
  return []
}

export async function handoffCard(
  salonId: string,
  appointmentId: string,
): Promise<HandoffCard> {
  const db = dbFor(salonId)
  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, salonId },
    include: {
      clientProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          completedVisits: true,
          noShowCount: true,
          internalNotes: true,
          hairProfile: {
            select: {
              allergiesJson: true,
              priorReactionToColor: true,
              scalpSensitivity: true,
            },
          },
        },
      },
      primaryStylist: { select: { displayName: true } },
      services: { include: { service: { select: { name: true } } } },
      servicePlanSession: {
        select: {
          sequence: true,
          name: true,
          servicePlan: {
            select: {
              notesToClient: true,
              totalSessions: true,
              stylistProfile: { select: { displayName: true } },
            },
          },
        },
      },
    },
  })
  if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment no longer exists.')

  const consultationId = appointment.consultationId

  const [flags, requirements, evaluationRow, patchTest, lastFormula, references, photos] =
    await Promise.all([
      consultationId
        ? db.riskFlag.findMany({
            /*
             * RESOLVED is excluded, and it is the one exclusion that matters.
             * A flag somebody dealt with is not a thing to warn about, and a
             * red panel listing settled business is how a stylist learns to
             * scroll past this section — at which point it stops working on the
             * day it counts.
             *
             * ACKNOWLEDGED stays. "I have seen this" is not "this is handled",
             * and the person about to do the hair may not be the person who
             * saw it.
             */
            where: { salonId, consultationId, status: { not: 'RESOLVED' } },
            select: {
              severity: true,
              title: true,
              detail: true,
              status: true,
              overrideReason: true,
              overriddenByUserId: true,
            },
          })
        : Promise.resolve([]),

      consultationId
        ? db.preRequirement.findMany({
            where: { salonId, consultationId, status: 'PENDING' },
            select: { kind: true, rationale: true, dueBefore: true },
          })
        : Promise.resolve([]),

      consultationId
        ? db.consultation
            .findUnique({
              where: { id: consultationId },
              select: { latestEvaluationId: true },
            })
            .then((c) =>
              c?.latestEvaluationId
                ? db.ruleEvaluation.findUnique({
                    where: { id: c.latestEvaluationId },
                    select: { outputSnapshotJson: true },
                  })
                : null,
            )
        : Promise.resolve(null),

      validPatchTest(salonId, appointment.clientProfileId),

      /*
       * The last formula from a DIFFERENT appointment. Reading this one's own
       * would show the stylist what they are about to write down, which is not
       * information — and on a rebook it would be empty and look like a client
       * who had never been coloured.
       */
      db.formula.findFirst({
        where: {
          salonId,
          clientProfileId: appointment.clientProfileId,
          isTemplate: false,
          NOT: { appointmentId: appointment.id },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          stylistProfile: { select: { displayName: true } },
          components: { orderBy: { sequence: 'asc' } },
        },
      }),

      consultationId ? inspirationPhotos(salonId, consultationId) : Promise.resolve([]),
      consultationId ? consultationPhotos(salonId, consultationId) : Promise.resolve([]),
    ])

  const evaluation = (evaluationRow?.outputSnapshotJson as EvaluationResult | undefined) ?? null

  /*
   * Everything that could stop the appointment, in one list, worst first. A
   * stylist should not have to check three places to find out whether they can
   * start — and an acknowledged flag still belongs here, marked as handled,
   * because "somebody decided this was fine" is a different thing from "this
   * never came up".
   */
  const stoppers: HandoffCard['stoppers'] = [
    ...flags.map((flag) => ({
      kind: 'FLAG' as const,
      severity: flag.severity as 'BLOCKER' | 'HIGH' | 'CAUTION' | 'INFO',
      title: flag.title,
      detail: flag.detail,
      overriddenBy: flag.status === 'OVERRIDDEN' ? (flag.overriddenByUserId ?? 'a manager') : null,
      overrideReason: flag.overrideReason,
    })),
    ...requirements.map((requirement) => ({
      kind: 'REQUIREMENT' as const,
      severity: (requirement.dueBefore === 'BOOKING' ? 'BLOCKER' : 'HIGH') as 'BLOCKER' | 'HIGH',
      title: requirement.kind.replace(/_/g, ' ').toLowerCase(),
      detail: requirement.rationale,
      overriddenBy: null,
      overrideReason: null,
    })),
  ]

  /*
   * A missing patch test is only a stopper for work that needs one. Raising it
   * on a blow-dry would be the boy who cried wolf, and a stylist who learns to
   * dismiss this panel will dismiss it on the day it matters.
   */
  const chemical = await db.service.count({
    where: {
      salonId,
      id: { in: appointment.services.map((row) => row.serviceId) },
      requiresPatchTest: true,
    },
  })
  if (chemical > 0 && !patchTest) {
    stoppers.unshift({
      kind: 'PATCH_TEST',
      severity: 'BLOCKER',
      title: 'No valid patch test',
      detail:
        'This service needs a patch test on file, read as clear and still in date. There is not one.',
      overriddenBy: null,
      overrideReason: null,
    })
  }

  stoppers.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const client = appointment.clientProfile
  const planSession = appointment.servicePlanSession

  return {
    appointment: {
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      estimatedDurationMin: appointment.estimatedDurationMin,
      serviceNames: appointment.services.map((row) => row.service.name),
      stylistName: appointment.primaryStylist?.displayName ?? null,
      /*
       * Only when it was somebody else. "Consulted by Wren" on Wren's own
       * appointment is a line that costs a glance and says nothing.
       */
      consultedBy:
        planSession?.servicePlan.stylistProfile?.displayName &&
        planSession.servicePlan.stylistProfile.displayName !==
          appointment.primaryStylist?.displayName
          ? planSession.servicePlan.stylistProfile.displayName
          : null,
      internalNote: appointment.internalNote,
      clientNote: appointment.clientNote,
      consultationId,
    },
    client: {
      id: client.id,
      name: `${client.firstName} ${client.lastName ?? ''}`.trim(),
      completedVisits: client.completedVisits,
      noShowCount: client.noShowCount,
      internalNotes: client.internalNotes,
      allergies: readAllergies(client.hairProfile?.allergiesJson),
      priorReactionToColor: client.hairProfile?.priorReactionToColor ?? false,
      scalpSensitivity: client.hairProfile?.scalpSensitivity ?? null,
      patchTestValidUntil: patchTest?.validUntil ?? null,
    },
    stoppers,
    lastFormula: lastFormula
      ? {
          at: lastFormula.createdAt,
          stylistName: lastFormula.stylistProfile.displayName,
          purpose: lastFormula.purpose,
          developerVolume: lastFormula.developerVolume,
          ratio: lastFormula.ratio,
          processingTimeMin: lastFormula.processingTimeMin,
          technique: lastFormula.technique,
          applicationNotes: lastFormula.applicationNotes,
          resultRating: lastFormula.resultRating,
          resultNotes: lastFormula.resultNotes,
          components: lastFormula.components.map((component) => ({
            role: component.role,
            product:
              [component.brand, component.productName, component.shadeCode]
                .filter(Boolean)
                .join(' ') || 'Unnamed product',
            // Decimal on the way out of Prisma; a number by the time a screen
            // sees it, so no component has to know what a Decimal is.
            parts: component.parts == null ? null : Number(component.parts),
          })),
        }
      : null,
    references: references.map((photo) => ({
      id: photo.id,
      url: photo.url,
      clientNote: photo.clientNote,
      attributes: photo.attributes.map((a) => ({ key: a.key, value: a.value })),
    })),
    photos: photos.map((photo) => ({ id: photo.id, url: photo.url, view: photo.view })),
    journey:
      consultationId && evaluation ? await journeyFor(salonId, consultationId, evaluation) : null,
    plan: planSession
      ? {
          sequence: planSession.sequence,
          total: planSession.servicePlan.totalSessions,
          label: planSession.name,
          notesToClient: planSession.servicePlan.notesToClient,
          targetShade: describeShade(
            references.flatMap((r) => r.attributes).find((a) => a.key === 'TARGET_TONE')?.value,
          ),
        }
      : null,
  }
}
