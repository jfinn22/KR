'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { saveClientNotesAction } from '@/server/actions/client'

/**
 * What the salon remembers about a person between visits.
 *
 * Deliberately a free-text box rather than a set of tags. The useful notes here
 * are the ones nobody could have written a field for — that she brings her
 * daughter and needs the extra twenty minutes, that his scalp reacted to the
 * last bleach even though the patch test was clear, that they book the long
 * appointment and always want to leave early.
 *
 * Saved explicitly rather than on a debounce. Autosave is right for a
 * consultation the client is filling in and wrong here: a half-typed thought
 * about somebody's behaviour should not be committed to their permanent record
 * while the stylist is still deciding how to say it.
 */
export function NotesPanel({
  salonSlug,
  clientProfileId,
  initialNotes,
}: {
  salonSlug: string
  clientProfileId: string
  initialNotes: string | null
}) {
  const [notes, setNotes] = React.useState(initialNotes ?? '')
  const [saved, setSaved] = React.useState(initialNotes ?? '')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)

  const dirty = notes !== saved

  async function save() {
    setBusy(true)
    setError(null)
    setStatus(null)

    const result = await saveClientNotesAction(salonSlug, {
      clientProfileId,
      internalNotes: notes.trim().length > 0 ? notes : null,
    })

    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(notes)
    setStatus('Saved')
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        rows={5}
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value)
          setStatus(null)
        }}
        placeholder="Anything the next stylist should know before they start — how appointments have gone, what to avoid, what worked."
        aria-label="Notes about this client"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-label text-ink-subtle">Never shown to the client.</p>

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
