'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { resolveCheckInAction } from '@/server/actions/retention'

/**
 * Clearing somebody off the unhappy list once they have been rung.
 *
 * `resolveCheckIn` existed with no caller, so this list could only ever grow —
 * and a list that never shrinks is one the front desk stops reading, which
 * costs the salon the exact clients it was built to save.
 */
export function ResolveCheckInButton({
  salonSlug,
  checkInId,
}: {
  salonSlug: string
  checkInId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const result = await resolveCheckInAction(salonSlug, { checkInId })
          setBusy(false)
          if (!result.ok) {
            setError(result.error)
            return
          }
          router.refresh()
        }}
      >
        {busy ? 'Saving…' : 'Sorted'}
      </Button>
      <span className="text-secondary text-ink-muted">Takes them off this list.</span>
      {error && <span className="text-secondary text-danger">{error}</span>}
    </div>
  )
}
