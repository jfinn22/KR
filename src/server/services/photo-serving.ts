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

export async function readStoredObject(storageKey: string): Promise<ServedObject | null> {
  // The asset row is the authority on what this key is allowed to be served
  // as: trusting a sniffed type would let an uploaded file dictate how the
  // browser interprets it.
  const asset = await unsafeDb.photoAsset.findFirst({
    where: { storageKey, deletedAt: null },
    select: { mimeType: true },
  })
  if (!asset) return null

  const bytes = await storagePort().get(storageKey)
  if (!bytes) return null

  return { bytes, contentType: asset.mimeType }
}
