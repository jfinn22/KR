import { z } from 'zod'
import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { storagePort } from '@/ports/registry'
import { deriveAccentLadder, toChannels, parseHex } from '@/domain/branding/contrast'

/**
 * A salon's own colour and logo.
 *
 * Two things make this different from every other read in the codebase.
 *
 * First, it must resolve WITHOUT a principal. The signup page is branded and
 * the person looking at it is not a client of anything yet — so this takes a
 * slug, not a `TenantContext`, and deliberately does not go through
 * `resolveContext`, which returns null for exactly that visitor.
 *
 * Second, what is stored is the salon's chosen colour, and what is served is
 * the derived ladder. Storing only the seed means a later change to the
 * derivation improves every salon at once; storing the ladder as well would
 * freeze today's arithmetic into the database.
 */

/** What `Salon.brandJson` holds. Anything else is treated as absent. */
const BRAND_JSON = z.object({
  accentHex: z.string().optional(),
  logoKey: z.string().optional(),
})

export interface SalonBranding {
  salonId: string
  salonName: string
  slug: string
  /** null when the salon has not branded, or is not on a plan that may. */
  accentHex: string | null
  logoUrl: string | null
  /**
   * `--blue-*` overrides, ready to drop on an element as inline style. Empty
   * when unbranded, so the shipped palette simply stands.
   */
  cssVariables: Record<string, string>
}

/**
 * Resolve branding from a slug alone. Safe to call before authentication.
 *
 * Returns null only when the salon does not exist — an unbranded salon still
 * resolves, with an empty variable set.
 */
export async function brandingForSlug(slug: string): Promise<SalonBranding | null> {
  const salon = await unsafeDb.salon.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, brandJson: true },
  })
  if (!salon) return null

  const parsed = BRAND_JSON.safeParse(salon.brandJson ?? {})
  const brand = parsed.success ? parsed.data : {}

  const accentHex = brand.accentHex ?? null
  const logoUrl = brand.logoKey ? await storagePort().signedUrl(brand.logoKey) : null

  return {
    salonId: salon.id,
    salonName: salon.name,
    slug: salon.slug,
    accentHex,
    logoUrl,
    cssVariables: accentHex ? cssVariablesFor(accentHex) : {},
  }
}

/**
 * The accent as CSS custom properties.
 *
 * Channel triplets rather than hex, because the whole theme resolves through
 * `rgb(var(--token) / <alpha-value>)` — a hex here would silently break every
 * `bg-blue-500/40` in the product.
 *
 * A colour that no longer derives cleanly yields nothing rather than a partial
 * ladder. Half a ladder is worse than none: the untouched rungs would still be
 * the shipped blue and the result reads as a rendering fault.
 */
export function cssVariablesFor(accentHex: string): Record<string, string> {
  const derived = deriveAccentLadder(accentHex)
  if (!derived.ok) return {}

  const vars: Record<string, string> = {}
  for (const [rung, hex] of Object.entries(derived.ladder)) {
    const rgb = parseHex(hex)
    if (rgb) vars[`--blue-${rung}`] = toChannels(rgb)
  }
  return vars
}

/**
 * Save a salon's accent.
 *
 * Validation happens here rather than in the action, because the reason to
 * refuse is a contrast measurement rather than a schema violation — and the
 * message has to name the pair that failed, so an owner can pick a colour that
 * works instead of guessing.
 */
export async function saveAccent(salonId: string, accentHex: string | null): Promise<void> {
  const existing = await currentBrand(salonId)

  if (accentHex === null) {
    await writeBrand(salonId, { ...existing, accentHex: undefined })
    return
  }

  const derived = deriveAccentLadder(accentHex)
  if (!derived.ok) throw new DomainError('INVALID_INPUT', derived.reason)

  await writeBrand(salonId, { ...existing, accentHex })
}

export async function saveLogoKey(salonId: string, logoKey: string | null): Promise<void> {
  const existing = await currentBrand(salonId)
  await writeBrand(salonId, { ...existing, logoKey: logoKey ?? undefined })
}

async function currentBrand(salonId: string): Promise<z.infer<typeof BRAND_JSON>> {
  const salon = await unsafeDb.salon.findUnique({
    where: { id: salonId },
    select: { brandJson: true },
  })
  const parsed = BRAND_JSON.safeParse(salon?.brandJson ?? {})
  return parsed.success ? parsed.data : {}
}

async function writeBrand(salonId: string, brand: z.infer<typeof BRAND_JSON>): Promise<void> {
  // Strip undefined so a cleared field leaves no key behind.
  const clean = Object.fromEntries(Object.entries(brand).filter(([, v]) => v !== undefined))
  await unsafeDb.salon.update({
    where: { id: salonId },
    data: { brandJson: clean as never },
  })
}
