import { describe, expect, it } from 'vitest'
import { requiredPhotoViews, suggestedPhotoViews } from '@/domain/consultation/photos'

/**
 * The photo ask is the single biggest place a client abandons a consultation.
 * These tests hold the line in both directions: never ask for a photo the
 * decision does not depend on, and never let a lightening service through
 * without the angles that decide whether it is achievable.
 */

const cut = {
  isChemical: false,
  isLightening: false,
  containsDye: false,
  isExtensionInstall: false,
}
const gloss = { ...cut, isChemical: true, containsDye: true }
const balayage = { ...cut, isChemical: true, isLightening: true }
const extensions = { ...cut, isExtensionInstall: true }

describe('required photo views', () => {
  it('asks for nothing before a dry cut', () => {
    expect(requiredPhotoViews([cut])).toEqual([])
  })

  it('asks for existing colour before anything is applied', () => {
    expect(requiredPhotoViews([gloss])).toEqual(['FRONT', 'BACK', 'ROOTS', 'MIDS', 'ENDS'])
  })

  // Banding and old foil lines show at the temples long before they show head-on.
  it('adds the sides for lightening', () => {
    const views = requiredPhotoViews([balayage])
    expect(views).toContain('LEFT')
    expect(views).toContain('RIGHT')
    expect(views).toHaveLength(7)
  })

  it('asks for the part line before extensions', () => {
    expect(requiredPhotoViews([extensions])).toContain('PART')
  })

  // The risky service is the one being assessed, so it sets the bar.
  it('takes the strictest service in a mixed basket', () => {
    expect(requiredPhotoViews([cut, balayage])).toEqual(requiredPhotoViews([balayage]))
  })

  it('unions across services without duplicating', () => {
    const views = requiredPhotoViews([gloss, extensions])
    expect(new Set(views).size).toBe(views.length)
    expect(views).toContain('PART')
    expect(views).toContain('ROOTS')
  })

  it('returns a stable order regardless of basket order, so the grid never reshuffles', () => {
    expect(requiredPhotoViews([extensions, gloss])).toEqual(requiredPhotoViews([gloss, extensions]))
  })

  it('asks for nothing when there is no service yet', () => {
    expect(requiredPhotoViews([])).toEqual([])
  })
})

describe('suggested photo views', () => {
  it('still invites the shape shots for a cut', () => {
    expect(suggestedPhotoViews([cut])).toEqual(['FRONT', 'BACK'])
  })

  it('never repeats something already required', () => {
    const required = new Set(requiredPhotoViews([balayage]))
    expect(suggestedPhotoViews([balayage]).some((v) => required.has(v))).toBe(false)
  })

  it('invites texture for chemical work and a wet shot for lightening', () => {
    expect(suggestedPhotoViews([gloss])).toContain('TEXTURE')
    expect(suggestedPhotoViews([balayage])).toEqual(['TEXTURE', 'WET'])
  })
})
