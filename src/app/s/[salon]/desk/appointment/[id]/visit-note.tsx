'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { saveAppointmentNoteAction } from '@/server/actions/client'

/**
 * What happened at this visit, as opposed to what is true of this person.
 *
 * The screen already displayed `Appointment.internalNote` and nothing could
 * ever write one, so the distinction the schema draws — a one-off against a
 * standing fact — collapsed in practice: the only box a stylist could reach
 * was the client's permanent record, so "the bleach lifted unevenly today"
 * got filed as though it were "her hair lifts unevenly".
 *
 * Saved on a button rather than a debounce, for the same reason as the client
 * note: a half-typed thought about how an appointment went should not be
 * committed while the stylist is still deciding how to put it.
 */
export function VisitNote({
  salonSlug,
  appointmentId,
  initialNote,
}: {
  salonSlug: string
  appointmentId: string
  initialNote: string | null
}) {
  const [note, setNote] = React.useState(initialNote ?? '')
  const [saved, setSaved] = React.useState(initialNote ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)

  const dirty = note !== saved

  async function save() {
    setBusy(true)
    setError(null)
    setStatus(null)

    const result = await saveAppointmentNoteAction(salonSlug, {
      appointmentId,
      internalNote: note.trim().length > 0 ? note.trim() : null,
    })

    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(note)
    setStatus('Saved')
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        rows={4}
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          setStatus(null)
        }}
        placeholder="What happened today — ran over, the lift was uneven, they changed their mind about the length."
        aria-label="Note about this visit"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-label text-ink-subtle">
          About this appointment, not about this client. Never shown to them.
        </p>

        <div className="flex items-center gap-3">
          <span aria-live="polite" className="text-label text-ink-subtle">
            {error ? null : status}
          </span>
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
