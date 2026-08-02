import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from './badge'

/**
 * Empty states are a serif headline, one line of explanation, one action.
 * Never a shrug emoji, never three competing buttons.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-surface px-6 py-14 text-center',
        className,
      )}
    >
      <h3 className="font-display text-display-sm text-ink">{title}</h3>
      {description && <p className="max-w-prose text-secondary text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/**
 * Risk flags use a left border-accent, never a full-colour alarm block —
 * a salon screen full of red is a screen stylists learn to ignore.
 *
 * Every flag renders its recommended path. A flag without one is a bug; the
 * rules engine's type system requires it, and this component surfaces it.
 */
const SEVERITY = {
  INFO: { accent: 'border-l-blue-500', bg: 'bg-blue-50', tone: 'info', label: 'For your info' },
  CAUTION: { accent: 'border-l-gold-500', bg: 'bg-gold-100/50', tone: 'warn', label: 'Caution' },
  HIGH: { accent: 'border-l-warn', bg: 'bg-warn-soft', tone: 'warn', label: 'High risk' },
  BLOCKER: { accent: 'border-l-danger', bg: 'bg-danger-soft', tone: 'danger', label: 'Blocker' },
} as const

export type FlagSeverity = keyof typeof SEVERITY

export function RiskFlagCard({
  severity,
  title,
  detail,
  recommendedPath,
  evidence,
  footer,
  className,
}: {
  severity: FlagSeverity
  title: string
  detail: string
  recommendedPath: string
  evidence?: { label: string; value: React.ReactNode }[]
  footer?: React.ReactNode
  className?: string
}) {
  const s = SEVERITY[severity]
  return (
    <article
      className={cn('rounded-lg border border-l-4 border-line p-5', s.accent, s.bg, className)}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={s.tone}>{s.label}</Badge>
        <h4 className="font-display text-display-sm text-ink">{title}</h4>
      </div>

      <p className="mt-3 text-secondary text-ink">{detail}</p>

      {evidence && evidence.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {evidence.map((e) => (
            <div key={e.label} className="flex flex-col">
              <dt className="label-caps">{e.label}</dt>
              <dd className="tabular text-secondary text-ink">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 rounded-md border border-line bg-canvas p-4">
        <p className="label-caps mb-1.5">What we recommend</p>
        <p className="text-secondary text-ink">{recommendedPath}</p>
      </div>

      {footer && <div className="mt-4 flex flex-wrap gap-2">{footer}</div>}
    </article>
  )
}

/**
 * Wrapper for anything the model produced. The dashed border and explicit
 * attribution mean an AI suggestion can never be mistaken for a system fact.
 */
export function AiSuggestion({
  title = 'AI suggestion',
  children,
  actions,
  className,
}: {
  title?: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('ai-suggestion', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="label-caps">{title} — you decide</p>
        <Badge tone="info">Advisory</Badge>
      </div>
      <div className="text-secondary text-ink">{children}</div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </section>
  )
}

/** Slim gold progress rail for the guided consultation flow. */
export function ProgressRail({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div
      className="progress-rail"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}
