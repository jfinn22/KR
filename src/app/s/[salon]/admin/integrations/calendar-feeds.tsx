'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { issueFeedTokenAction, revokeFeedTokenAction } from '@/server/actions/integrations'

/**
 * Calendar feed links.
 *
 * The URL is shown exactly once, at the moment it is minted, because only its
 * hash is stored. That is deliberate: a credential you can re-read from a
 * settings page forever is a credential nobody ever rotates. Generating a new
 * one replaces the old, which is also how you revoke a link somebody shared by
 * accident.
 */
export function CalendarFeeds({
  salonSlug,
  stylists,
}: {
  salonSlug: string
  stylists: { id: string; name: string; hasFeed: boolean }[]
}) {
  const router = useRouter()
  const [issued, setIssued] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function issue(stylistProfileId: string) {
    setBusy(stylistProfileId)
    setError(null)

    const result = await issueFeedTokenAction(salonSlug, { stylistProfileId })
    if (!result.ok) {
      setError(result.error)
      setBusy(null)
      return
    }

    const origin = typeof window === 'undefined' ? '' : window.location.origin
    setIssued((current) => ({ ...current, [stylistProfileId]: origin + result.data.url }))
    setBusy(null)
    router.refresh()
  }

  async function revoke(stylistProfileId: string) {
    setBusy(stylistProfileId)
    setError(null)

    const result = await revokeFeedTokenAction(salonSlug, { stylistProfileId })
    if (!result.ok) setError(result.error)

    setIssued((current) => {
      const next = { ...current }
      delete next[stylistProfileId]
      return next
    })
    setBusy(null)
    router.refresh()
  }

  if (stylists.length === 0) {
    return <p className="text-secondary text-ink-subtle">No stylists on the team yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {stylists.map((stylist) => (
          <li key={stylist.id} className="flex flex-col gap-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-body text-ink">{stylist.name}</span>
                {stylist.hasFeed && <Badge tone="success">Link active</Badge>}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => issue(stylist.id)}
                >
                  {busy === stylist.id
                    ? 'Working…'
                    : stylist.hasFeed
                      ? 'Replace the link'
                      : 'Create a link'}
                </Button>
                {stylist.hasFeed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => revoke(stylist.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </div>

            {issued[stylist.id] && (
              <div className="rounded-lg border border-l-4 border-line border-l-gold-500 bg-gold-100/50 p-4">
                <p className="label-caps mb-2">Copy this now — it is not shown again</p>
                <code className="block break-all rounded-md border border-line bg-canvas px-3 py-2 text-label text-ink">
                  {issued[stylist.id]}
                </code>
                <p className="mt-2 text-label text-ink-muted">
                  Add it as a subscribed calendar. It updates on its own and shows client initials
                  rather than full names.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
