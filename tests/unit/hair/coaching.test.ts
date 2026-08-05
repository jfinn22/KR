import { describe, expect, it } from 'vitest'
import { CAPTURE_ADVICE, coachingFor } from '@/domain/hair/photo-quality'

/**
 * Telling somebody what to fix.
 *
 * The scorer produces five distinct issue codes and the capture grid rendered
 * all of them as "too small or blurry to read". That is true of one, unhelpful
 * for three, and wrong for the one where the photo is neither — a heavily
 * recompressed screenshot is full-size and sharp, and telling its sender to
 * retake it teaches them the software is guessing.
 */

describe('what to do about a photo we cannot read', () => {
  it('names the actual problem rather than apologising generically', () => {
    expect(coachingFor(['TOO_SMALL'])).toMatch(/too small/i)
    expect(coachingFor(['HEAVILY_COMPRESSED'])).toMatch(/compressed/i)
    expect(coachingFor(['EXTREME_ASPECT'])).toMatch(/cropped/i)
    expect(coachingFor(['UNREADABLE'])).toMatch(/could not read/i)
  })

  it('tells a person what to DO, not just what is wrong', () => {
    // Somebody told "try another" takes the same photo again.
    expect(coachingFor(['TOO_SMALL'])).toMatch(/camera roll|original/i)
    expect(coachingFor(['TINY_FILE'])).toMatch(/original/i)
  })

  it('says one thing, not three', () => {
    /*
     * A client shown three problems with one photo deletes it and gives up.
     * Ordered so the fix most likely to solve the others comes first.
     */
    const line = coachingFor(['EXTREME_ASPECT', 'TOO_SMALL', 'UNREADABLE'])
    expect(line).toMatch(/could not read/i)
    expect(line).not.toMatch(/cropped/i)
  })

  it('says nothing when there is nothing wrong', () => {
    expect(coachingFor([])).toBeNull()
  })

  it('does not invent a line for a code it does not know', () => {
    // A new issue code should surface as a missing case, not as a wrong one.
    expect(coachingFor(['SOMETHING_NEW'])).toBeNull()
  })
})

describe('what to say before the shot', () => {
  it('is short enough that somebody reads all of it', () => {
    expect(CAPTURE_ADVICE.length).toBeLessThanOrEqual(5)
  })

  it('is about what a colourist can read, not about photography', () => {
    const all = CAPTURE_ADVICE.join(' ').toLowerCase()
    expect(all).toContain('daylight')
    expect(all).toContain('filter')
    expect(all).toContain('screenshot')
  })
})
