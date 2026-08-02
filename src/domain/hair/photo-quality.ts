/**
 * Mechanical photo quality.
 *
 * Not an opinion about the hair — that is the AI port's job. This answers the
 * cheaper question the estimate actually depends on: is there enough image
 * here to judge tone and condition at all?
 *
 * Two signals, both derivable from the file itself with no decoding:
 *
 *  - Resolution. A 320px-wide photo cannot show banding or the state of the
 *    ends, however good the lighting was.
 *  - Bytes per pixel. A heavily recompressed screenshot has had exactly the
 *    tonal gradients smeared away that a colourist reads. A large file is no
 *    guarantee of quality, but a tiny one is a reliable guarantee of its
 *    absence.
 *
 * Pure over bytes, so it is fully testable and runs identically in the worker
 * and in a test.
 */

export interface ImageDimensions {
  width: number
  height: number
}

export type QualityIssue =
  'TOO_SMALL' | 'HEAVILY_COMPRESSED' | 'EXTREME_ASPECT' | 'UNREADABLE' | 'TINY_FILE'

export interface PhotoQuality {
  /** 0..1. The rules engine flags DATA_QUALITY below 0.4. */
  score: number
  issues: readonly QualityIssue[]
  dimensions: ImageDimensions | null
}

/** Below this, a photo cannot support a colour judgement at all. */
const MIN_EDGE = 640
/** Comfortable. Roughly what any phone camera produces without trying. */
const GOOD_EDGE = 1280
/** JPEG at reasonable quality sits well above this. */
const MIN_BYTES_PER_PIXEL = 0.06
const GOOD_BYTES_PER_PIXEL = 0.15

export function assessPhoto(bytes: Uint8Array): PhotoQuality {
  const dimensions = readDimensions(bytes)

  if (!dimensions) {
    // Unreadable header. Do not claim it is bad hair-wise — say we cannot tell,
    // and score it low enough that the engine asks for another.
    return { score: 0.3, issues: ['UNREADABLE'], dimensions: null }
  }

  const issues: QualityIssue[] = []
  const { width, height } = dimensions
  const shortEdge = Math.min(width, height)
  const pixels = width * height
  const bytesPerPixel = pixels > 0 ? bytes.length / pixels : 0

  const resolutionScore = ratio(shortEdge, MIN_EDGE, GOOD_EDGE)
  if (shortEdge < MIN_EDGE) issues.push('TOO_SMALL')

  const compressionScore = ratio(bytesPerPixel, MIN_BYTES_PER_PIXEL, GOOD_BYTES_PER_PIXEL)
  if (bytesPerPixel < MIN_BYTES_PER_PIXEL) issues.push('HEAVILY_COMPRESSED')

  // A 4:1 crop is a strip of something, not a head of hair.
  const aspect = Math.max(width, height) / Math.max(1, shortEdge)
  const aspectScore = aspect > 3 ? 0.4 : aspect > 2.2 ? 0.75 : 1
  if (aspect > 3) issues.push('EXTREME_ASPECT')

  if (bytes.length < 20_000) issues.push('TINY_FILE')

  const weighted =
    (resolutionScore * 0.55 + compressionScore * 0.3 + aspectScore * 0.15) *
    (issues.includes('TINY_FILE') ? 0.8 : 1)

  /*
   * Resolution is a ceiling, not just a term.
   *
   * A 240px photo is unusable no matter how cleanly it was encoded, and a
   * purely weighted score lets a well-compressed thumbnail climb back over the
   * flag threshold on the strength of the two things that stopped mattering
   * the moment there were too few pixels to see banding.
   */
  const ceiling = shortEdge < MIN_EDGE ? 0.35 : 1

  return { score: round3(clamp01(Math.min(weighted, ceiling))), issues, dimensions }
}

/**
 * Width and height from the file header alone.
 *
 * Supports the formats a phone actually produces. Returns null rather than
 * guessing — a wrong dimension would produce a confident wrong score, which is
 * worse than admitting we cannot read it.
 */
export function readDimensions(bytes: Uint8Array): ImageDimensions | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes) ?? readGif(bytes)
}

function readPng(b: Uint8Array): ImageDimensions | null {
  // \x89PNG\r\n\x1a\n then IHDR at byte 16.
  if (b.length < 24) return null
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null
  return { width: be32(b, 16), height: be32(b, 20) }
}

function readJpeg(b: Uint8Array): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null

  let offset = 2
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = b[offset + 1]!

    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // Start of scan — past this is entropy-coded data, no more headers.
    if (marker === 0xda) return null

    const length = be16(b, offset + 2)
    if (length < 2) return null

    // SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (offset + 9 >= b.length) return null
      return { height: be16(b, offset + 5), width: be16(b, offset + 7) }
    }

    offset += 2 + length
  }
  return null
}

function readWebp(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null

  const format = ascii(b, 12, 4)

  if (format === 'VP8X') {
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
  }
  if (format === 'VP8 ') {
    // Frame header: 3-byte tag, 3-byte start code, then 2+2 bytes of size with
    // the top two bits used as a scale factor.
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  }
  if (format === 'VP8L') {
    const bits = le32(b, 21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  return null
}

function readGif(b: Uint8Array): ImageDimensions | null {
  if (b.length < 10 || ascii(b, 0, 3) !== 'GIF') return null
  return { width: le16(b, 6), height: le16(b, 8) }
}

// --- Byte helpers -----------------------------------------------------------

const at = (b: Uint8Array, i: number): number => b[i] ?? 0

const be16 = (b: Uint8Array, i: number) => (at(b, i) << 8) | at(b, i + 1)
const be32 = (b: Uint8Array, i: number) =>
  ((at(b, i) << 24) | (at(b, i + 1) << 16) | (at(b, i + 2) << 8) | at(b, i + 3)) >>> 0
const le16 = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8)
const le24 = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16)
const le32 = (b: Uint8Array, i: number) =>
  (at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16) | (at(b, i + 3) << 24)) >>> 0

function ascii(b: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(at(b, offset + i))
  return out
}

function ratio(value: number, min: number, good: number): number {
  if (value >= good) return 1
  if (value <= min * 0.5) return 0
  // Linear from half-the-minimum up to comfortable.
  return clamp01((value - min * 0.5) / (good - min * 0.5))
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const round3 = (n: number) => Math.round(n * 1000) / 1000
