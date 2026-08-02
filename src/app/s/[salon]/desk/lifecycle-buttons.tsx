'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  checkInAction,
  checkOutAction,
  endChairAction,
  markNoShowAction,
  markProcessingAction,
  startChairAction,
} from '@/server/actions/appointment'

/**
 * The day-of buttons.
 *
 * One primary action per state, because whoever is tapping this is standing up
 * with a client in front of them. Showing all five at once and letting the
 * server refuse four of them is technically correct and useless in practice.
 *
 * No-show is deliberately behind a confirm and never adjacent to check-in: it
 * increments the client's no-show count, which the rules engine reads when
 * deciding their deposit, so a mis-tap costs a real person real money.
 */
export function LifecycleButtons({
  salonSlug,
  appointmentId,
  status,
  needsPayment,
}: {
  salonSlug: string
  appointmentId: string
  status: string
  needsPayment?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [confirmingNoShow, setConfirmingNoShow] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)

    const result = await fn()
    if (!result.ok) {
      setError(result.error ?? 'That did not work.')
      setBusy(false)
      return
    }

    setConfirmingNoShow(false)
    setBusy(false)
    router.refresh()
  }

  if (confirmingNoShow) {
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="text-secondary text-ink-muted">Mark as a no-show?</p>
        <div className="flex gap-2">
          <Button
            variant="danger-quiet"
            size="sm"
            disabled={busy}
            onClick={() => run(() => markNoShowAction(salonSlug, { appointmentId }))}
          >
            {busy ? 'Saving…' : 'Yes, no-show'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmingNoShow(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap gap-2">
        {(status === 'BOOKED' || status === 'CONFIRMED') && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => checkInAction(salonSlug, { appointmentId }))}
            >
              Arrived
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmingNoShow(true)}
            >
              No-show
            </Button>
          </>
        )}

        {status === 'CHECKED_IN' && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => startChairAction(salonSlug, { appointmentId }))}
            >
              Start
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmingNoShow(true)}
            >
              No-show
            </Button>
          </>
        )}

        {status === 'IN_CHAIR' && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(() => markProcessingAction(salonSlug, { appointmentId, untilMinutes: 30 }))
              }
            >
              Processing
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(() => endChairAction(salonSlug, { appointmentId }))}
            >
              Finished
            </Button>
          </>
        )}

        {status === 'PROCESSING' && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run(() => endChairAction(salonSlug, { appointmentId }))}
          >
            Finished
          </Button>
        )}

        {(status === 'IN_CHAIR' || status === 'PROCESSING' || status === 'COMPLETED') &&
          needsPayment && (
            <Button size="sm" variant={status === 'COMPLETED' ? 'primary' : 'secondary'} asChild>
              <Link href={`/s/${salonSlug}/desk/checkout/${appointmentId}`}>Take payment</Link>
            </Button>
          )}

        {status === 'COMPLETED' && !needsPayment && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => run(() => checkOutAction(salonSlug, { appointmentId }))}
          >
            Check out
          </Button>
        )}

        {status === 'NO_SHOW' && <span className="text-secondary text-ink-subtle">No-show</span>}
      </div>

      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
