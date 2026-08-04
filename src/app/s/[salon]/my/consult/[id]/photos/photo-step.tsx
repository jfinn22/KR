'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PhotoCaptureGrid,
  photoProgress,
  type CapturedPhoto,
  type PhotoView,
} from '@/components/salon/photo-capture-grid'
import { Button } from '@/components/ui/button'
import { ProgressRail } from '@/components/ui/feedback'
import { removePhotoAction } from '@/server/actions/consultation'

/**
 * The photo step.
 *
 * Uploads go through the API route rather than a server action — several
 * megabytes of JPEG serialised through an action payload is slow enough that a
 * client on a phone assumes it has failed and taps again.
 *
 * A missing photo warns rather than blocks. The rules engine already treats an
 * incomplete set as a DATA_QUALITY caution and says so in the estimate, which
 * is a better outcome than a client who gives up at the upload screen.
 *
 * This step is about the hair they have. The step after it is about the hair
 * they want, which is a separate screen because they are separate questions and
 * clients answer them with different pictures.
 */
export function PhotoStep({
  salonSlug,
  consultationId,
  requiredViews,
  suggestedViews,
  initialPhotos,
}: {
  salonSlug: string
  consultationId: string
  requiredViews: readonly string[]
  suggestedViews: readonly string[]
  initialPhotos: CapturedPhoto[]
}) {
  const router = useRouter()

  const [photos, setPhotos] = React.useState<CapturedPhoto[]>(initialPhotos)
  const [busyView, setBusyView] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const progress = photoProgress(requiredViews, photos)

  async function upload(view: PhotoView, file: File) {
    setBusyView(view)
    setError(null)

    try {
      const body = new FormData()
      body.set('salon', salonSlug)
      body.set('consultationId', consultationId)
      body.set('view', view)
      body.set('file', file)

      const response = await fetch('/api/uploads', { method: 'POST', body })
      const payload = (await response.json()) as { photoId?: string; url?: string; error?: string }
      const { photoId, url } = payload

      if (!response.ok || !photoId || !url) {
        setError(payload.error ?? 'That photo would not upload. Please try again.')
        return
      }

      setPhotos((current) => [
        ...current.filter((photo) => photo.view !== view),
        { id: photoId, view, url, qualityScore: null, qualityIssues: [] },
      ])
    } catch {
      setError('That photo would not upload. Check your connection and try again.')
    } finally {
      setBusyView(null)
    }
  }

  async function remove(photoId: string) {
    const previous = photos
    setPhotos((current) => current.filter((photo) => photo.id !== photoId))
    setError(null)

    const result = await removePhotoAction(salonSlug, {
      consultationId,
      consultationPhotoId: photoId,
    })
    if (!result.ok) {
      setPhotos(previous)
      setError(result.error)
    }
  }

  function goToReferences() {
    setSubmitting(true)
    router.push(`/s/${salonSlug}/my/consult/${consultationId}/inspiration`)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="label-caps">Photos</p>
          <p className="tabular text-label text-ink-subtle">
            {progress.done} of {progress.total}
          </p>
        </div>

        <ProgressRail value={progress.total === 0 ? 100 : (progress.done / progress.total) * 100} />

        <div>
          <h1 className="font-display text-display-lg text-ink">Show us your hair</h1>
          <p className="mt-2 max-w-prose text-body text-ink-muted">
            Daylight if you can, no filter, hair down and dry. This is what turns a rough guess into
            a real quote — and it takes about a minute.
          </p>
        </div>
      </header>

      <PhotoCaptureGrid
        requiredViews={requiredViews}
        suggestedViews={suggestedViews}
        photos={photos}
        onCapture={upload}
        onRemove={remove}
        busyView={busyView}
        disabled={submitting}
      />

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-5 border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button variant="ghost" asChild>
            <Link href={`/s/${salonSlug}/my/consult/${consultationId}`}>Back to questions</Link>
          </Button>

          <div className="flex items-center gap-4">
            {progress.missing.length > 0 && (
              <span className="text-label text-warn">
                {progress.missing.length} still to add — you can carry on anyway
              </span>
            )}
            <Button onClick={goToReferences} disabled={submitting}>
              {submitting ? 'Working…' : 'Next: the look you want'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
