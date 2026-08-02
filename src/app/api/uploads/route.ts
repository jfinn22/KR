import { NextResponse } from 'next/server'
import { requireContext } from '@/server/auth/context'
import { authorize } from '@/server/auth/context'
import { toActionError } from '@/server/actions/guard'
import { DomainError } from '@/server/errors'
import {
  addInspiration,
  attachConsultationPhoto,
  consultationOwner,
  type PhotoView,
} from '@/server/services/photos'

/**
 * Photo upload.
 *
 * A route rather than a server action because server actions serialise their
 * payload, and pushing several megabytes of JPEG through that is both slow and
 * wasteful. Multipart streams straight into a buffer.
 *
 * The same authorization path as every action still applies — context, then
 * permission, then the service. Nothing here trusts the filename, the declared
 * content type, or the consultation id without checking who owns it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Comfortably above a phone photo, well below anything worth streaming. */
const MAX_BYTES = 15 * 1024 * 1024

const VIEWS = new Set<PhotoView>([
  'FRONT',
  'BACK',
  'LEFT',
  'RIGHT',
  'ROOTS',
  'MIDS',
  'ENDS',
  'TEXTURE',
  'WET',
  'SCALP',
  'PART',
  'OTHER',
])

export async function POST(request: Request) {
  try {
    const form = await request.formData()

    const salonSlug = str(form.get('salon'))
    const consultationId = str(form.get('consultationId'))
    if (!salonSlug || !consultationId) {
      throw new DomainError('INVALID_INPUT', 'Missing salon or consultation.')
    }

    const ctx = await requireContext(salonSlug)

    // Ownership is resolved from the row, so a client cannot upload into
    // somebody else's consultation by editing the form field.
    authorize(ctx, 'consultation.create', await consultationOwner(ctx.salonId, consultationId))

    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new DomainError('INVALID_INPUT', 'No photo was attached.')
    }
    if (file.size > MAX_BYTES) {
      throw new DomainError('INVALID_INPUT', 'That photo is too large — please use one under 15MB.')
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const contentType = file.type || 'application/octet-stream'
    const uploadedByUserId = ctx.principal.kind === 'system' ? null : ctx.principal.userId

    const kind = str(form.get('kind')) ?? 'consultation'

    if (kind === 'inspiration') {
      const result = await addInspiration({
        salonId: ctx.salonId,
        consultationId,
        bytes,
        contentType,
        clientNote: str(form.get('note')),
        uploadedByUserId,
      })
      return NextResponse.json(result)
    }

    const view = str(form.get('view'))
    if (!view || !VIEWS.has(view as PhotoView)) {
      throw new DomainError('INVALID_INPUT', 'That is not a photo angle we recognise.')
    }

    const result = await attachConsultationPhoto({
      salonId: ctx.salonId,
      consultationId,
      view: view as PhotoView,
      bytes,
      contentType,
      uploadedByUserId,
    })
    return NextResponse.json(result)
  } catch (err) {
    const { code, error } = toActionError(err)
    return NextResponse.json({ error }, { status: statusFor(code) })
  }
}

function str(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function statusFor(code: string): number {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401
    case 'FORBIDDEN':
    case 'NO_ACCESS':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'CONFLICT':
      return 409
    case 'INVALID_INPUT':
      return 400
    default:
      return 500
  }
}
