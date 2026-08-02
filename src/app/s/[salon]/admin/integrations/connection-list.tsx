'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { disconnectAction } from '@/server/actions/integrations'

/**
 * Connected accounts, with their last error on the face of it.
 *
 * A sync that quietly stopped three weeks ago is worse than no sync — the
 * salon believes their diary is protected when it is not — and this page is
 * the only place anyone would find out.
 */

const PROVIDER_LABEL: Record<string, string> = {
  GOOGLE_CALENDAR: 'Google Calendar',
  APPLE_ICAL: 'Calendar feed',
  STRIPE: 'Stripe',
  TWILIO: 'Twilio',
  RESEND: 'Resend',
  SQUARE_POS: 'Square',
  QUICKBOOKS: 'QuickBooks',
  MAILCHIMP: 'Mailchimp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE_BUSINESS: 'Google Business',
}

export interface Connection {
  id: string
  provider: string
  scope: string
  isActive: boolean
  lastSyncedAt: Date | null
  lastError: string | null
  hasCredentials: boolean
}

export function ConnectionList({
  salonSlug,
  connections,
}: {
  salonSlug: string
  connections: Connection[]
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // The feed links have their own section above.
  const rows = connections.filter((c) => c.provider !== 'APPLE_ICAL')

  async function drop(connectionId: string) {
    setBusy(connectionId)
    setError(null)

    const result = await disconnectAction(salonSlug, { connectionId })
    if (!result.ok) setError(result.error)

    setBusy(null)
    router.refresh()
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface p-5 text-secondary text-ink-muted">
        Nothing connected. The platform runs perfectly well without any of this — connect an account
        only when you want the diary to respect commitments made outside the salon.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {rows.map((connection) => (
          <li
            key={connection.id}
            className="flex flex-wrap items-center justify-between gap-4 py-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body text-ink">
                  {PROVIDER_LABEL[connection.provider] ?? connection.provider}
                </span>
                <span className="text-secondary text-ink-subtle">{connection.scope}</span>
                {!connection.isActive && <Badge tone="neutral">Disconnected</Badge>}
                {connection.lastError && <Badge tone="danger">Failing</Badge>}
              </div>

              <p className="mt-1 text-label text-ink-subtle">
                {connection.lastError
                  ? connection.lastError
                  : connection.lastSyncedAt
                    ? `Last synced ${connection.lastSyncedAt.toISOString().slice(0, 16).replace('T', ' ')}`
                    : 'Never synced'}
              </p>
            </div>

            {connection.isActive && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => drop(connection.id)}
              >
                {busy === connection.id ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
