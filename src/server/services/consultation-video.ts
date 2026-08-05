import { randomUUID } from 'node:crypto'
import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { storagePort } from '@/ports/registry'
import { signedUrlFor } from './photos'

/**
 * A short clip of the hair moving.
 *
 * `ConsultationMode.VIDEO` has been one of four modes since the schema was
 * written, and `pickMode` has had a branch returning it — with nowhere for the
 * client to go once it did. This is where it goes.
 *
 * Why video is worth having at all, given the photo set already exists: hair in
 * motion shows things a still cannot. Banding reads as a line across a static
 * photograph and as a stripe travelling down the length when the head turns.
 * Porosity shows in how the ends move. A client who says "it goes frizzy" is
 * describing behaviour, and behaviour does not photograph.
 *
 * ASYNC, and that is the whole design. A live call needs scheduling, a
 * provider, a waiting room and two people free at the same moment — and it is
 * WORSE at the job. A stylist watching a recording at eight in the evening can
 * scrub back to the frame where the light catches the banding. On a call they
 * can ask the client to do it again and hope.
 *
 * So: no video port, no calling infrastructure, no new liability. The client's
 * phone already records video; this stores it the way every other client asset
 * is stored and puts it in front of the stylist who has to judge it.
 */

/** What the client's phone will actually produce. */
const ALLOWED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])

/**
 * Long enough to show the hair, short enough that nobody edits it.
 *
 * A client asked for "a short video" sends thirty seconds. A client given no
 * limit sends four minutes of talking, which the stylist will not watch — so
 * the limit is a kindness to both of them.
 */
export const MAX_VIDEO_SECONDS = 60

/**
 * What to ask them to show.
 *
 * A client handed a camera and no instruction films their face. Each of these
 * is a thing that a still genuinely cannot carry, phrased as an action rather
 * than as a photography brief.
 */
export const VIDEO_PROMPTS: readonly string[] = [
  'Turn your head slowly from one side to the other, near a window.',
  'Run your fingers through the mid-lengths so we can see how it moves.',
  'Lift a section up towards the light and let it fall.',
]

export async function addConsultationVideo(input: {
  salonId: string
  consultationId: string
  clientProfileId: string
  bytes: Buffer
  contentType: string
  prompt?: string | null
  clientNote?: string | null
  durationSec?: number | null
  uploadedByUserId?: string | null
}): Promise<{ id: string }> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new DomainError(
      'INVALID_INPUT',
      'Please send a video your phone recorded — MP4, MOV or WebM.',
    )
  }
  if (input.bytes.length === 0) {
    throw new DomainError('INVALID_INPUT', 'That file came through empty. Please try again.')
  }
  if (input.durationSec != null && input.durationSec > MAX_VIDEO_SECONDS) {
    throw new DomainError(
      'INVALID_INPUT',
      `Keep it under ${MAX_VIDEO_SECONDS} seconds — that is plenty to see how the hair moves.`,
    )
  }

  const consultation = await unsafeDb.consultation.findFirst({
    where: { id: input.consultationId, salonId: input.salonId },
    select: { id: true, status: true },
  })
  if (!consultation) throw new DomainError('NOT_FOUND', 'That consultation no longer exists.')

  // Never derived from the uploaded filename: that is how a path traversal or
  // a guessable key gets in.
  const key = `salons/${input.salonId}/clients/${input.clientProfileId}/video/${randomUUID()}`
  const stored = await storagePort().put({
    key,
    body: input.bytes,
    contentType: input.contentType,
  })

  const existing = await unsafeDb.consultationVideo.count({
    where: { salonId: input.salonId, consultationId: input.consultationId },
  })

  const video = await unsafeDb.$transaction(async (tx) => {
    const asset = await tx.photoAsset.create({
      data: {
        salonId: input.salonId,
        clientProfileId: input.clientProfileId,
        storageKey: stored.key,
        mimeType: stored.contentType,
        bytes: stored.bytes,
        sha256: stored.sha256,
        /*
         * There is no EXIF in a video container the way there is in a JPEG, and
         * the stripper does not run on one — so this says so rather than
         * claiming a scrub that never happened. A video's own metadata can
         * carry location, which is why `isClientVisible` stays the default and
         * nothing here is ever marketing-approved automatically.
         */
        exifStripped: false,
        uploadedByUserId: input.uploadedByUserId ?? null,
      },
      select: { id: true },
    })

    return tx.consultationVideo.create({
      data: {
        salonId: input.salonId,
        consultationId: input.consultationId,
        photoAssetId: asset.id,
        prompt: input.prompt ?? null,
        clientNote: input.clientNote ?? null,
        durationSec: input.durationSec ?? null,
        sequence: existing,
      },
      select: { id: true },
    })
  })

  return video
}

export async function consultationVideos(salonId: string, consultationId: string) {
  const videos = await unsafeDb.consultationVideo.findMany({
    where: { salonId, consultationId },
    orderBy: { sequence: 'asc' },
    include: { photoAsset: { select: { storageKey: true, mimeType: true } } },
  })

  return Promise.all(
    videos.map(async (video) => ({
      id: video.id,
      prompt: video.prompt,
      clientNote: video.clientNote,
      durationSec: video.durationSec,
      mimeType: video.photoAsset.mimeType,
      url: await signedUrlFor(video.photoAsset.storageKey),
    })),
  )
}

/**
 * Take one back.
 *
 * The same shape as `removeConsultationPhoto`, and deliberately so: the video
 * row goes, and the asset is SOFT-deleted. A hard delete is the erasure job's
 * business, because it is the only thing that knows whether the same asset
 * backs a record somewhere that has already been approved.
 *
 * Order matters. The asset cascades the video row, so deleting the asset first
 * would take the video with it and leave nothing to soft-delete.
 */
export async function removeConsultationVideo(input: {
  salonId: string
  videoId: string
}): Promise<{ removed: boolean }> {
  const video = await unsafeDb.consultationVideo.findFirst({
    where: { id: input.videoId, salonId: input.salonId },
    select: { id: true, photoAssetId: true, consultation: { select: { status: true } } },
  })
  if (!video) throw new DomainError('NOT_FOUND', 'That video is no longer there.')
  if (video.consultation.status === 'APPROVED') {
    throw new DomainError('CONFLICT', 'This consultation is closed — it can no longer change.')
  }

  await unsafeDb.consultationVideo.delete({ where: { id: video.id } })
  await unsafeDb.photoAsset.update({
    where: { id: video.photoAssetId },
    data: { deletedAt: new Date() },
  })
  return { removed: true }
}
