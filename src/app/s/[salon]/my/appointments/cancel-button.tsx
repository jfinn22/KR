'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cancelBookingAction } from '@/server/actions/booking'

/**
 * Cancelling.
 *
 * Two taps, not a modal: an inline confirm keeps the appointment's details on
 * screen while the client decides, which is exactly when they want to see them.
 * The salon's cancellation policy is the server's business — this asks, the
 * action decides.
 */
export function CancelButton({
  salonSlug,
  appointmentId,
}: {
  salonSlug: string
  appointmentId: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function cancel() {
    setBusy(true)
    setError(null)

    const result = await cancelBookingAction(salonSlug, { appointmentId })
    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }
    setConfirming(false)
    setBusy(false)
    router.refresh()
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Cancel
      </Button>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <p className="text-secondary text-ink-muted">Cancel this appointment?</p>
      <div className="flex gap-2">
        <Button variant="danger-quiet" size="sm" onClick={cancel} disabled={busy}>
          {busy ? 'Cancelling…' : 'Yes, cancel'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
          Keep it
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
