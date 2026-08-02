'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { submitConsultationAction, tagInspirationAction } from '@/server/actions/consultation'

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
  { key: 'ROOT_SHADOW', label: 'The rooty bit' },
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
}: {
  salonSlug: string
  consultationId: string
  initialPhotos: InspirationPhotoView[]
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

  async function setTags(photoId: string, keys: AttributeKey[]) {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === photoId
          ? {
              ...photo,
              attributes: keys.map((key) => ({ key, value: 'yes', source: 'CLIENT' })),
            }
          : photo,
      ),
    )

    const result = await tagInspirationAction(salonSlug, {
      consultationId,
      inspirationPhotoId: photoId,
      attributes: keys.map((key) => ({ key, value: 'yes' })),
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
            <InspirationCard key={photo.id} photo={photo} onTags={setTags} />
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
         * Skippable in one tap. A client with nothing saved should not be stuck
         * on the last screen of a consultation they have otherwise finished.
         */}
        <span className="text-secondary text-ink-muted">
          {photos.length === 0 ? 'No picture? You can send it without one.' : null}
        </span>
        <Button variant="gold" onClick={submit} disabled={submitting || uploading}>
          {submitting ? 'Working…' : 'See my plan'}
        </Button>
      </div>
    </div>
  )
}

function InspirationCard({
  photo,
  onTags,
}: {
  photo: InspirationPhotoView
  onTags: (photoId: string, keys: AttributeKey[]) => void
}) {
  const selected = new Set(photo.attributes.map((a) => a.key as AttributeKey))

  const toggle = (key: AttributeKey) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onTags(photo.id, [...next])
  }

  return (
    <article className="overflow-hidden rounded-lg border border-line bg-canvas">
      {photo.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.url} alt="Inspiration" className="aspect-[4/3] w-full object-cover" />
      )}

      <div className="p-4">
        <p className="label-caps mb-3">What do you like about it?</p>

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

        {selected.size === 0 && (
          <Badge tone="warn" className="mt-3">
            Not tagged yet
          </Badge>
        )}
      </div>
    </article>
  )
}
