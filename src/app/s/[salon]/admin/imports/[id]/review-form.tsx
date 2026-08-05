'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/field'
import { commitImportAction, undoImportAction } from '@/server/actions/migration'
import type { NameMatch } from '@/server/services/migration/review'

/**
 * The decisions, and then the button.
 *
 * One row per distinct name rather than one per file row: a salon with four
 * thousand appointments has fourteen services, and asking about the service on
 * every line is how an owner abandons a migration at 3pm on a Tuesday. Anything
 * we could match by name is pre-selected and can be overruled.
 *
 * The date question is separate and above everything else, because it is the
 * only one where a wrong answer is silent — a mismapped service is visible the
 * moment somebody opens a client, and a year of history in the wrong months is
 * not visible at all until somebody goes looking for their own birthday.
 */
export function ReviewForm({
  salonSlug,
  batchId,
  dateOrderAmbiguous,
  initialDateOrder,
  initialCallingCode,
  services,
  stylists,
  salonServices,
  salonStylists,
  blockers,
}: {
  salonSlug: string
  batchId: string
  dateOrderAmbiguous: boolean
  initialDateOrder: 'DMY' | 'MDY' | 'ISO'
  initialCallingCode: string
  services: NameMatch[]
  stylists: NameMatch[]
  salonServices: { id: string; name: string }[]
  salonStylists: { id: string; displayName: string }[]
  blockers: string[]
}) {
  const router = useRouter()
  const [order, setOrder] = React.useState(initialDateOrder)
  const [callingCode, setCallingCode] = React.useState(initialCallingCode)
  const [serviceMap, setServiceMap] = React.useState(() => initialMap(services))
  const [stylistMap, setStylistMap] = React.useState(() => initialMap(stylists))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  /*
   * A stylist we cannot name means an appointment that does not get written at
   * all — `primaryStylistId` is required, and inventing it puts somebody else's
   * clients into a stylist's own figures. Worth saying before they press it,
   * not after.
   */
  const unassigned = stylists.filter((match) => !stylistMap[match.name])
  const lostRows = unassigned.reduce((total, match) => total + match.rows, 0)

  async function commit() {
    setBusy(true)
    setError(null)

    const result = await commitImportAction(salonSlug, {
      batchId,
      dateOrder: order,
      defaultCallingCode: callingCode.trim() === '' ? null : callingCode.trim(),
      serviceMap,
      stylistMap,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  if (blockers.length > 0 && !dateOrderAmbiguous) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-soft px-5 py-4">
        <p className="text-secondary text-danger">
          This file cannot be imported as it is. Fix it and upload it again.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <section className="flex max-w-xl flex-col gap-5">
        <Field
          label="Which way round are the dates?"
          help={
            dateOrderAmbiguous
              ? 'Nothing in this file settles it, so we have to ask. Getting it wrong moves your whole history by up to eleven months.'
              : 'We worked this out from the file itself. Change it if it looks wrong.'
          }
        >
          <Select value={order} onChange={(e) => setOrder(e.target.value as typeof order)}>
            <option value="DMY">Day first — 03/04/2024 is the 3rd of April</option>
            <option value="MDY">Month first — 03/04/2024 is the 4th of March</option>
            <option value="ISO">Year first — 2024-04-03</option>
          </Select>
        </Field>

        <Field
          label="Your country's dialling code"
          help="For turning numbers like 07700 900123 into something we can text. Digits only — 44, 1, 353."
        >
          <input
            value={callingCode}
            onChange={(e) => setCallingCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            className="w-32 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
      </section>

      <MapSection
        title="What their services are called here"
        description="One decision each, not one per appointment. Anything left unmapped still imports as history — it just will not be tied to one of your services."
        matches={services}
        value={serviceMap}
        onChange={setServiceMap}
        options={salonServices.map((service) => ({ id: service.id, label: service.name }))}
        unmappedLabel="Leave unmapped"
      />

      <MapSection
        title="Who did the work"
        description="An appointment we cannot attribute is not imported at all, because guessing puts somebody else's clients into a stylist's own numbers."
        matches={stylists}
        value={stylistMap}
        onChange={setStylistMap}
        options={salonStylists.map((stylist) => ({ id: stylist.id, label: stylist.displayName }))}
        unmappedLabel="Skip these appointments"
      />

      {lostRows > 0 && (
        <p className="text-secondary text-warn">
          {lostRows} appointment{lostRows === 1 ? '' : 's'} will not be imported because{' '}
          {unassigned.length === 1 ? 'one name is' : `${unassigned.length} names are`} not matched to
          anybody. The clients on those rows still come across.
        </p>
      )}

      {error && <p className="text-secondary text-danger">{error}</p>}

      <div className="flex items-center gap-4">
        <Button onClick={commit} disabled={busy}>
          {busy ? 'Importing…' : 'Import this file'}
        </Button>
        <p className="text-secondary text-ink-muted">You can undo the whole thing afterwards.</p>
      </div>
    </div>
  )
}

/** After the fact: what it did, and the way back out. */
export function UndoPanel({
  salonSlug,
  batchId,
  undone,
}: {
  salonSlug: string
  batchId: string
  undone: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [kept, setKept] = React.useState<{ name: string; reason: string }[] | null>(null)

  if (undone) {
    return (
      <p className="text-secondary text-ink-muted">
        This import has been undone. The record of it stays here; what it created does not.
      </p>
    )
  }

  async function undo() {
    setBusy(true)
    setError(null)
    const result = await undoImportAction(salonSlug, { batchId })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setKept(result.data.clientsKept.map((client) => ({ name: client.name, reason: client.reason })))
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Button variant="secondary" onClick={undo} disabled={busy}>
          {busy ? 'Undoing…' : 'Undo this import'}
        </Button>
        <p className="text-secondary text-ink-muted">
          Removes everything it created. Anyone who has booked or signed in since is kept.
        </p>
      </div>

      {error && <p className="text-secondary text-danger">{error}</p>}

      {kept && kept.length > 0 && (
        <div className="rounded-lg border border-line bg-surface-alt px-5 py-4">
          <p className="text-secondary text-ink">These clients were kept:</p>
          <ul className="mt-2 flex flex-col gap-1">
            {kept.map((client) => (
              <li key={client.name} className="text-secondary text-ink-muted">
                <span className="text-ink">{client.name}</span> — {client.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MapSection({
  title,
  description,
  matches,
  value,
  onChange,
  options,
  unmappedLabel,
}: {
  title: string
  description: string
  matches: NameMatch[]
  value: Record<string, string | null>
  onChange: (next: Record<string, string | null>) => void
  options: { id: string; label: string }[]
  unmappedLabel: string
}) {
  if (matches.length === 0) return null

  return (
    <section>
      <h2 className="font-display text-display-sm text-ink">{title}</h2>
      <p className="mt-1 max-w-prose text-secondary text-ink-muted">{description}</p>
      <ul className="mt-5 flex flex-col gap-3">
        {matches.map((match) => (
          <li key={match.name} className="flex flex-wrap items-center gap-4">
            <span className="min-w-48 text-body text-ink">
              {match.name}
              <span className="ml-2 text-secondary text-ink-muted">
                {match.rows} row{match.rows === 1 ? '' : 's'}
              </span>
            </span>
            <Select
              aria-label={`What ${match.name} maps to`}
              value={value[match.name] ?? ''}
              onChange={(e) => onChange({ ...value, [match.name]: e.target.value || null })}
              className="max-w-xs"
            >
              <option value="">{unmappedLabel}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </section>
  )
}

function initialMap(matches: NameMatch[]): Record<string, string | null> {
  return Object.fromEntries(matches.map((match) => [match.name, match.suggestedId]))
}
