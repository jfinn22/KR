'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { eraseClientAction, exportClientAction } from '@/server/actions/compliance'

/**
 * What a client may ask for about themselves.
 *
 * Both operations were built to a standard — the export walks every table
 * holding this person, the erasure runs in one transaction and scrubs free
 * text as well as records — and neither had a button, which means a salon
 * facing a subject access request had a compliance obligation and a database
 * client. This is the whole feature: it is only real when somebody at a desk
 * can do it.
 *
 * The download is produced in the browser from the returned object rather than
 * a server route, because the data never has to exist at a URL. A generated
 * file behind a link is a copy of somebody's entire record sitting somewhere
 * with its own access-control question to answer.
 */
export function SubjectRights({
  salonSlug,
  clientProfileId,
  clientName,
  canErase,
}: {
  salonSlug: string
  clientProfileId: string
  clientName: string
  canErase: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<'export' | 'erase' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [confirmName, setConfirmName] = React.useState('')

  async function download() {
    setBusy('export')
    setError(null)
    setStatus(null)
    const result = await exportClientAction(salonSlug, { clientProfileId })
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }

    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-record.json`
    link.click()
    URL.revokeObjectURL(url)
    setStatus('Downloaded.')
  }

  async function erase() {
    setBusy('erase')
    setError(null)
    const result = await eraseClientAction(salonSlug, {
      clientProfileId,
      reason: reason.trim(),
      confirmName: confirmName.trim(),
    })
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={download} disabled={busy !== null}>
          {busy === 'export' ? 'Gathering…' : 'Download everything we hold'}
        </Button>
        <span aria-live="polite" className="text-secondary text-ink-muted">
          {status ?? 'Appointments, consultations, formulas, consents and patch tests.'}
        </span>
      </div>

      {canErase && !open && (
        <div>
          <Button variant="ghost" onClick={() => setOpen(true)}>
            Erase this client
          </Button>
        </div>
      )}

      {canErase && open && (
        <div className="flex flex-col gap-4 rounded-lg border border-danger/40 bg-surface-alt p-5">
          {/*
           * What survives is stated before anything is typed. An operator who
           * believes an erasure removes the salon's books will promise the
           * client something this cannot do, and will find out afterwards.
           */}
          <p className="text-body text-ink">
            This cannot be undone. Photographs and free text go; the appointments themselves stay as
            anonymous rows, because a salon still has to account for what it earned.
          </p>

          <Field
            label="Why this was requested"
            htmlFor="erase-reason"
            help="Goes on the record against whoever is signed in."
          >
            <Textarea
              id="erase-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Written request received by email on the 3rd."
            />
          </Field>

          <Field
            label={`Type "${clientName}" to confirm`}
            htmlFor="erase-name"
            help="A click is too cheap for something that cannot be undone."
          >
            <Input
              id="erase-name"
              className="max-w-72"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={erase}
              disabled={
                busy !== null ||
                reason.trim().length < 8 ||
                confirmName.trim().toLowerCase() !== clientName.toLowerCase()
              }
            >
              {busy === 'erase' ? 'Erasing…' : 'Erase permanently'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
