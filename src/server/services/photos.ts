import { randomUUID } from 'node:crypto'
import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { storagePort } from '@/ports/registry'
import { enqueue } from '@/server/jobs/queue'

/**
 * Client photographs.
 *
 * The most sensitive data in the system: a salon's photo library is a set of
 * identifiable images of named people, taken at home. Three rules follow, and
 * all three are enforced here rather than trusted to callers.
 *
 *  - EXIF is stripped by the storage port before the bytes are ever readable,
 *    because phone photos carry GPS.
 *  - Nothing is served from a permanent path. Every read is a short-lived
 *    signed URL.
 *  - The storage key is generated here from a UUID, never from a filename the
 *    browser supplied.
 */

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])

/** Reads are short. Long enough to load a page, short enough not to be shared. */
const URL_TTL_SECONDS = 300

export type PhotoView =
  | 'FRONT'
  | 'BACK'
  | 'LEFT'
  | 'RIGHT'
  | 'ROOTS'
  | 'MIDS'
  | 'ENDS'
  | 'TEXTURE'
  | 'WET'
  | 'SCALP'
  | 'PART'
  | 'OTHER'

/**
 * Who owns a consultation, for the caller to authorize against.
 *
 * Resolved from the row rather than taken from the request, so naming somebody
 * else's consultation id in a form field grants nothing.
 */
export async function consultationOwner(
  salonId: string,
  consultationId: string,
): Promise<{ salonId: string; clientProfileId: string; ownerStylistId: string | null }> {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: consultationId, salonId },
    select: { clientProfileId: true, requestedStylistId: true },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  return {
    salonId,
    clientProfileId: consultation.clientProfileId,
    ownerStylistId: consultation.requestedStylistId,
  }
}

export interface UploadInput {
  salonId: string
  clientProfileId: string
  bytes: Buffer
  contentType: string
  uploadedByUserId?: string | null
}

/** Store the bytes and record the asset. Shared by consultation and inspiration. */
export async function storePhoto(input: UploadInput): Promise<{ id: string; key: string }> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new DomainError('INVALID_INPUT', 'Please upload a photo — JPEG, PNG, WebP or HEIC.')
  }
  if (input.bytes.length === 0) {
    throw new DomainError('INVALID_INPUT', 'That file came through empty. Please try again.')
  }

  // Never derived from the uploaded filename: that is how a path traversal or a
  // guessable key gets in.
  const key = `salons/${input.salonId}/clients/${input.clientProfileId}/${randomUUID()}`
  const stored = await storagePort().put({
    key,
    body: input.bytes,
    contentType: input.contentType,
  })

  const asset = await unsafeDb.photoAsset.create({
    data: {
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
      storageKey: stored.key,
      mimeType: stored.contentType,
      bytes: stored.bytes,
      sha256: stored.sha256,
      exifStripped: stored.exifStripped,
      uploadedByUserId: input.uploadedByUserId ?? null,
    },
    select: { id: true },
  })

  return { id: asset.id, key: stored.key }
}

/**
 * Attach a photo to a consultation under a named view.
 *
 * Re-uploading a view replaces it rather than stacking: a client retaking a
 * blurry back shot means "use this one", and a growing pile of near-duplicates
 * makes the stylist's review screen worse, not better.
 */
export async function attachConsultationPhoto(input: {
  salonId: string
  consultationId: string
  view: PhotoView
  bytes: Buffer
  contentType: string
  uploadedByUserId?: string | null
}): Promise<{ photoId: string; url: string }> {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: input.consultationId, salonId: input.salonId },
    select: { id: true, clientProfileId: true, status: true },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')
  if (consultation.status === 'APPROVED' || consultation.status === 'EXPIRED') {
    throw new DomainError('CONFLICT', 'This consultation is closed — photos can no longer change.')
  }

  const asset = await storePhoto({
    salonId: input.salonId,
    clientProfileId: consultation.clientProfileId,
    bytes: input.bytes,
    contentType: input.contentType,
    uploadedByUserId: input.uploadedByUserId,
  })

  const existing = await unsafeDb.consultationPhoto.findFirst({
    where: { consultationId: consultation.id, view: input.view, sequence: 0 },
    select: { id: true },
  })

  const photo = existing
    ? await unsafeDb.consultationPhoto.update({
        where: { id: existing.id },
        data: { photoAssetId: asset.id, qualityScore: null, qualityIssues: [] },
        select: { id: true },
      })
    : await unsafeDb.consultationPhoto.create({
        data: {
          salonId: input.salonId,
          consultationId: consultation.id,
          photoAssetId: asset.id,
          view: input.view,
          sequence: 0,
        },
        select: { id: true },
      })

  // Quality scoring happens off the request: a client should never wait on it,
  // and the estimate is usable without it.
  await enqueue({
    salonId: input.salonId,
    type: 'photo.assess',
    payload: { consultationPhotoId: photo.id },
  })

  return { photoId: photo.id, url: await signedUrlFor(asset.key) }
}

/** A reference photo the client brought, with what they like about it. */
export async function addInspiration(input: {
  salonId: string
  consultationId: string
  bytes?: Buffer
  contentType?: string
  sourceUrl?: string | null
  clientNote?: string | null
  uploadedByUserId?: string | null
}): Promise<{ inspirationId: string }> {
  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: input.consultationId, salonId: input.salonId },
    select: { id: true, clientProfileId: true },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')

  if (!input.bytes && !input.sourceUrl) {
    throw new DomainError('INVALID_INPUT', 'Add a photo or a link.')
  }

  let photoAssetId: string | null = null
  if (input.bytes && input.contentType) {
    const asset = await storePhoto({
      salonId: input.salonId,
      clientProfileId: consultation.clientProfileId,
      bytes: input.bytes,
      contentType: input.contentType,
      uploadedByUserId: input.uploadedByUserId,
    })
    photoAssetId = asset.id
  }

  const count = await unsafeDb.inspirationPhoto.count({
    where: { consultationId: consultation.id },
  })

  const inspiration = await unsafeDb.inspirationPhoto.create({
    data: {
      salonId: input.salonId,
      consultationId: consultation.id,
      photoAssetId,
      sourceUrl: input.sourceUrl ?? null,
      clientNote: input.clientNote ?? null,
      sequence: count,
    },
    select: { id: true },
  })

  return { inspirationId: inspiration.id }
}

export type InspirationKey =
  | 'TARGET_LEVEL'
  | 'TARGET_TONE'
  | 'TECHNIQUE'
  | 'ROOT_SHADOW'
  | 'CONTRAST'
  | 'DIMENSION'
  | 'BRIGHTNESS'
  | 'CURLS'

/**
 * Record what the client is actually pointing at in a reference photo.
 *
 * "I like this" is not a brief. Without attributes the stylist is guessing
 * whether the client means the tone, the brightness or the cut — and guessing
 * wrong here is what produces a client who is unhappy with technically correct
 * work.
 */
export async function tagInspiration(input: {
  salonId: string
  inspirationPhotoId: string
  attributes: readonly { key: InspirationKey; value: string }[]
  source?: 'CLIENT' | 'STYLIST' | 'AI'
  acceptedByUserId?: string | null
}): Promise<void> {
  const photo = await unsafeDb.inspirationPhoto.findFirst({
    where: { id: input.inspirationPhotoId, salonId: input.salonId },
    select: { id: true },
  })
  if (!photo) throw new DomainError('NOT_FOUND', 'That reference photo no longer exists.')

  const source = input.source ?? 'CLIENT'

  await unsafeDb.$transaction(async (tx) => {
    // Replace this source's tags only. A client changing their mind must not
    // wipe the stylist's reading of the same photo, or the other way round.
    await tx.inspirationAttribute.deleteMany({
      where: { inspirationPhotoId: photo.id, source },
    })
    if (input.attributes.length === 0) return

    await tx.inspirationAttribute.createMany({
      data: input.attributes.map((attribute) => ({
        salonId: input.salonId,
        inspirationPhotoId: photo.id,
        key: attribute.key,
        value: attribute.value,
        source,
        acceptedByUserId: input.acceptedByUserId ?? null,
        acceptedAt: source === 'AI' && input.acceptedByUserId ? new Date() : null,
      })),
    })
  })
}

export async function signedUrlFor(storageKey: string): Promise<string> {
  return storagePort().signedUrl(storageKey, URL_TTL_SECONDS)
}

/** Every photo on a consultation, with fresh URLs, for the capture grid. */
export async function consultationPhotos(salonId: string, consultationId: string) {
  const photos = await unsafeDb.consultationPhoto.findMany({
    where: { salonId, consultationId },
    orderBy: [{ view: 'asc' }, { sequence: 'asc' }],
    include: { photoAsset: { select: { storageKey: true, mimeType: true } } },
  })

  return Promise.all(
    photos.map(async (photo) => ({
      id: photo.id,
      view: photo.view,
      qualityScore: photo.qualityScore ? Number(photo.qualityScore) : null,
      qualityIssues: photo.qualityIssues,
      url: await signedUrlFor(photo.photoAsset.storageKey),
    })),
  )
}

export async function inspirationPhotos(salonId: string, consultationId: string) {
  const photos = await unsafeDb.inspirationPhoto.findMany({
    where: { salonId, consultationId },
    orderBy: { sequence: 'asc' },
    include: {
      photoAsset: { select: { storageKey: true } },
      attributes: { orderBy: { key: 'asc' } },
    },
  })

  return Promise.all(
    photos.map(async (photo) => ({
      id: photo.id,
      sourceUrl: photo.sourceUrl,
      clientNote: photo.clientNote,
      url: photo.photoAsset ? await signedUrlFor(photo.photoAsset.storageKey) : null,
      attributes: photo.attributes.map((a) => ({
        key: a.key,
        value: a.value,
        source: a.source,
      })),
    })),
  )
}

/** Remove a photo a client no longer wants attached. */
export async function removeConsultationPhoto(
  salonId: string,
  consultationPhotoId: string,
): Promise<void> {
  const photo = await unsafeDb.consultationPhoto.findFirst({
    where: { id: consultationPhotoId, salonId },
    select: { id: true, photoAssetId: true, consultation: { select: { status: true } } },
  })
  if (!photo) throw new DomainError('NOT_FOUND', 'That photo no longer exists.')
  if (photo.consultation.status === 'APPROVED') {
    throw new DomainError('CONFLICT', 'This consultation is closed — photos can no longer change.')
  }

  await unsafeDb.consultationPhoto.delete({ where: { id: photo.id } })

  // Soft-delete the asset. A hard delete is the erasure job's business, and it
  // has to consider whether the same asset backs an approved record elsewhere.
  await unsafeDb.photoAsset.update({
    where: { id: photo.photoAssetId },
    data: { deletedAt: new Date() },
  })
}
