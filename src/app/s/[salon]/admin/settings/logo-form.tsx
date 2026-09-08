'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

/**
 * The salon's own mark, on every page a client sees before they have an
 * account.
 *
 * `saveLogoKey` was written with the white-label work and nothing called it, so
 * this was a half-shipped feature of the worst kind: the settings screen said
 * "your colour and your logo", the join page already rendered `logoUrl`, and
 * the only half that worked was the colour.
 *
 * Uploaded through a route rather than a server action, because actions
 * serialise their payload and an image does not want to go that way.
 */
export function LogoForm({
  salonSlug,
  logoUrl,
  available,
}: {
  salonSlug: string
  logoUrl: string | null
  available: boolean
}) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (!available) return null

  async function upload(file: File) {
    setBusy(true)
    setError(null)

    const body = new FormData()
    body.set('salon', salonSlug)
    body.set('file', file)

    try {
      const response = await fetch('/api/uploads/logo', { method: 'POST', body })
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error ?? 'That did not upload.')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not upload.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/uploads/logo?salon=${encodeURIComponent(salonSlug)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('That did not work.')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-4 border-t border-line pt-8">
      <p className="label-caps">Your logo</p>

      {logoUrl && (
        /*
         * On the salon's own background rather than a chequerboard: what
         * matters is whether it reads on the surface a client will actually see
         * it against, and a transparent PNG that looks fine on white and
         * vanishes on the wash is exactly the mistake worth catching here.
         */
        <div className="flex w-fit items-center rounded-lg border border-line bg-surface px-6 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="Your logo" className="max-h-12 w-auto" />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Uploading…' : logoUrl ? 'Replace it' : 'Upload a logo'}
        </Button>
        {logoUrl && (
          <Button variant="ghost" disabled={busy} onClick={remove}>
            Take it off
          </Button>
        )}
        <span className="text-label text-ink-subtle">
          PNG, JPEG, WebP or SVG, under 2MB. Shown on the signup and check-in pages.
        </span>
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
