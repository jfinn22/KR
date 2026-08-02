'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/**
 * Guided photo capture.
 *
 * One tile per view, each with a silhouette showing what the shot should look
 * like. Clients do not know what "mids" means; they do recognise a picture of
 * the back of a head with the middle highlighted.
 *
 * Required and suggested tiles are visually distinct but equally easy to use —
 * a suggested photo the client happens to take is free information, and making
 * it feel optional is what stops the whole set feeling like a form.
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

const VIEW_COPY: Record<PhotoView, { label: string; hint: string }> = {
  FRONT: { label: 'Front', hint: 'Facing the camera, hair down' },
  BACK: { label: 'Back', hint: 'Back of the head, hair down' },
  LEFT: { label: 'Left side', hint: 'Turn to your right so we see your left' },
  RIGHT: { label: 'Right side', hint: 'Turn the other way' },
  ROOTS: { label: 'Roots', hint: 'Close up at the parting' },
  MIDS: { label: 'Mid-lengths', hint: 'A section held out from the head' },
  ENDS: { label: 'Ends', hint: 'The last few inches, close up' },
  TEXTURE: { label: 'Texture', hint: 'Air-dried, no styling' },
  WET: { label: 'Wet', hint: 'Straight out of the shower' },
  SCALP: { label: 'Scalp', hint: 'Part the hair and get close' },
  PART: { label: 'Parting', hint: 'Your natural parting, from above' },
  OTHER: { label: 'Anything else', hint: 'Whatever you want us to see' },
}

export interface CapturedPhoto {
  id: string
  view: string
  url: string
  qualityScore: number | null
  qualityIssues: string[]
}

export interface PhotoCaptureGridProps {
  requiredViews: readonly string[]
  suggestedViews?: readonly string[]
  photos: readonly CapturedPhoto[]
  onCapture: (view: PhotoView, file: File) => Promise<void> | void
  onRemove?: (photoId: string) => Promise<void> | void
  busyView?: string | null
  disabled?: boolean
}

export function PhotoCaptureGrid({
  requiredViews,
  suggestedViews = [],
  photos,
  onCapture,
  onRemove,
  busyView,
  disabled,
}: PhotoCaptureGridProps) {
  const byView = new Map(photos.map((p) => [p.view, p]))
  const tiles = [
    ...requiredViews.map((view) => ({ view, required: true })),
    ...suggestedViews.map((view) => ({ view, required: false })),
  ]

  if (tiles.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface p-5 text-secondary text-ink-muted">
        No photos needed for this service — we will see everything we need in the chair.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map(({ view, required }) => (
        <PhotoTile
          key={view}
          view={view as PhotoView}
          required={required}
          photo={byView.get(view)}
          busy={busyView === view}
          disabled={disabled}
          onCapture={onCapture}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

function PhotoTile({
  view,
  required,
  photo,
  busy,
  disabled,
  onCapture,
  onRemove,
}: {
  view: PhotoView
  required: boolean
  photo?: CapturedPhoto
  busy?: boolean
  disabled?: boolean
  onCapture: (view: PhotoView, file: File) => Promise<void> | void
  onRemove?: (photoId: string) => Promise<void> | void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const copy = VIEW_COPY[view] ?? { label: view, hint: '' }
  const poor =
    photo?.qualityScore !== null && photo?.qualityScore !== undefined && photo.qualityScore < 0.4

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-lg border bg-canvas transition-colors',
        photo ? 'border-line' : 'border-dashed border-line-strong',
        poor && 'border-warn',
      )}
    >
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'group relative flex aspect-[3/4] w-full items-center justify-center bg-surface transition-colors',
          !photo && 'hover:bg-surface-alt',
          (disabled || busy) && 'pointer-events-none opacity-60',
        )}
        aria-label={
          photo
            ? `Replace the ${copy.label.toLowerCase()} photo`
            : `Add a ${copy.label.toLowerCase()} photo`
        }
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={`${copy.label} view`} className="h-full w-full object-cover" />
        ) : (
          <Silhouette view={view} />
        )}

        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-canvas/70 text-secondary text-ink-muted">
            Uploading…
          </span>
        )}

        {photo && !busy && (
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-ink shadow-card">
            <CheckIcon />
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-secondary font-medium text-ink">{copy.label}</span>
          {!required && !photo && <Badge tone="outline">Optional</Badge>}
        </div>

        {poor ? (
          <p className="text-label text-warn">Too small or blurry to read — try another?</p>
        ) : (
          <p className="text-label text-ink-subtle">{copy.hint}</p>
        )}

        {photo && onRemove && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(photo.id)}
            className="mt-auto self-start text-label text-blue-500 underline-offset-2 hover:underline"
          >
            Remove
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Opens the camera directly on a phone rather than the photo library.
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset first, so re-picking the same file still fires a change.
          e.target.value = ''
          if (file) void onCapture(view, file)
        }}
      />
    </div>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * A head outline with the relevant region picked out in gold.
 *
 * Inline SVG rather than illustrations: it stays crisp, it costs no request,
 * and the highlighted region is what actually communicates the instruction.
 */
function Silhouette({ view }: { view: PhotoView }) {
  const region: Partial<Record<PhotoView, React.ReactNode>> = {
    ROOTS: <rect x="26" y="20" width="28" height="12" rx="4" className="fill-gold-500/50" />,
    PART: <rect x="38" y="16" width="4" height="26" rx="2" className="fill-gold-500/60" />,
    SCALP: <rect x="28" y="18" width="24" height="14" rx="6" className="fill-gold-500/50" />,
    MIDS: <rect x="22" y="44" width="36" height="14" rx="6" className="fill-gold-500/50" />,
    ENDS: <rect x="24" y="62" width="32" height="12" rx="6" className="fill-gold-500/50" />,
  }

  return (
    <svg viewBox="0 0 80 96" className="h-3/5 w-auto" aria-hidden="true">
      {/* Hair mass */}
      <path
        d="M40 8c-14 0-22 10-22 24 0 10-2 16-4 26-2 9 4 14 10 15 5 1 10 1 16 1s11 0 16-1c6-1 12-6 10-15-2-10-4-16-4-26 0-14-8-24-22-24z"
        className="fill-line"
      />
      {/* Face */}
      <ellipse cx="40" cy="38" rx="12" ry="15" className="fill-surface-alt" />
      {region[view]}
      <path
        d={
          view === 'LEFT'
            ? 'M20 40c-4 0-6 3-6 6'
            : view === 'RIGHT'
              ? 'M60 40c4 0 6 3 6 6'
              : 'M34 44h12'
        }
        className="stroke-line-strong"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

/** How far through the required set the client is. */
export function photoProgress(
  requiredViews: readonly string[],
  photos: readonly { view: string }[],
): { done: number; total: number; missing: string[] } {
  const have = new Set(photos.map((p) => p.view))
  const missing = requiredViews.filter((view) => !have.has(view))
  return { done: requiredViews.length - missing.length, total: requiredViews.length, missing }
}
