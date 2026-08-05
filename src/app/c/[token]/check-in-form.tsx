'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { respondToCheckInAction } from '@/server/actions/check-in'

/**
 * Three buttons and a box nobody has to fill in.
 *
 * The ceiling on how much a client will type on a phone three days after a
 * haircut is very low, so the answer has to be one tap. "Not right" on its own
 * is already the whole signal a salon needs to pick up the phone; the box is
 * for the ones who want to say why, and asking for a paragraph gets nothing.
 *
 * The tap is what mutates, never the page load. Link previewers, email security
 * scanners and message-app unfurlers all fetch any URL they see, and a check-in
 * that answered itself on GET would be filled in by a robot before the client
 * ever looked at it.
 */
const CHOICES = [
  { value: 'DELIGHTED' as const, label: 'Love it', tone: 'primary' as const },
  { value: 'FINE' as const, label: "It's fine", tone: 'secondary' as const },
  { value: 'NOT_RIGHT' as const, label: 'Not quite right', tone: 'secondary' as const },
]

export function CheckInForm({ salonSlug, token }: { salonSlug: string; token: string }) {
  const [chosen, setChosen] = React.useState<(typeof CHOICES)[number]['value'] | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  async function send(sentiment: (typeof CHOICES)[number]['value'], withNote: string) {
    setBusy(true)
    setError(null)

    const result = await respondToCheckInAction(salonSlug, {
      token,
      sentiment,
      note: withNote.trim() === '' ? null : withNote.trim(),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="rounded-lg border border-line bg-surface px-6 py-8 text-center">
        <p className="font-display text-display-sm text-ink">Thank you.</p>
        <p className="mt-2 text-body text-ink-muted">
          {chosen === 'NOT_RIGHT'
            ? 'Somebody will be in touch. Nothing about this is too late to put right.'
            : 'That is genuinely useful to know.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        {CHOICES.map((choice) => (
          <Button
            key={choice.value}
            variant={chosen === choice.value ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => {
              setChosen(choice.value)
              /*
               * Anything but "not right" is finished in one tap. Somebody happy
               * with their hair has already told you everything you needed; the
               * follow-up box is for the case where there is something to fix.
               */
              if (choice.value !== 'NOT_RIGHT') void send(choice.value, '')
            }}
          >
            {choice.label}
          </Button>
        ))}
      </div>

      {chosen === 'NOT_RIGHT' && (
        <div className="flex flex-col gap-4">
          <label className="text-body text-ink" htmlFor="check-in-note">
            What is not right? One line is plenty.
          </label>
          <Textarea
            id="check-in-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="It has gone brassier than I expected."
          />
          <div>
            <Button disabled={busy} onClick={() => void send('NOT_RIGHT', note)}>
              {busy ? 'Sending…' : 'Tell them'}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-secondary text-danger">{error}</p>}
    </div>
  )
}
