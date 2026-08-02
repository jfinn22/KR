import { describe, expect, it } from 'vitest'
import { assessPhoto, readDimensions } from '@/domain/hair/photo-quality'

/**
 * The scorer decides whether a consultation gets a real quote or a DATA_QUALITY
 * flag, so the header parsers have to be exactly right. A wrong dimension
 * produces a confident wrong score, which is worse than admitting we cannot
 * read the file.
 */

// --- Fixtures ---------------------------------------------------------------

function png(width: number, height: number, totalBytes = 200_000): Uint8Array {
  const b = new Uint8Array(Math.max(24, totalBytes))
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  writeBe32(b, 16, width)
  writeBe32(b, 20, height)
  return b
}

/** SOI, an APP0 segment, then a SOF0 carrying the dimensions. */
function jpeg(width: number, height: number, totalBytes = 400_000): Uint8Array {
  const b = new Uint8Array(Math.max(40, totalBytes))
  let i = 0
  b[i++] = 0xff
  b[i++] = 0xd8

  b[i++] = 0xff
  b[i++] = 0xe0
  b[i++] = 0x00
  b[i++] = 0x10 // length 16, including these two bytes
  i += 14

  b[i++] = 0xff
  b[i++] = 0xc0
  b[i++] = 0x00
  b[i++] = 0x11 // length 17
  b[i++] = 0x08 // precision
  b[i++] = (height >> 8) & 0xff
  b[i++] = height & 0xff
  b[i++] = (width >> 8) & 0xff
  b[i++] = width & 0xff
  return b
}

function webpVp8x(width: number, height: number, totalBytes = 200_000): Uint8Array {
  const b = new Uint8Array(Math.max(40, totalBytes))
  writeAscii(b, 0, 'RIFF')
  writeAscii(b, 8, 'WEBP')
  writeAscii(b, 12, 'VP8X')
  writeLe24(b, 24, width - 1)
  writeLe24(b, 27, height - 1)
  return b
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(100_000)
  writeAscii(b, 0, 'GIF89a')
  b[6] = width & 0xff
  b[7] = (width >> 8) & 0xff
  b[8] = height & 0xff
  b[9] = (height >> 8) & 0xff
  return b
}

function writeBe32(b: Uint8Array, offset: number, value: number) {
  b[offset] = (value >>> 24) & 0xff
  b[offset + 1] = (value >>> 16) & 0xff
  b[offset + 2] = (value >>> 8) & 0xff
  b[offset + 3] = value & 0xff
}
function writeLe24(b: Uint8Array, offset: number, value: number) {
  b[offset] = value & 0xff
  b[offset + 1] = (value >> 8) & 0xff
  b[offset + 2] = (value >> 16) & 0xff
}
function writeAscii(b: Uint8Array, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) b[offset + i] = text.charCodeAt(i)
}

// --- Tests ------------------------------------------------------------------

describe('reading dimensions from a header', () => {
  it('reads PNG', () => {
    expect(readDimensions(png(1440, 1920))).toEqual({ width: 1440, height: 1920 })
  })

  it('reads JPEG, walking past the APP0 segment to the SOF', () => {
    expect(readDimensions(jpeg(3024, 4032))).toEqual({ width: 3024, height: 4032 })
  })

  it('reads WebP VP8X', () => {
    expect(readDimensions(webpVp8x(1080, 1350))).toEqual({ width: 1080, height: 1350 })
  })

  it('reads GIF', () => {
    expect(readDimensions(gif(500, 400))).toEqual({ width: 500, height: 400 })
  })

  // A guessed dimension would produce a confident wrong score.
  it('returns null rather than guessing at something unrecognised', () => {
    expect(readDimensions(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
    expect(readDimensions(new Uint8Array(0))).toBeNull()
  })

  it('gives up on a JPEG whose headers end at the scan', () => {
    const b = new Uint8Array(50)
    b[0] = 0xff
    b[1] = 0xd8
    b[2] = 0xff
    b[3] = 0xda // start of scan, before any SOF
    expect(readDimensions(b)).toBeNull()
  })

  it('is not fooled by a truncated file claiming to be a PNG', () => {
    expect(readDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})

describe('scoring', () => {
  it('scores a normal phone photo highly', () => {
    const quality = assessPhoto(jpeg(3024, 4032, 2_500_000))
    expect(quality.score).toBeGreaterThan(0.9)
    expect(quality.issues).toEqual([])
  })

  // The threshold that matters: the rules engine flags below 0.4.
  it('flags a thumbnail as too small to judge tone', () => {
    const quality = assessPhoto(png(240, 320, 30_000))
    expect(quality.issues).toContain('TOO_SMALL')
    expect(quality.score).toBeLessThan(0.4)
  })

  it('flags a heavily recompressed image even at good resolution', () => {
    const quality = assessPhoto(jpeg(2000, 2000, 60_000))
    expect(quality.issues).toContain('HEAVILY_COMPRESSED')
    expect(quality.score).toBeLessThan(0.9)
  })

  it('flags a strip crop that cannot be a head of hair', () => {
    const quality = assessPhoto(png(4000, 800, 800_000))
    expect(quality.issues).toContain('EXTREME_ASPECT')
  })

  it('accepts a portrait aspect without complaint', () => {
    expect(assessPhoto(jpeg(1080, 1920, 900_000)).issues).not.toContain('EXTREME_ASPECT')
  })

  it('says it cannot tell rather than blaming the photo', () => {
    const quality = assessPhoto(new Uint8Array([0, 1, 2, 3]))
    expect(quality.issues).toEqual(['UNREADABLE'])
    expect(quality.dimensions).toBeNull()
    // Low enough to prompt another, not so low it reads as a bad photograph.
    expect(quality.score).toBeGreaterThan(0.2)
    expect(quality.score).toBeLessThan(0.4)
  })

  it('always returns a score inside 0..1', () => {
    const cases = [
      png(1, 1, 10),
      png(20_000, 20_000, 50_000_000),
      jpeg(640, 640, 1),
      gif(1, 30_000),
    ]
    for (const bytes of cases) {
      const { score } = assessPhoto(bytes)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic — the same bytes always score the same', () => {
    const bytes = jpeg(1500, 2000, 700_000)
    expect(assessPhoto(bytes).score).toBe(assessPhoto(bytes).score)
  })
})
