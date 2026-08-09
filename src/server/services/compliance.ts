import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { esignPort } from '@/ports/registry'
import { hashDocument } from '@/ports/esign'

export { hashDocument }

/**
 * Consent, patch tests, and the right to be forgotten.
 *
 * The part of the product where being slightly wrong is a legal problem rather
 * than a usability one, so three things are non-negotiable:
 *
 *  - What somebody signed is frozen. The submission stores a hash of the exact
 *    rendered document, so editing the template afterwards cannot change what
 *    the record says they agreed to.
 *  - A patch test is only useful while it is current. Expiry is computed and
 *    stored at record time; an expired test is treated as absent, never as a
 *    weaker yes.
 *  - Erasure removes the person, not the salon's books. A salon still has to
 *    account for money taken and services performed, so those rows survive
 *    with the identity stripped out of them.
 *
 * Every shipped form is marked `isLegalPlaceholder`. Nothing here is legal
 * advice and the UI is required to keep saying so.
 */

// --- Patch tests -------------------------------------------------------------

/** The industry standard, and the default the rules engine assumes. */
const PATCH_TEST_VALID_DAYS = 180
/** A test read sooner than this has not had time to react. */
const MIN_READ_HOURS = 48

export async function recordPatchTest(input: {
  salonId: string
  clientProfileId: string
  appliedAt: Date
  productBrand?: string | null
  productRef?: string | null
  appliedByUserId?: string | null
  servicePlanId?: string | null
  validDays?: number
}): Promise<{ patchTestId: string; readableFrom: Date; validUntil: Date }> {
  const db = dbFor(input.salonId)
  const validDays = input.validDays ?? PATCH_TEST_VALID_DAYS
  const validUntil = new Date(input.appliedAt.getTime() + validDays * 86_400_000)

  const test = await db.patchTest.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      servicePlanId: input.servicePlanId ?? null,
      productBrand: input.productBrand ?? null,
      productRef: input.productRef ?? null,
      appliedAt: input.appliedAt,
      appliedByUserId: input.appliedByUserId ?? null,
      result: 'PENDING',
      validUntil,
    },
    select: { id: true },
  })

  return {
    patchTestId: test.id,
    readableFrom: new Date(input.appliedAt.getTime() + MIN_READ_HOURS * 3_600_000),
    validUntil,
  }
}

/**
 * Read the result.
 *
 * Refuses to record a negative before the reaction window has passed. A test
 * read at four hours and filed as clear is worse than no test at all: it puts
 * a "safe" record on file that the rules engine will believe.
 */
export async function readPatchTest(input: {
  salonId: string
  patchTestId: string
  result: 'NEGATIVE' | 'POSITIVE' | 'INCONCLUSIVE'
  notes?: string | null
  readAt?: Date
}): Promise<void> {
  const db = dbFor(input.salonId)
  const test = await db.patchTest.findFirst({
    where: { id: input.patchTestId, salonId: input.salonId },
    select: { id: true, appliedAt: true, result: true, clientProfileId: true },
  })
  if (!test) throw new DomainError('NOT_FOUND', 'That patch test is not on file.')

  const readAt = input.readAt ?? new Date()
  const hoursElapsed = (readAt.getTime() - test.appliedAt.getTime()) / 3_600_000

  if (input.result === 'NEGATIVE' && hoursElapsed < MIN_READ_HOURS) {
    throw new DomainError(
      'CONFLICT',
      `A patch test has to sit for ${MIN_READ_HOURS} hours before it can be read as clear. ` +
        `This one has had ${Math.floor(hoursElapsed)}.`,
    )
  }

  await db.patchTest.update({
    where: { id: test.id },
    data: { result: input.result, readAt, notes: input.notes ?? null },
  })

  // A reaction is a permanent fact about the client, not just about this test.
  if (input.result === 'POSITIVE') {
    await db.hairProfile.updateMany({
      where: { clientProfileId: test.clientProfileId },
      data: { priorReactionToColor: true },
    })
  }
}

/** The current, valid, negative test — or nothing. An expired one is nothing. */
export async function validPatchTest(salonId: string, clientProfileId: string, now = new Date()) {
  const db = dbFor(salonId)
  return db.patchTest.findFirst({
    where: {
      salonId,
      clientProfileId,
      result: 'NEGATIVE',
      validUntil: { gt: now },
    },
    orderBy: { validUntil: 'desc' },
  })
}

export type GrantKind =
  | 'PHOTO_RELEASE'
  | 'MARKETING_USE'
  | 'SMS'
  | 'EMAIL'
  | 'DATA_PROCESSING'
  | 'AI_PHOTO_ANALYSIS'
  | 'MINOR_GUARDIAN'
  | 'CHEMICAL_SERVICE'
  | 'EXTENSIONS'
  | 'CORRECTION_SERVICE'

// --- Forms and signatures ----------------------------------------------------

/*
 * The document hash comes from the e-sign port, re-exported rather than
 * reimplemented. A second copy of the same scheme would be free to drift, and
 * a drifted hash makes every stored signature unverifiable at exactly the
 * moment somebody needs to rely on it.
 */

export async function loadForm(salonId: string, key: string) {
  const db = dbFor(salonId)
  const template = await db.formTemplate.findFirst({
    where: {
      key,
      status: 'PUBLISHED',
      OR: [{ salonId }, { salonId: null }],
    },
    orderBy: [{ salonId: 'desc' }, { version: 'desc' }],
  })
  if (!template) throw new DomainError('NOT_FOUND', 'That form is not published.')
  return template
}

export async function submitForm(input: {
  salonId: string
  formKey: string
  clientProfileId: string
  answers?: Record<string, unknown>
  appointmentId?: string | null
  consultationId?: string | null
  signerName: string
  signerRelationship?: string | null
  signerUserId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}): Promise<{ submissionId: string; documentHash: string; isLegalPlaceholder: boolean }> {
  const db = dbFor(input.salonId)
  const template = await loadForm(input.salonId, input.formKey)

  if (template.requiresSignature && !input.signerName.trim()) {
    throw new DomainError('INVALID_INPUT', 'This form needs a signature.')
  }

  const documentHash = hashDocument(template.bodyMarkdown, template.version)

  const expiresAt = template.validForDays
    ? new Date(Date.now() + template.validForDays * 86_400_000)
    : null

  const submission = await db.$transaction(async (tx) => {
    const created = await tx.formSubmission.create({
      data: {
        salonId: input.salonId,
        formTemplateId: template.id,
        templateVersion: template.version,
        clientProfileId: input.clientProfileId,
        appointmentId: input.appointmentId ?? null,
        consultationId: input.consultationId ?? null,
        answersJson: (input.answers ?? {}) as never,
        documentHash,
        expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    })

    if (template.requiresSignature) {
      await tx.signature.create({
        data: {
          salonId: input.salonId,
          formSubmissionId: created.id,
          signerUserId: input.signerUserId ?? null,
          signerName: input.signerName.trim(),
          signerRelationship: input.signerRelationship ?? null,
          method: 'TYPED',
          documentHash,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      })
    }

    // A signed consent form grants the consent it describes. Recording the
    // grant separately is what lets the rules engine ask a simple question.
    const grantKind = GRANT_FOR_FORM[template.kind]
    if (grantKind) {
      await tx.consentGrant.create({
        data: {
          salonId: input.salonId,
          clientProfileId: input.clientProfileId,
          kind: grantKind,
          status: 'GRANTED',
          evidenceFormSubmissionId: created.id,
        },
      })
    }

    return created
  })

  // Rendered through the port so the same flow works with a real e-sign
  // provider; the local adapter is also the sensible production default.
  if (template.requiresSignature) {
    await esignPort().render({
      signerName: input.signerName.trim(),
      method: 'TYPED',
      documentBody: template.bodyMarkdown,
      documentVersion: template.version,
    })
  }

  return {
    submissionId: submission.id,
    documentHash,
    isLegalPlaceholder: template.isLegalPlaceholder,
  }
}

const GRANT_FOR_FORM: Record<string, GrantKind | undefined> = {
  CHEMICAL_SERVICE: 'CHEMICAL_SERVICE',
  MINOR_CONSENT: 'MINOR_GUARDIAN',
  PHOTO_RELEASE: 'PHOTO_RELEASE',
  WAIVER: undefined,
  INTAKE: undefined,
}

/**
 * Verify a stored signature.
 *
 * Re-hashes the template as it stands today and compares. A mismatch does not
 * mean fraud — it means the template was edited after signing — but it is
 * exactly the thing a salon needs to know before relying on the record.
 */
export async function verifySubmission(
  salonId: string,
  submissionId: string,
): Promise<{ matches: boolean; signedVersion: number; currentVersion: number }> {
  const db = dbFor(salonId)
  const submission = await db.formSubmission.findFirst({
    where: { id: submissionId, salonId },
    include: { formTemplate: true },
  })
  if (!submission) throw new DomainError('NOT_FOUND', 'That submission is not on file.')

  const currentHash = hashDocument(
    submission.formTemplate.bodyMarkdown,
    submission.formTemplate.version,
  )

  return {
    matches: currentHash === submission.documentHash,
    signedVersion: submission.templateVersion,
    currentVersion: submission.formTemplate.version,
  }
}

// --- Consent -----------------------------------------------------------------

export async function grantConsent(input: {
  salonId: string
  clientProfileId: string
  kind: GrantKind
  scope?: string | null
  evidenceFormSubmissionId?: string | null
}): Promise<void> {
  const db = dbFor(input.salonId)
  await db.consentGrant.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      kind: input.kind,
      scope: input.scope ?? null,
      status: 'GRANTED',
      evidenceFormSubmissionId: input.evidenceFormSubmissionId ?? null,
    },
  })
}

/**
 * Withdraw consent.
 *
 * Revokes rather than deletes: the record that consent was once given and then
 * withdrawn is itself the evidence a salon needs, and deleting it would leave
 * them unable to show they stopped when asked.
 */
export async function revokeConsent(input: {
  salonId: string
  clientProfileId: string
  kind: GrantKind
}): Promise<void> {
  const db = dbFor(input.salonId)
  await db.consentGrant.updateMany({
    where: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      kind: input.kind,
      status: 'GRANTED',
    },
    data: { status: 'REVOKED', revokedAt: new Date() },
  })
}

export async function hasConsent(
  salonId: string,
  clientProfileId: string,
  kind: GrantKind,
): Promise<boolean> {
  const db = dbFor(salonId)
  const grant = await db.consentGrant.findFirst({
    where: { salonId, clientProfileId, kind, status: 'GRANTED' },
  })
  return grant !== null
}

/** Everything on file for a client, for the consent screen. */
export async function consentState(salonId: string, clientProfileId: string) {
  const db = dbFor(salonId)
  const [grants, submissions, patchTests, templates] = await Promise.all([
    db.consentGrant.findMany({
      where: { salonId, clientProfileId },
      orderBy: { grantedAt: 'desc' },
    }),
    db.formSubmission.findMany({
      where: { salonId, clientProfileId },
      orderBy: { submittedAt: 'desc' },
      include: {
        formTemplate: { select: { name: true, kind: true, isLegalPlaceholder: true } },
        signature: { select: { signerName: true, signerRelationship: true, signedAt: true } },
      },
    }),
    db.patchTest.findMany({
      where: { salonId, clientProfileId },
      orderBy: { appliedAt: 'desc' },
      take: 5,
    }),
    /*
     * What this salon asks people to sign.
     *
     * Five of these ship in the seed, every one of them PUBLISHED and
     * requiresSignature, and nothing in the product could sign one — a
     * chemical service consent form that exists and cannot be signed is worse
     * than no form at all, because the salon believes it has one.
     */
    db.formTemplate.findMany({
      where: { salonId, status: 'PUBLISHED' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        kind: true,
        version: true,
        bodyMarkdown: true,
        requiresSignature: true,
        isLegalPlaceholder: true,
      },
    }),
  ])

  const now = new Date()
  return {
    grants,
    submissions,
    templates,
    patchTests: patchTests.map((test) => ({
      ...test,
      isCurrent: test.result === 'NEGATIVE' && test.validUntil > now,
    })),
  }
}

// --- Subject rights ----------------------------------------------------------

/**
 * Everything the salon holds about one person, as portable data.
 *
 * Deliberately assembled here rather than exposed as a raw dump: an export has
 * to be readable by the person receiving it, and a JSON blob of foreign keys
 * satisfies the letter of a request and none of its purpose.
 */
export async function exportClientData(salonId: string, clientProfileId: string) {
  const db = dbFor(salonId)
  const client = await db.clientProfile.findFirst({
    where: { id: clientProfileId, salonId },
    include: {
      hairProfile: true,
      consentGrants: true,
      formSubmissions: { include: { formTemplate: { select: { name: true } } } },
      patchTests: true,
    },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not on file.')

  const [appointments, consultations, formulas, photos] = await Promise.all([
    db.appointment.findMany({
      where: { salonId, clientProfileId },
      orderBy: { startsAt: 'desc' },
      include: { services: { include: { service: { select: { name: true } } } } },
    }),
    db.consultation.findMany({
      where: { salonId, clientProfileId },
      orderBy: { createdAt: 'desc' },
      include: { answers: true },
    }),
    db.formula.findMany({
      where: { salonId, clientProfileId },
      orderBy: { createdAt: 'desc' },
      include: { components: true },
    }),
    db.photoAsset.findMany({
      where: { salonId, clientProfileId, deletedAt: null },
      select: { id: true, storageKey: true, mimeType: true, createdAt: true },
    }),
  ])

  return {
    exportedAt: new Date().toISOString(),
    client: {
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      dateOfBirth: client.dateOfBirth,
      createdAt: client.createdAt,
    },
    hairProfile: client.hairProfile,
    appointments: appointments.map((a) => ({
      date: a.startsAt,
      services: a.services.map((s) => s.service.name),
      status: a.status,
      totalCents: a.actualTotalCents ?? a.estimatedTotalCents,
    })),
    consultations: consultations.map((c) => ({
      date: c.createdAt,
      status: c.status,
      answers: Object.fromEntries(c.answers.map((a) => [a.questionKey, a.valueJson])),
    })),
    formulas,
    consents: client.consentGrants,
    forms: client.formSubmissions.map((s) => ({
      name: s.formTemplate.name,
      submittedAt: s.submittedAt,
      documentHash: s.documentHash,
    })),
    patchTests: client.patchTests,
    photoCount: photos.length,
  }
}

/**
 * Erase a client.
 *
 * Identity is removed; the salon's books are not. A salon still has to account
 * for money taken and services performed, and a records regime that let a
 * request delete financial history would be unusable — so appointments and
 * invoices survive with the person stripped out of them.
 *
 * Photographs go entirely. They are the most identifying thing held and there
 * is no accounting reason to keep them.
 */
export async function eraseClient(input: {
  salonId: string
  clientProfileId: string
  requestedByUserId: string
  reason: string
}): Promise<{ photosDeleted: number; appointmentsRetained: number }> {
  const db = dbFor(input.salonId)
  const client = await db.clientProfile.findFirst({
    where: { id: input.clientProfileId, salonId: input.salonId },
    select: { id: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not on file.')

  return db.$transaction(async (tx) => {
    const photos = await tx.photoAsset.findMany({
      where: { salonId: input.salonId, clientProfileId: client.id },
      select: { id: true },
    })

    await tx.consultationPhoto.deleteMany({
      where: { photoAssetId: { in: photos.map((p) => p.id) } },
    })
    await tx.photoAsset.deleteMany({
      where: { salonId: input.salonId, clientProfileId: client.id },
    })

    const appointmentsRetained = await tx.appointment.count({
      where: { salonId: input.salonId, clientProfileId: client.id },
    })

    // Free text can contain anything, including a name somebody typed in.
    await tx.formula.updateMany({
      where: { salonId: input.salonId, clientProfileId: client.id },
      data: { resultNotes: null, applicationNotes: null },
    })
    await tx.consultation.updateMany({
      where: { salonId: input.salonId, clientProfileId: client.id },
      data: { clientNote: null },
    })

    await tx.clientProfile.update({
      where: { id: client.id },
      data: {
        firstName: 'Erased',
        lastName: 'client',
        email: null,
        phone: null,
        dateOfBirth: null,
        pronouns: null,
        tags: [],
        internalNotes: null,
        status: 'ERASED',
        userId: null,
      },
    })

    await tx.auditLog.create({
      data: {
        salonId: input.salonId,
        actorUserId: input.requestedByUserId,
        action: 'client.erase',
        entityType: 'ClientProfile',
        entityId: client.id,
        reason: input.reason,
      },
    })

    return { photosDeleted: photos.length, appointmentsRetained }
  })
}
