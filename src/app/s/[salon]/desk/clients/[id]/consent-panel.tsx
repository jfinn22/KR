'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import {
  setConsentAction,
  recordPatchTestAction,
  readPatchTestAction,
} from '@/server/actions/compliance'

/**
 * Consent and patch tests, as the desk manages them.
 *
 * The wording is deliberately about the client rather than about the schema:
 * "may we photograph your hair" is a question somebody can answer, and
 * PHOTO_RELEASE is not. Every toggle writes a dated grant or revocation, so a
 * salon can always show when permission started and when it stopped.
 */

const CONSENTS = [
  { kind: 'PHOTO_RELEASE' as const, label: 'Photos of their hair', help: 'Kept on their record' },
  {
    kind: 'MARKETING_USE' as const,
    label: 'Photos used publicly',
    help: 'Social, website, window',
  },
  {
    kind: 'AI_PHOTO_ANALYSIS' as const,
    label: 'AI may look at photos',
    help: 'For assessment only',
  },
  { kind: 'SMS' as const, label: 'Text messages' },
  { kind: 'EMAIL' as const, label: 'Emails' },
]

export interface ConsentPanelProps {
  salonSlug: string
  clientProfileId: string
  granted: string[]
  patchTests: {
    id: string
    appliedAt: string
    result: string
    validUntil: string
    isCurrent: boolean
  }[]
}

export function ConsentPanel({
  salonSlug,
  clientProfileId,
  granted,
  patchTests,
}: ConsentPanelProps) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const on = new Set(granted)

  async function toggle(kind: (typeof CONSENTS)[number]['kind']) {
    setBusy(kind)
    setError(null)

    const result = await setConsentAction(salonSlug, {
      clientProfileId,
      kind,
      granted: !on.has(kind),
    })

    if (!result.ok) setError(result.error)
    setBusy(null)
    router.refresh()
  }

  const current = patchTests.find((test) => test.isCurrent)
  const pending = patchTests.find((test) => test.result === 'PENDING')

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h3 className="font-display text-display-sm text-ink">What they have agreed to</h3>
        <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
          {CONSENTS.map((consent) => (
            <li key={consent.kind} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-secondary text-ink">{consent.label}</p>
                {consent.help && <p className="text-label text-ink-subtle">{consent.help}</p>}
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={on.has(consent.kind)}
                aria-label={consent.label}
                disabled={busy !== null}
                onClick={() => toggle(consent.kind)}
                className={cn(
                  'h-8 w-14 shrink-0 rounded-pill border transition-colors',
                  on.has(consent.kind)
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-line-strong bg-surface-alt',
                  busy === consent.kind && 'opacity-50',
                )}
              >
                <span
                  className={cn(
                    'block h-6 w-6 rounded-full bg-canvas transition-transform',
                    on.has(consent.kind) ? 'translate-x-7' : 'translate-x-1',
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display text-display-sm text-ink">Patch test</h3>
          {current ? (
            <Badge tone="success">Valid until {current.validUntil.slice(0, 10)}</Badge>
          ) : pending ? (
            <Badge tone="warn">Applied, waiting to be read</Badge>
          ) : (
            <Badge tone="neutral">None on file</Badge>
          )}
        </div>

        <p className="mt-2 max-w-prose text-secondary text-ink-muted">
          A test has to sit for 48 hours before it can be read as clear. An expired one counts as no
          test at all.
        </p>

        <div className="mt-4">
          {pending ? (
            <ReadPatchTest
              salonSlug={salonSlug}
              clientProfileId={clientProfileId}
              patchTestId={pending.id}
              appliedAt={pending.appliedAt}
            />
          ) : (
            <RecordPatchTest salonSlug={salonSlug} clientProfileId={clientProfileId} />
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function RecordPatchTest({
  salonSlug,
  clientProfileId,
}: {
  salonSlug: string
  clientProfileId: string
}) {
  const router = useRouter()
  const [brand, setBrand] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function record() {
    setBusy(true)
    setError(null)

    const result = await recordPatchTestAction(salonSlug, {
      clientProfileId,
      productBrand: brand.trim() || null,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Product" htmlFor="brand" className="min-w-56 flex-1">
        <Input
          id="brand"
          value={brand}
          placeholder="Which colour line"
          onChange={(e) => setBrand(e.target.value)}
        />
      </Field>
      <Button onClick={record} disabled={busy}>
        {busy ? 'Recording…' : 'Applied just now'}
      </Button>
      {error && (
        <p role="alert" className="w-full text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function ReadPatchTest({
  salonSlug,
  clientProfileId,
  patchTestId,
  appliedAt,
}: {
  salonSlug: string
  clientProfileId: string
  patchTestId: string
  appliedAt: string
}) {
  const router = useRouter()
  const [notes, setNotes] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const hours = (Date.now() - new Date(appliedAt).getTime()) / 3_600_000
  const readable = hours >= 48

  async function read(result: 'NEGATIVE' | 'POSITIVE' | 'INCONCLUSIVE') {
    setBusy(true)
    setError(null)

    const response = await readPatchTestAction(salonSlug, {
      patchTestId,
      clientProfileId,
      result,
      notes: notes.trim() || null,
    })

    if (!response.ok) {
      setError(response.error)
      setBusy(false)
      return
    }
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-secondary text-ink-muted">
        Applied {Math.floor(hours)} hours ago.
        {!readable && ' Cannot be read as clear yet.'}
      </p>

      <Textarea
        rows={2}
        value={notes}
        placeholder="Anything observed"
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !readable} onClick={() => read('NEGATIVE')}>
          All clear
        </Button>
        <Button variant="danger-quiet" size="sm" disabled={busy} onClick={() => read('POSITIVE')}>
          Reacted
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => read('INCONCLUSIVE')}>
          Inconclusive
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
