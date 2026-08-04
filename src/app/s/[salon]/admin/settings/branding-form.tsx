'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { deriveAccentLadder } from '@/domain/branding/contrast'
import { saveAccentAction } from '@/server/actions/settings'

/**
 * Pick a colour, see the whole ladder, save it.
 *
 * The preview is derived in the browser using the same pure function the
 * server validates with, so an owner sees the refusal — and the reason for it —
 * while they are still choosing, rather than after pressing save. A colour that
 * cannot carry white text is rejected here in words, not corrected silently
 * into something they did not pick.
 */

const RUNGS = [900, 700, 500, 300, 100, 50] as const

export function BrandingForm({
  salonSlug,
  initialAccent,
  available,
}: {
  salonSlug: string
  initialAccent: string | null
  available: boolean
}) {
  const router = useRouter()
  const [hex, setHex] = React.useState(initialAccent ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)

  const trimmed = hex.trim()
  const preview = trimmed.length > 0 ? deriveAccentLadder(trimmed) : null
  const dirty = trimmed !== (initialAccent ?? '')

  if (!available) {
    return (
      <div className="wash-gold flex max-w-prose flex-col gap-2 rounded-lg p-5">
        <Badge tone="gold">Salon plan</Badge>
        <p className="text-body text-ink">
          Your own colour and logo across the whole client experience are part of the Salon plan.
        </p>
      </div>
    )
  }

  async function save() {
    setBusy(true)
    setError(null)
    setStatus(null)

    const result = await saveAccentAction(salonSlug, {
      accentHex: trimmed.length > 0 ? trimmed : null,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setStatus(trimmed.length > 0 ? 'Saved' : 'Cleared')
    router.refresh()
  }

  return (
    <div className="flex max-w-prose flex-col gap-5">
      <Field
        label="Your colour"
        htmlFor="accentHex"
        help="A hex value, like #2E73B5. We work out the lighter and darker shades from it and check every one for readability."
      >
        <div className="flex items-center gap-3">
          <Input
            id="accentHex"
            value={hex}
            placeholder="#2E73B5"
            spellCheck={false}
            onChange={(e) => {
              setHex(e.target.value)
              setStatus(null)
              setError(null)
            }}
          />
          {/* A native picker alongside the field, for anyone who has a colour
              rather than a hex code. */}
          <input
            type="color"
            aria-label="Pick a colour"
            value={preview?.ok ? preview.ladder[500] : '#2E73B5'}
            onChange={(e) => {
              setHex(e.target.value.toUpperCase())
              setStatus(null)
              setError(null)
            }}
            className="size-11 shrink-0 cursor-pointer rounded-lg border border-line bg-canvas p-1"
          />
        </div>
      </Field>

      {preview && !preview.ok && (
        <p role="alert" className="text-secondary text-danger">
          {preview.reason}
        </p>
      )}

      {preview?.ok && (
        <div>
          <p className="label-caps mb-2">What we would use</p>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {RUNGS.map((rung) => (
              <div key={rung} className="flex-1">
                <div className="h-12" style={{ background: preview.ladder[rung] }} />
                <p className="tabular px-1 py-1 text-center text-label text-ink-subtle">{rung}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-secondary text-ink-muted">
            Every shade here is checked against the same contrast standard the rest of the product
            holds to, so buttons and links stay readable whatever you pick.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty || (preview !== null && !preview.ok)}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {initialAccent && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setHex('')
              setStatus(null)
              setError(null)
            }}
          >
            Use the default
          </Button>
        )}
        <span aria-live="polite" className="text-label text-ink-subtle">
          {error ? null : status}
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
