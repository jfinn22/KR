import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { AdapterError, requireEnv } from './types'

/**
 * Object storage for client and inspiration photographs.
 *
 * Two things are non-negotiable and therefore live in the port rather than in
 * a caller's discipline: EXIF is stripped before an image is ever readable,
 * and URLs are short-lived and signed. Photo EXIF carries GPS coordinates, and
 * a salon's client photos are the most sensitive data in the system.
 */

export interface PutObjectInput {
  key: string
  body: Buffer
  contentType: string
  /** Default true. Only set false for content that provably has no EXIF. */
  stripExif?: boolean
}

export interface StoredObject {
  key: string
  bytes: number
  sha256: string
  contentType: string
  exifStripped: boolean
}

export interface StoragePort {
  readonly name: string
  put(input: PutObjectInput): Promise<StoredObject>
  get(key: string): Promise<Buffer | null>
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>
  delete(key: string): Promise<void>
}

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
const MAX_BYTES = 15 * 1024 * 1024

export function assertUploadable(port: string, input: PutObjectInput): void {
  if (!ALLOWED.has(input.contentType)) {
    throw new AdapterError(
      port,
      'UNSUPPORTED_TYPE',
      `Content type ${input.contentType} is not allowed.`,
    )
  }
  if (input.body.length === 0) {
    throw new AdapterError(port, 'EMPTY_BODY', 'Refusing to store an empty object.')
  }
  if (input.body.length > MAX_BYTES) {
    throw new AdapterError(port, 'TOO_LARGE', `Object exceeds ${MAX_BYTES} bytes.`)
  }
  if (input.key.includes('..') || input.key.startsWith('/')) {
    throw new AdapterError(
      port,
      'INVALID_KEY',
      'Object key must be relative and must not traverse.',
    )
  }
}

/**
 * Remove EXIF/metadata segments from a JPEG.
 *
 * Walks the JPEG marker chain and drops APP1 (Exif/XMP) and APP13 (IPTC).
 * Deliberately dependency-free: an image library is a large attack surface for
 * one well-defined byte-level operation, and this way the guarantee holds even
 * when `sharp` is not installed. PNG and WebP are passed through — neither
 * carries GPS in the containers browsers produce.
 */
export function stripJpegMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer

  const out: Buffer[] = [buffer.subarray(0, 2)]
  let offset = 2

  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) break
    const marker = buffer[offset + 1]!

    // Start of scan — the rest is entropy-coded image data.
    if (marker === 0xda) {
      out.push(buffer.subarray(offset))
      break
    }
    if (marker === 0xd9) {
      out.push(buffer.subarray(offset, offset + 2))
      break
    }

    const length = buffer.readUInt16BE(offset + 2)
    const isMetadata = marker === 0xe1 || marker === 0xed || marker === 0xee
    if (!isMetadata) out.push(buffer.subarray(offset, offset + 2 + length))
    offset += 2 + length
  }

  return Buffer.concat(out)
}

function applyStrip(input: PutObjectInput): { body: Buffer; stripped: boolean } {
  if (input.stripExif === false) return { body: input.body, stripped: false }
  if (input.contentType === 'image/jpeg') {
    return { body: stripJpegMetadata(input.body), stripped: true }
  }
  return { body: input.body, stripped: true }
}

// ---------------------------------------------------------------------------

export class MockStorageAdapter implements StoragePort {
  readonly name = 'storage:mock'

  private readonly root: string

  constructor(baseDir?: string) {
    // Defaults to a temp directory so the unit test tier never writes into the
    // working tree, and so contract tests need no fixtures to clean up.
    this.root = resolve(baseDir ?? join(tmpdir(), 'salon-mock-storage'))
  }

  private path(key: string): string {
    const full = resolve(join(this.root, key))
    if (!full.startsWith(this.root)) {
      throw new AdapterError(this.name, 'INVALID_KEY', 'Resolved path escapes the storage root.')
    }
    return full
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertUploadable(this.name, input)
    const { body, stripped } = applyStrip(input)
    const path = this.path(input.key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    return {
      key: input.key,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      contentType: input.contentType,
      exifStripped: stripped,
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key))
    } catch {
      return null
    }
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    // Mirrors the shape of a real signed URL so callers cannot come to depend
    // on a permanent path that would break when they switch to S3.
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds
    const sig = createHash('sha256').update(`${key}:${expires}`).digest('hex').slice(0, 32)
    return `/api/uploads/${encodeURIComponent(key)}?expires=${expires}&sig=${sig}`
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
}

export class S3StorageAdapter implements StoragePort {
  readonly name = 'storage:s3'

  constructor(
    private readonly bucket?: string,
    private readonly region = 'us-east-1',
    private readonly accessKeyId?: string,
    private readonly secretAccessKey?: string,
    private readonly endpoint?: string,
  ) {}

  private async client() {
    requireEnv('storage', {
      S3_BUCKET: this.bucket,
      S3_ACCESS_KEY_ID: this.accessKeyId,
      S3_SECRET_ACCESS_KEY: this.secretAccessKey,
    })
    const { S3Client } = await import('@aws-sdk/client-s3')
    return new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      forcePathStyle: Boolean(this.endpoint),
      credentials: { accessKeyId: this.accessKeyId!, secretAccessKey: this.secretAccessKey! },
    })
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    assertUploadable(this.name, input)
    const { body, stripped } = applyStrip(input)
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.client()
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket!,
        Key: input.key,
        Body: body,
        ContentType: input.contentType,
      }),
    )
    return {
      key: input.key,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      contentType: input.contentType,
      exifStripped: stripped,
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.client()
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: this.bucket!, Key: key }))
      const bytes = await res.Body!.transformToByteArray()
      return Buffer.from(bytes)
    } catch {
      return null
    }
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3')
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner')
    const client = await this.client()
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket!, Key: key }), {
      expiresIn: expiresInSeconds,
    })
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await this.client()
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket!, Key: key }))
  }
}
