import { unsafeDb } from '@/server/db/client'
import { storagePort } from '@/ports/registry'

/**
 * Reading a stored object back out for the signed-URL route.
 *
 * A service rather than inline route code because route handlers are barred
 * from importing the database client directly — the boundary that keeps
 * queries out of the request layer.
 */

export interface ServedObject {
  bytes: Buffer
  contentType: string
}

const BRANDING_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export async function readStoredObject(storageKey: string): Promise<ServedObject | null> {
  // The asset row is the authority on what this key is allowed to be served
  // as: trusting a sniffed type would let an uploaded file dictate how the
  // browser interprets it.
  const asset = await unsafeDb.photoAsset.findFirst({
    where: { storageKey, deletedAt: null },
    select: { mimeType: true },
  })
  if (asset) {
    const bytes = await storagePort().get(storageKey)
    if (!bytes) return null
    return { bytes, contentType: asset.mimeType }
  }

  // Salon logos live under branding/ and are referenced from SalonSettings
  // brand JSON rather than PhotoAsset — serve them when the key matches.
  const branding = await brandingObject(storageKey)
  if (branding) return branding

  return null
}

async function brandingObject(storageKey: string): Promise<ServedObject | null> {
  const match = /^salons\/([^/]+)\/branding\//.exec(storageKey)
  if (!match) return null
  const salonId = match[1]!

  const salon = await unsafeDb.salon.findUnique({
    where: { id: salonId },
    select: { brandJson: true },
  })
  const brand = salon?.brandJson
  const logoKey =
    brand && typeof brand === 'object' && brand !== null && 'logoKey' in brand
      ? (brand as { logoKey?: unknown }).logoKey
      : null
  if (typeof logoKey !== 'string' || logoKey !== storageKey) return null

  const bytes = await storagePort().get(storageKey)
  if (!bytes) return null

  // Content type was declared at put time; without a PhotoAsset row, infer from
  // the magic bytes rather than trusting a query string.
  const contentType = sniffImageType(bytes)
  if (!contentType || !BRANDING_TYPES.has(contentType)) return null

  return { bytes, contentType }
}

function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}
