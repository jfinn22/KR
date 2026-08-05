'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  removeInspirationAction,
  submitConsultationAction,
  tagInspirationAction,
} from '@/server/actions/consultation'
import { TONE_FAMILIES, shadeByKey } from '@/domain/hair/tone'
import { compareToReference } from '@/domain/hair/comparison'
import type { Level } from '@/domain/consultation/facts'

/**
 * Reference pictures: the last step of every consultation.
 *
 * This used to be a text link at the bottom of the photo step, which is where
 * features go to be ignored. It is the single most useful thing a client can
 * give a stylist — "level 8 golden blonde" is four words that three colourists
 * will read three ways, and a picture is not — so it gets its own screen, the
 * upload is the largest thing on it, and the consultation submits from here.
 *
 * Every uploaded reference immediately asks "what do you like about it?", with
 * the answer as a small set of tags rather than a free-text box. Tags are what
 * a stylist can act on; a paragraph is what they have to interpret. A photo
 * still beats no photo, so nothing here blocks on tagging.
 */

const ATTRIBUTES = [
  { key: 'TARGET_TONE', label: 'The tone', help: 'Warm, ashy, golden…' },
  { key: 'BRIGHTNESS', label: 'How light it is' },
  { key: 'CONTRAST', label: 'The contrast', help: 'Bold or blended' },
  { key: 'DIMENSION', label: 'The dimension' },
  { key: 'ROOT_SHADOW', label: 'Roots' },
  { key: 'TECHNIQUE', label: 'The technique' },
  { key: 'CURLS', label: 'The texture' },
  { key: 'TARGET_LEVEL', label: 'The overall level' },
] as const

type AttributeKey = (typeof ATTRIBUTES)[number]['key']

export interface InspirationPhotoView {
  id: string
  sourceUrl: string | null
  clientNote: string | null
  url: string | null
  attributes: { key: string; value: string; source: string }[]
}

export function InspirationBoard({
  salonSlug,
  consultationId,
  initialPhotos,
  current,
}: {
  salonSlug: string
  consultationId: string
  initialPhotos: InspirationPhotoView[]
  /** Where the client's hair is now, for measuring a reference against. */
  current: { shadeKey: string | null; level: number | null }
}) {
  const router = useRouter()

  const [photos, setPhotos] = React.useState(initialPhotos)
  const [uploading, setUploading] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  async function submit() {
    setSubmitting(true)
    setError(null)

    const result = await submitConsultationAction(salonSlug, { consultationId })
    if (!result.ok) {
      setError(result.error)
      setSubmitting(false)
      return
    }
    router.push(`/s/${salonSlug}/my/consult/${consultationId}/review`)
  }

  async function upload(file: File) {
    setUploading(true)
    setError(null)

    try {
      const body = new FormData()
      body.set('salon', salonSlug)
      body.set('consultationId', consultationId)
      body.set('kind', 'inspiration')
      body.set('file', file)

      const response = await fetch('/api/uploads', { method: 'POST', body })
      const payload = (await response.json()) as { inspirationId?: string; error?: string }
      const { inspirationId } = payload

      if (!response.ok || !inspirationId) {
        setError(payload.error ?? 'That would not upload. Please try again.')
        return
      }

      setPhotos((current) => [
        ...current,
        {
          id: inspirationId,
          sourceUrl: null,
          clientNote: null,
          // Shown from the local file until the page is next loaded; the
          // server copy comes back through a signed URL like the rest.
          url: URL.createObjectURL(file),
          attributes: [],
        },
      ])
    } catch {
      setError('That would not upload. Check your connection and try again.')
    } finally {
      setUploading(false)
    }
  }

  async function remove(photoId: string) {
    const previous = photos
    // Optimistic, because the picture disappearing is the whole feedback. If
    // the server disagrees we put it back and say so.
    setPhotos((current) => current.filter((photo) => photo.id !== photoId))
    setError(null)

    const result = await removeInspirationAction(salonSlug, {
      consultationId,
      inspirationPhotoId: photoId,
    })
    if (!result.ok) {
      setPhotos(previous)
      setError(result.error)
    }
  }

  /*
   * Tags are a key→value map rather than a list of keys.
   *
   * Every tag but one is a yes: the client is pointing at a part of the
   * picture. `TARGET_LEVEL` carries the shade they picked, which is what makes
   * the comparison against their own hair possible — so toggling any other tag
   * must not flatten it back to a bare "yes".
   */
  async function setTags(photoId: string, tags: Record<string, string>) {
    const attributes = Object.entries(tags).map(([key, value]) => ({
      key: key as AttributeKey,
      value,
    }))

    setPhotos((photos) =>
      photos.map((photo) =>
        photo.id === photoId
          ? { ...photo, attributes: attributes.map((a) => ({ ...a, source: 'CLIENT' })) }
          : photo,
      ),
    )

    const result = await tagInspirationAction(salonSlug, {
      consultationId,
      inspirationPhotoId: photoId,
      attributes,
    })
    if (!result.ok) setError(result.error)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="label-caps">Last step</p>
        <h1 className="heading-flourish font-display text-display-lg text-ink">
          Show us the look you want
        </h1>
        <p className="max-w-prose text-body text-ink-muted">
          A picture settles it. &ldquo;Golden blonde&rdquo; means three different things to three
          colourists — a photo means one. Add anything you have saved, then tell us what caught your
          eye.
        </p>
      </header>

      {/*
       * The upload is the biggest thing on the screen whether or not anything
       * has been added yet, because the whole point of this change was that
       * clients were not finding it.
       */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="wash-rose group flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-rose-500/40 px-6 py-12 text-center transition-all hover:border-rose-500 hover:shadow-card disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="font-display text-display-sm text-ink">
          {uploading
            ? 'Uploading…'
            : photos.length === 0
              ? 'Add a reference picture'
              : 'Add another picture'}
        </span>
        <span className="max-w-prose text-secondary text-ink-muted">
          A screenshot from your camera roll is perfect. It does not need to be a professional
          photo, and you can add as many as you like.
        </span>
      </button>

      {photos.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {photos.map((photo) => (
            <InspirationCard
              key={photo.id}
              photo={photo}
              current={current}
              onTags={setTags}
              onRemove={remove}
            />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        {/*
         * `back()` rather than a fixed link, because this screen is reached two
         * ways — forward from the photo step, and straight from the client home
         * — and a hardcoded destination is wrong for one of them.
         */}
        <Button variant="ghost" onClick={() => router.back()} disabled={submitting}>
          Back
        </Button>

        {/*
         * Skippable in one tap. A client with nothing saved should not be stuck
         * on the last screen of a consultation they have otherwise finished.
         */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-secondary text-ink-muted">
            {photos.length === 0 ? 'No picture? You can send it without one.' : null}
          </span>
          <Button variant="gold" onClick={submit} disabled={submitting || uploading}>
            {submitting ? 'Working…' : 'See my plan'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function InspirationCard({
  photo,
  current,
  onTags,
  onRemove,
}: {
  photo: InspirationPhotoView
  current: { shadeKey: string | null; level: number | null }
  onTags: (photoId: string, tags: Record<string, string>) => void
  onRemove: (photoId: string) => void
}) {
  const tags: Record<string, string> = Object.fromEntries(
    photo.attributes.map((a) => [a.key, a.value]),
  )
  const selected = new Set(Object.keys(tags) as AttributeKey[])

  const toggle = (key: AttributeKey) => {
    const next = { ...tags }
    if (key in next) delete next[key]
    else next[key] = 'yes'
    onTags(photo.id, next)
  }

  const setLevel = (shadeKey: string) => onTags(photo.id, { ...tags, TARGET_LEVEL: shadeKey })

  const referenceShade = shadeByKey(tags.TARGET_LEVEL)
  const comparison = compareToReference({
    currentShadeKey: current.shadeKey,
    currentLevel: (current.level ?? null) as Level | null,
    referenceShadeKey: tags.TARGET_LEVEL,
  })

  return (
    <article className="overflow-hidden rounded-lg border border-line bg-canvas">
      {photo.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="Inspiration" className="aspect-[4/3] w-full object-cover" />
      )}

      <div className="p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="label-caps">What do you like about it?</p>
          {/*
           * Plain and quiet rather than a destructive-red control. Taking back
           * a picture you did not mean to send is an ordinary correction, not
           * a dangerous one, and nothing here is recoverable-by-undo anyway.
           */}
          <button
            type="button"
            onClick={() => onRemove(photo.id)}
            className="shrink-0 text-label text-blue-500 underline-offset-2 hover:underline"
          >
            Remove
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {ATTRIBUTES.map((attribute) => {
            const isOn = selected.has(attribute.key)
            return (
              <button
                key={attribute.key}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggle(attribute.key)}
                title={'help' in attribute ? attribute.help : undefined}
                className={cn(
                  'rounded-pill border px-3 py-1.5 text-secondary transition-colors',
                  isOn
                    ? 'border-gold-500 bg-gold-100 text-gold-700'
                    : 'border-line bg-canvas text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {attribute.label}
              </button>
            )
          })}
        </div>

        {/*
         * The level tag opens a swatch chart rather than being a plain yes.
         *
         * "I like the level" tells a stylist the client is pointing at depth
         * and nothing about which depth — and depth is the one attribute in
         * this list that can be measured against the hair already on their
         * head. Same chart as the consultation's own colour question, so a
         * client is picking from something they have already used once.
         */}
        {selected.has('TARGET_LEVEL') && (
          <div className="mt-4 rounded-lg border border-line bg-surface p-3">
            <p className="label-caps mb-2">Which level is it, roughly?</p>
            <ShadeStrip selected={referenceShade?.key ?? null} onPick={setLevel} />
          </div>
        )}

        {comparison && (
          <div className="mt-3 rounded-lg border border-line bg-canvas p-3">
            <div className="flex items-center gap-3">
              <Swatch shade={comparison.fromShade} level={comparison.fromLevel} label="You now" />
              <span aria-hidden className="text-ink-subtle">
                →
              </span>
              <Swatch shade={comparison.toShade} level={comparison.toLevel} label="This picture" />
            </div>
            <p className="mt-3 text-secondary text-ink">{comparison.summary}</p>
            {comparison.note && (
              <p
                className={cn(
                  'mt-1 text-secondary',
                  comparison.reach === 'BIG' ? 'text-gold-700' : 'text-ink-muted',
                )}
              >
                {comparison.note}
              </p>
            )}
            {/*
             * Said every time, not only for a big change. How many visits it
             * takes is the rules engine's answer and then the stylist's — a
             * number guessed here would be the one the client remembers.
             */}
            <p className="mt-1 text-secondary text-ink-subtle">
              Your stylist will confirm what it takes when they look at your photos.
            </p>
          </div>
        )}

        {selected.size === 0 && (
          <Badge tone="warn" className="mt-3">
            Not tagged yet
          </Badge>
        )}
      </div>
    </article>
  )
}

/**
 * The whole chart in one scrolling strip, ordered dark to light.
 *
 * Not the full family-then-shade picker from the consultation: the client has
 * already used that once for their own colour, and asking them to navigate two
 * dropdowns again to say roughly how light a saved photo is would be the point
 * they stop tagging. Levelling a reference is approximate by nature.
 */
function ShadeStrip({
  selected,
  onPick,
}: {
  selected: string | null
  onPick: (shadeKey: string) => void
}) {
  const shades = React.useMemo(
    () =>
      TONE_FAMILIES.flatMap((family) => family.shades).sort(
        (a, b) => a.level - b.level || a.name.localeCompare(b.name),
      ),
    [],
  )

  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Level of this reference">
      {shades.map((shade) => (
        <button
          key={shade.key}
          type="button"
          role="radio"
          aria-checked={selected === shade.key}
          aria-label={`${shade.name}, level ${shade.level}`}
          title={`${shade.name} · level ${shade.level}`}
          onClick={() => onPick(shade.key)}
          className={cn(
            'h-8 w-8 rounded-md ring-1 ring-inset ring-ink/10 transition-all',
            selected === shade.key
              ? 'ring-2 ring-gold-500 ring-offset-2 ring-offset-surface'
              : 'hover:-translate-y-0.5',
          )}
          style={{ backgroundColor: shade.hex }}
        />
      ))}
    </div>
  )
}

function Swatch({
  shade,
  level,
  label,
}: {
  shade: { name: string; hex: string } | null
  level: number
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="block h-9 w-9 rounded-md ring-1 ring-inset ring-ink/10"
        // A level with no shade behind it still has to show as something. The
        // outline alone reads as "we know the depth, not the tone".
        style={shade ? { backgroundColor: shade.hex } : undefined}
      />
      <span className="text-label text-ink-muted">
        {label}
        <span className="block text-ink">{shade ? shade.name : `Level ${level}`}</span>
      </span>
    </div>
  )
}
