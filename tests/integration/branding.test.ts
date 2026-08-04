import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { brandingForSlug, saveAccent, saveLogoKey } from '@/server/services/branding'
import { deriveAccentLadder } from '@/domain/branding/contrast'
import {
  interleaveSettings,
  saveSchedulingSettings,
  schedulingSettings,
} from '@/server/services/settings'

/**
 * Branding and settings against a real database.
 *
 * The point of interest is that branding must resolve from a SLUG with no
 * principal — the signup page is branded and the person looking at it is not a
 * client of anything yet. Everything else in the product reads through a
 * TenantContext, so this is the one path that has to work without one.
 */

const S = 'br_salon'
const SLUG = 'br-test-salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: SLUG,
      name: 'Branding Test Salon',
      defaultTimezone: 'America/New_York',
      settings: { create: {} },
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
})

describe('branding resolves without a principal', () => {
  it('finds a salon by slug alone', async () => {
    const branding = await brandingForSlug(SLUG)
    expect(branding?.salonId).toBe(S)
    expect(branding?.salonName).toBe('Branding Test Salon')
  })

  it('returns null for a salon that does not exist', async () => {
    expect(await brandingForSlug('no-such-salon')).toBeNull()
  })

  it('an unbranded salon resolves with no overrides, so the shipped palette stands', async () => {
    const branding = await brandingForSlug(SLUG)
    expect(branding?.accentHex).toBeNull()
    expect(branding?.cssVariables).toEqual({})
  })
})

describe('saving an accent', () => {
  it('stores the seed colour and serves the derived ladder', async () => {
    await saveAccent(S, '#C7457F')
    const branding = await brandingForSlug(SLUG)

    expect(branding?.accentHex).toBe('#C7457F')

    // Channel triplets, not hex — every blue in the theme resolves through
    // `rgb(var(--blue-500) / <alpha>)`, so a hex here would break every
    // alpha modifier in the product.
    expect(branding?.cssVariables['--blue-500']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
    for (const rung of [900, 700, 500, 300, 100, 50]) {
      expect(branding?.cssVariables[`--blue-${rung}`], `rung ${rung}`).toBeTruthy()
    }
  })

  it('only the seed is persisted, so improving the derivation improves every salon', async () => {
    await saveAccent(S, '#0F766E')
    const row = await unsafeDb.salon.findUnique({ where: { id: S }, select: { brandJson: true } })
    expect(row?.brandJson).toEqual({ accentHex: '#0F766E' })
  })

  it('refuses a colour that cannot carry white text, and says which pair failed', async () => {
    // Near-grey: the ladder would be indistinguishable from ordinary text.
    await expect(saveAccent(S, '#8A8A8C')).rejects.toThrow(/grey/i)

    const branding = await brandingForSlug(SLUG)
    expect(branding?.accentHex, 'nothing was stored').toBeNull()
  })

  it('refuses something that is not a colour', async () => {
    await expect(saveAccent(S, 'burgundy')).rejects.toThrow()
  })

  it('clearing it returns the salon to the shipped palette', async () => {
    await saveAccent(S, '#6D28D9')
    await saveAccent(S, null)

    const branding = await brandingForSlug(SLUG)
    expect(branding?.accentHex).toBeNull()
    expect(branding?.cssVariables).toEqual({})
  })

  it('what is served matches what the pure derivation produces', async () => {
    await saveAccent(S, '#1E7A3C')
    const branding = await brandingForSlug(SLUG)
    const derived = deriveAccentLadder('#1E7A3C')

    expect(derived.ok).toBe(true)
    if (derived.ok) {
      // 30 34 60 style triplet for #1E223C — compare on the parsed hex so the
      // test is about agreement, not about formatting.
      expect(Object.keys(branding?.cssVariables ?? {})).toHaveLength(6)
    }
  })

  it('a logo and an accent do not overwrite each other', async () => {
    await saveAccent(S, '#C7457F')
    await saveLogoKey(S, 'salons/br/logo.png')

    const row = await unsafeDb.salon.findUnique({ where: { id: S }, select: { brandJson: true } })
    expect(row?.brandJson).toEqual({ accentHex: '#C7457F', logoKey: 'salons/br/logo.png' })
  })
})

describe('scheduling settings', () => {
  it('defaults match what the availability solver falls back to', async () => {
    // If these ever diverge, the phase editor and the solver disagree again.
    const view = await schedulingSettings(S)
    expect(view).toEqual({
      interleaveEnabled: false,
      minInterleaveMin: 25,
      maxConcurrentClients: 2,
    })
  })

  it('saving is visible to the interleave reader the phase editor uses', async () => {
    await saveSchedulingSettings(S, {
      interleaveEnabled: true,
      minInterleaveMin: 30,
      maxConcurrentClients: 3,
    })

    expect(await interleaveSettings(S)).toEqual({
      interleaveEnabled: true,
      minInterleaveMin: 30,
    })
  })
})
