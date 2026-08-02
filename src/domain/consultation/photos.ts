import type { ServiceFactSpec } from './facts'

/**
 * How many photos a consultation genuinely needs.
 *
 * Asking for seven angles is right before a full head of balayage and absurd
 * before a dry cut. Every unnecessary photo prompt is a place a client puts
 * their phone down, and an abandoned consultation books nothing — so the ask
 * scales with what is actually being decided from the picture.
 *
 * Pure and service-driven, so the same basket always asks for the same set and
 * the rules engine's `INSUFFICIENT_PHOTOS` flag never fires for a photo nobody
 * needed.
 */

export type PhotoView =
  | 'FRONT'
  | 'BACK'
  | 'LEFT'
  | 'RIGHT'
  | 'ROOTS'
  | 'MIDS'
  | 'ENDS'
  | 'TEXTURE'
  | 'WET'
  | 'SCALP'
  | 'PART'
  | 'OTHER'

/**
 * Nothing chemical is being decided, so nothing is required.
 *
 * A cut is quoted from its own price and duration, not from the picture. The
 * stylist still likes seeing the current shape, which is why front and back are
 * *suggested* below — but a client without them is not a client we refuse to
 * quote, and holding a 45-minute cut behind a photo upload is how a salon
 * teaches its clients that the consultation is busywork.
 */
const SHAPE: readonly PhotoView[] = []

/**
 * Existing colour and how it sits — needed before anything is applied.
 *
 * Texture is required, not suggested. A shot taken head-on at arm's length
 * cannot tell fine straight hair from coarse curly hair, and the difference
 * changes how fast it processes, how evenly it takes, and what it looks like
 * dry — so an estimate made without it is a guess wearing a number. It is one
 * extra frame on a set that already runs to five, which is a small cost against
 * being wrong about the timing.
 */
const COLOUR: readonly PhotoView[] = ['FRONT', 'BACK', 'ROOTS', 'MIDS', 'ENDS', 'TEXTURE']

/**
 * Lightening also needs the sides: banding and previous foil lines show at the
 * temples long before they show head-on, and the ends decide how far it lifts.
 */
const LIGHTENING: readonly PhotoView[] = [
  'FRONT',
  'BACK',
  'LEFT',
  'RIGHT',
  'ROOTS',
  'MIDS',
  'ENDS',
  'TEXTURE',
]

/** Extensions are matched against real density and texture at the part line. */
const EXTENSIONS: readonly PhotoView[] = ['FRONT', 'BACK', 'PART', 'ENDS', 'TEXTURE']

const ORDER: readonly PhotoView[] = [
  'FRONT',
  'BACK',
  'LEFT',
  'RIGHT',
  'PART',
  'ROOTS',
  'MIDS',
  'ENDS',
  'TEXTURE',
  'WET',
  'SCALP',
  'OTHER',
]

export type PhotoNeedInput = Pick<
  ServiceFactSpec,
  'isChemical' | 'isLightening' | 'containsDye' | 'isExtensionInstall'
>

/**
 * The union of what every service in the basket needs.
 *
 * A cut booked alongside a balayage still needs the balayage photos — the
 * strictest service in the basket sets the bar, because the risky one is the
 * one being assessed.
 */
export function requiredPhotoViews(services: readonly PhotoNeedInput[]): readonly PhotoView[] {
  const needed = new Set<PhotoView>()

  for (const service of services) {
    const views = service.isLightening
      ? LIGHTENING
      : service.isExtensionInstall
        ? EXTENSIONS
        : service.isChemical || service.containsDye
          ? COLOUR
          : SHAPE
    for (const view of views) needed.add(view)
  }

  // Stable order so the capture grid never reshuffles between renders.
  return ORDER.filter((view) => needed.has(view))
}

/**
 * Photos a client should be nudged for but never blocked on.
 *
 * Only the wet shot is left here. Texture used to sit in this list and was
 * moved into the required sets — it is the frame that decides whether an
 * estimate is honest, and something the estimate depends on does not belong in
 * a list of nice-to-haves.
 */
export function suggestedPhotoViews(services: readonly PhotoNeedInput[]): readonly PhotoView[] {
  const required = new Set(requiredPhotoViews(services))
  const suggested = new Set<PhotoView>(['FRONT', 'BACK'])

  for (const service of services) {
    if (service.isLightening) suggested.add('WET')
  }

  return ORDER.filter((view) => suggested.has(view) && !required.has(view))
}
