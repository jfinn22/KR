'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { addEndpointAction, removeEndpointAction } from '@/server/actions/integrations'

const TOPICS = [
  { key: 'appointment.booked', label: 'Somebody books' },
  { key: 'appointment.cancelled', label: 'Somebody cancels' },
  { key: 'appointment.completed', label: 'A visit finishes' },
  { key: 'consultation.submitted', label: 'A consultation comes in' },
  { key: 'consultation.approved', label: 'A plan is approved' },
  { key: 'payment.captured', label: 'A payment is taken' },
] as const

interface EndpointView {
  id: string
  url: string
  topics: string[]
  isActive: boolean
  lastDeliveredAt: Date | null
  lastError: string | null
  failureCount: number
  deliveries: number
  dead: boolean
}

/**
 * Where a salon's own events are sent.
 *
 * The signing scheme, the topic vocabulary and the emitter were all built and
 * there was nowhere to store a URL, so nothing could ever be delivered — while
 * the pricing page sold this as "The API". This is the missing half.
 *
 * The secret is shown once, at the moment it is minted, and never again. It has
 * to be stored in the clear for the receiver to be able to verify a signature,
 * which makes it the one credential here that a database dump would hand over —
 * so it is treated the way that deserves: never listed, never re-rendered, and
 * replaced by deleting the endpoint and making a new one.
 */
export function Webhooks({
  salonSlug,
  endpoints,
  enabled,
}: {
  salonSlug: string
  endpoints: EndpointView[]
  enabled: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [topics, setTopics] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [secret, setSecret] = React.useState<string | null>(null)

  if (!enabled) {
    return (
      <p className="text-secondary text-ink-muted">
        Sending your events to your own systems is part of the Salon plan.
      </p>
    )
  }

  async function add() {
    setBusy(true)
    setError(null)
    const result = await addEndpointAction(salonSlug, {
      url: url.trim(),
      topics: topics as never,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSecret(result.data.secret)
    setOpen(false)
    setUrl('')
    setTopics([])
    router.refresh()
  }

  async function remove(endpointId: string) {
    setBusy(true)
    setError(null)
    const result = await removeEndpointAction(salonSlug, { endpointId })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      {endpoints.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {endpoints.map((endpoint) => (
            <li
              key={endpoint.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-body text-ink">{endpoint.url}</span>
                  {endpoint.dead ? (
                    <Badge tone="danger">Given up</Badge>
                  ) : endpoint.lastError ? (
                    <Badge tone="warn">Last one failed</Badge>
                  ) : endpoint.lastDeliveredAt ? (
                    <Badge tone="success">Delivering</Badge>
                  ) : (
                    <Badge tone="neutral">Nothing sent yet</Badge>
                  )}
                </div>
                <p className="mt-1 text-secondary text-ink-muted">
                  {endpoint.topics.length === 0
                    ? 'Everything'
                    : endpoint.topics
                        .map((topic) => TOPICS.find((t) => t.key === topic)?.label ?? topic)
                        .join(' · ')}
                  {endpoint.deliveries > 0 ? ` · ${endpoint.deliveries} sent` : ''}
                </p>
                {endpoint.lastError && (
                  <p className="mt-1 text-label text-danger">{endpoint.lastError}</p>
                )}
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(endpoint.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
       * Shown once and then gone. A secret that can be re-read from a settings
       * page forever is one nobody ever rotates.
       */}
      {secret && (
        <div className="rounded-lg border border-gold-500/40 bg-gold-100/50 p-5">
          <p className="label-caps mb-2">Your signing secret</p>
          <code className="block break-all text-secondary text-ink">{secret}</code>
          <p className="mt-3 text-secondary text-ink-muted">
            Copy it now — this is the only time it is shown. Every request carries an{' '}
            <code>x-salon-signature</code> header, which is a SHA-256 of{' '}
            <code>timestamp.body.secret</code>. Reject anything whose <code>x-salon-timestamp</code>{' '}
            is more than five minutes old, or a captured request can be replayed at you forever.
          </p>
        </div>
      )}

      {open ? (
        <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface-alt p-5">
          <Field
            label="Where to send it"
            htmlFor="endpoint-url"
            help="Has to start with https. These carry client names, and a signed payload over plain HTTP is still readable."
          >
            <Input
              id="endpoint-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hooks/salon"
              autoComplete="off"
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="label-caps mb-2">What to send</legend>
            {TOPICS.map((topic) => (
              <label key={topic.key} className="flex items-center gap-3 text-secondary text-ink">
                <input
                  type="checkbox"
                  checked={topics.includes(topic.key)}
                  onChange={(e) =>
                    setTopics((current) =>
                      e.target.checked
                        ? [...current, topic.key]
                        : current.filter((key) => key !== topic.key),
                    )
                  }
                />
                {topic.label}
              </label>
            ))}
            <p className="mt-1 text-label text-ink-subtle">
              Tick nothing and you get everything, including anything added later.
            </p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={add} disabled={busy || url.trim() === ''}>
              {busy ? 'Saving…' : 'Add it'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true)
              setSecret(null)
              setError(null)
            }}
          >
            {endpoints.length > 0 ? 'Add another' : 'Send events somewhere'}
          </Button>
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
