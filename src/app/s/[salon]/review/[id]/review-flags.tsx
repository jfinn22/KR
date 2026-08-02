'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { resolveFlagAction } from '@/server/actions/review'

/**
 * Risk flags, as a stylist deals with them.
 *
 * Three responses, and the difference between them matters:
 *
 *  - Acknowledge: "seen, and I am working with it."
 *  - Resolve: "no longer true" — the strand test came back fine.
 *  - Override: "I know, and I am proceeding anyway."
 *
 * Only the third demands a written reason, and it is the only one that puts a
 * name against the decision. That record is the whole point: a salon that
 * overrides a blocker should be able to say who did and why, and a salon where
 * that is uncomfortable to record is a salon that should not be overriding it.
 */

const SEVERITY = {
  BLOCKER: { tone: 'danger', accent: 'border-l-danger', bg: 'bg-danger-soft', label: 'Blocker' },
  HIGH: { tone: 'warn', accent: 'border-l-warn', bg: 'bg-warn-soft', label: 'High risk' },
  CAUTION: { tone: 'gold', accent: 'border-l-gold-500', bg: 'bg-gold-100/50', label: 'Caution' },
  INFO: { tone: 'info', accent: 'border-l-blue-500', bg: 'bg-blue-50', label: 'Info' },
} as const

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  OVERRIDDEN: 'Overridden',
  RESOLVED: 'Resolved',
}

export interface ReviewFlag {
  id: string
  code: string
  severity: string
  title: string
  detail: string
  recommendedPath: string
  blocksOnlineBooking: boolean
  status: string
  overrideReason: string | null
  evidenceJson: unknown
}

export function ReviewFlags({
  salonSlug,
  consultationId,
  flags,
  readOnly,
}: {
  salonSlug: string
  consultationId: string
  flags: ReviewFlag[]
  readOnly?: boolean
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {flags.map((flag) => (
        <FlagCard
          key={flag.id}
          salonSlug={salonSlug}
          consultationId={consultationId}
          flag={flag}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

function FlagCard({
  salonSlug,
  consultationId,
  flag,
  readOnly,
}: {
  salonSlug: string
  consultationId: string
  flag: ReviewFlag
  readOnly?: boolean
}) {
  const router = useRouter()
  const style = SEVERITY[flag.severity as keyof typeof SEVERITY] ?? SEVERITY.INFO

  const [overriding, setOverriding] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const settled = flag.status !== 'OPEN'

  async function resolve(status: 'ACKNOWLEDGED' | 'OVERRIDDEN' | 'RESOLVED') {
    setBusy(true)
    setError(null)

    const result = await resolveFlagAction(salonSlug, {
      consultationId,
      flagId: flag.id,
      status,
      reason: status === 'OVERRIDDEN' ? reason : null,
    })

    if (!result.ok) {
      setError(result.error)
      setBusy(false)
      return
    }

    setOverriding(false)
    setBusy(false)
    router.refresh()
  }

  const evidence = Array.isArray(flag.evidenceJson)
    ? (flag.evidenceJson as { label?: string; path?: string; value?: unknown }[])
    : []

  return (
    <article
      className={cn(
        'rounded-lg border border-l-4 border-line p-5',
        style.accent,
        settled ? 'bg-surface' : style.bg,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={style.tone}>{style.label}</Badge>
        <h3 className="font-display text-display-sm text-ink">{flag.title}</h3>
        {flag.blocksOnlineBooking && <Badge tone="danger">Blocks online booking</Badge>}
        {settled && <Badge tone="neutral">{STATUS_LABEL[flag.status] ?? flag.status}</Badge>}
      </div>

      <p className="mt-3 text-secondary text-ink">{flag.detail}</p>

      {evidence.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {evidence.map((item, index) => (
            <div key={`${item.path ?? index}`}>
              <dt className="label-caps">{item.label ?? item.path ?? 'Evidence'}</dt>
              <dd className="tabular text-secondary text-ink">{formatValue(item.value)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 rounded-md border border-line bg-canvas p-4">
        <p className="label-caps mb-1.5">Recommended</p>
        <p className="text-secondary text-ink">{flag.recommendedPath}</p>
      </div>

      {flag.overrideReason && (
        <div className="mt-4 rounded-md border border-warn/30 bg-warn-soft p-4">
          <p className="label-caps mb-1.5">Overridden because</p>
          <p className="text-secondary text-ink">{flag.overrideReason}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-secondary text-danger">
          {error}
        </p>
      )}

      {!readOnly && !settled && (
        <div className="mt-4">
          {overriding ? (
            <div className="flex flex-col gap-3">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is it safe to proceed anyway? This goes on the record with your name."
                rows={3}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger-quiet"
                  size="sm"
                  disabled={busy || reason.trim().length < 8}
                  onClick={() => resolve('OVERRIDDEN')}
                >
                  {busy ? 'Recording…' : 'Override and proceed'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setOverriding(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => resolve('ACKNOWLEDGED')}
              >
                Seen, working with it
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => resolve('RESOLVED')}
              >
                No longer true
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOverriding(true)}>
                Override…
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map(String).join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
