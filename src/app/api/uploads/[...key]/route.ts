import { NextResponse } from 'next/server'
import { verifyLocalSignature } from '@/ports/storage'
import { readStoredObject } from '@/server/services/photo-serving'

/**
 * Serve a stored photo behind a signed, expiring URL.
 *
 * This exists so the local storage adapter behaves like S3 does: no permanent
 * public path, every read carrying an expiry and a signature. If dev served
 * photos from a plain path, the first thing to break on the switch to real
 * object storage would be every image on every page.
 *
 * With the S3 adapter the browser goes straight to a presigned S3 URL and this
 * route is never reached.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await context.params
  const key = segments.map(decodeURIComponent).join('/')

  const url = new URL(request.url)
  if (!verifyLocalSignature(key, url.searchParams.get('expires'), url.searchParams.get('sig'))) {
    // Deliberately indistinguishable from a missing object: a different
    // response for "wrong signature" would confirm that the key exists.
    return new NextResponse('Not found', { status: 404 })
  }

  const object = await readStoredObject(key)
  if (!object) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(new Uint8Array(object.bytes), {
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.bytes.length),
      // Cacheable only for as long as the signature is valid, and never by a
      // shared cache — these are photographs of identifiable people.
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
