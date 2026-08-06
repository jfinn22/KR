'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { claimReviewAction, reevaluateAction } from '@/server/actions/review'

/**
 * Who has this consultation, and a way to re-run the rules.
 *
 * `claimForReview` and the re-evaluation both existed with nothing calling
 * them, which left two holes with the same shape. Without a claim, two
 * stylists open the same consultation on a busy Saturday and the second one's
 * decision silently overwrites the first. Without a re-run, correcting a fact
 * a client got wrong left the old evaluation — and therefore the old price,
 * the old duration and the old flags — attached to the approval.
 *
 * Claiming is a button rather than a side effect of opening the page: Next
 * prefetches links, so an on-render claim would take a consultation off a
 * colleague because somebody's cursor passed over the queue.
 */
export function ReviewClaim({
  salonSlug,
  consultationId,
  status,
  heldBy,
  heldByMe,
}: {
  salonSlug: string
  consultationId: string
  status: string
  heldBy: string | null
  heldByMe: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<'claim' | 'reevaluate' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [rerun, setRerun] = React.useState(false)

  async function claim() {
    setBusy('claim')
    setError(null)
    const result = await claimReviewAction(salonSlug, { consultationId })
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function reevaluate() {
    setBusy('reevaluate')
    setError(null)
    setRerun(false)
    const result = await reevaluateAction(salonSlug, { consultationId })
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRerun(true)
    router.refresh()
  }

  const unclaimed = status === 'SUBMITTED'

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface-alt px-5 py-4">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        {unclaimed ? (
          <>
            <Badge tone="neutral">Not started</Badge>
            <span className="text-secondary text-ink-muted">
              Nobody has picked this up yet. Take it and it leaves everyone else&rsquo;s queue.
            </span>
          </>
        ) : heldByMe ? (
          <>
            <Badge tone="gold">Yours</Badge>
            <span className="text-secondary text-ink-muted">You have this one.</span>
          </>
        ) : heldBy ? (
          <>
            <Badge tone="warn">With {heldBy}</Badge>
            {/*
             * Said plainly rather than by disabling the decision panel. A
             * stylist covering for somebody who has gone home must still be
             * able to decide; what they must not do is decide by accident.
             */}
            <span className="text-secondary text-ink-muted">
              {heldBy} is reviewing this. Deciding it yourself will overrule them.
            </span>
          </>
        ) : (
          <>
            <Badge tone="info">In review</Badge>
            <span className="text-secondary text-ink-muted">Started, but not by anyone in particular.</span>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {unclaimed && (
          <Button size="sm" onClick={claim} disabled={busy !== null}>
            {busy === 'claim' ? 'Taking…' : "I'll take this"}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={reevaluate} disabled={busy !== null}>
          {busy === 'reevaluate' ? 'Checking…' : 'Run the checks again'}
        </Button>
      </div>

      {rerun && (
        <p className="w-full text-secondary text-success">
          Checked again. The price, the timings and the flags above are current.
        </p>
      )}
      {error && <p className="w-full text-secondary text-danger">{error}</p>}
    </div>
  )
}
