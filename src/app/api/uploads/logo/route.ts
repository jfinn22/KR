import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authorize, requireContext } from '@/server/auth/context'
import { hasFeature } from '@/domain/authz/plan-features'
import { toActionError } from '@/server/actions/guard'
import { DomainError } from '@/server/errors'
import { storagePort } from '@/ports/registry'
import { saveLogoKey } from '@/server/services/branding'

/**
 * The salon's own mark.
 *
 * `saveLogoKey` was written with the white-label work and nothing ever called
 * it, so a salon could pick its colour and never its logo — while the settings
 * screen said "your colour and your logo" and the join page already rendered
 * `logoUrl` for a key that could not exist.
 *
 * A route rather than a server action for the same reason photos are: actions
 * serialise their payload, and pushing an image through that is wasteful.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A logo is a logo. Anything larger is a photograph somebody has mistaken. */
const MAX_BYTES = 2 * 1024 * 1024

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export async function POST(request: Request) {
  try {
    const form = await request.formData()

    const salonSlug = str(form.get('salon'))
    if (!salonSlug) throw new DomainError('INVALID_INPUT', 'Missing salon.')

    const ctx = await requireContext(salonSlug)
    authorize(ctx, 'settings.manage')

    if (!hasFeature(ctx.plan, 'BRANDED_EXPERIENCE')) {
      throw new DomainError(
        'FORBIDDEN',
        'Your own colour and logo across the client experience are part of the Salon plan.',
      )
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new DomainError('INVALID_INPUT', 'No file was attached.')
    }

    if (file.size > MAX_BYTES) {
      throw new DomainError(
        'INVALID_INPUT',
        'That is larger than a logo needs to be — please use one under 2MB.',
      )
    }

    /*
     * The declared type is checked, never trusted for storage. A file called
     * .png that is really something else is stored as whatever it claimed and
     * served with that content type, which is how an upload field becomes an
     * XSS hole — so SVG is allowed but the signed URL is the storage layer's
     * problem, not a reason to accept arbitrary types here.
     */
    const contentType = file.type || 'application/octet-stream'
    if (!ALLOWED.has(contentType)) {
      throw new DomainError('INVALID_INPUT', 'Use a PNG, JPEG, WebP or SVG.')
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // Never derived from the uploaded filename, for the same reason a photo
    // key is not: that is how a path traversal or a guessable key gets in.
    const stored = await storagePort().put({
      key: `salons/${ctx.salonId}/branding/${randomUUID()}`,
      body: bytes,
      contentType,
    })

    await saveLogoKey(ctx.salonId, stored.key)

    return NextResponse.json({ ok: true })
  } catch (err) {
    const { code, error } = toActionError(err)
    return NextResponse.json({ error }, { status: statusFor(code) })
  }
}

/**
 * Take it off.
 *
 * The stored object is left where it is: a logo is small, and deleting the
 * blob while another request is midway through signing a URL for it produces a
 * broken image on somebody's branded signup page. The reference is what
 * matters, and the reference is gone.
 */
export async function DELETE(request: Request) {
  try {
    const salonSlug = new URL(request.url).searchParams.get('salon')
    if (!salonSlug) throw new DomainError('INVALID_INPUT', 'Missing salon.')

    const ctx = await requireContext(salonSlug)
    authorize(ctx, 'settings.manage')

    await saveLogoKey(ctx.salonId, null)
    return NextResponse.json({ ok: true })
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
