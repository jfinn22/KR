import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Tables have no vertical rules and no zebra fill — just a hairline under each
 * row and a quiet hover. Headers are uppercase micro-labels.
 * Always wrapped so wide tables scroll inside themselves, never the page.
 */
export function TableWrap({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('w-full overflow-x-auto rounded-lg border border-line', className)}>
      {children}
    </div>
  )
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-collapse text-secondary', className)} {...props} />
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'label-caps whitespace-nowrap border-b border-line px-4 py-3 text-left font-medium',
        className,
      )}
      {...props}
    />
  )
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('border-b border-line px-4 py-3 align-middle text-ink', className)}
      {...props}
    />
  )
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-surface-alt', className)} {...props} />
}

/**
 * KPI tile. The figure is the loudest thing on it; the label is a whisper.
 * `delta` is rendered in semantic colour but never as a coloured background.
 *
 * `tone` tints the tile by what the number is ABOUT, following the palette's
 * own division of labour — gold for money and status, rose for the hair
 * itself, blue for the salon's own working information. It is not decoration:
 * a row of tiles where the takings are gold and the head-count is not lets
 * somebody find the figure they want without reading any of them.
 */
export function Stat({
  label,
  value,
  hint,
  delta,
  deltaDirection,
  tone = 'plain',
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  delta?: string
  deltaDirection?: 'up-good' | 'up-bad' | 'flat'
  tone?: 'plain' | 'money' | 'hair' | 'salon'
  className?: string
}) {
  const toneStyles =
    tone === 'money'
      ? 'wash-gold'
      : tone === 'hair'
        ? 'wash-rose'
        : tone === 'salon'
          ? 'wash-blue'
          : 'border-line bg-canvas'
  const deltaTone =
    deltaDirection === 'up-good'
      ? 'text-success'
      : deltaDirection === 'up-bad'
        ? 'text-danger'
        : 'text-ink-muted'

  return (
    <div className={cn('rounded-lg border p-5 shadow-card', toneStyles, className)}>
      <p className="label-caps">{label}</p>
      <p className="tabular mt-2 font-display text-display-lg text-ink">{value}</p>
      <div className="mt-1 flex items-baseline gap-2">
        {delta && <span className={cn('tabular text-secondary', deltaTone)}>{delta}</span>}
        {hint && <span className="text-secondary text-ink-muted">{hint}</span>}
      </div>
    </div>
  )
}

/** Section heading with the optional thin gold rule beneath it. */
export function SectionHeading({
  title,
  description,
  action,
  rule = true,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  rule?: boolean
  className?: string
}) {
  return (
    <header className={cn('mb-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-display-md text-ink">{title}</h2>
          {description && (
            <p className="mt-1 max-w-prose text-secondary text-ink-muted">{description}</p>
          )}
        </div>
        {action}
      </div>
      {rule && <hr className="rule-gold mt-4" />}
    </header>
  )
}

/** Definition list used across client records and plan summaries. */
export function DetailList({
  items,
  columns = 2,
  className,
}: {
  items: { label: string; value: React.ReactNode }[]
  columns?: 1 | 2 | 3
  className?: string
}) {
  const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[columns]
  return (
    <dl className={cn('grid grid-cols-1 gap-x-8 gap-y-4', cols, className)}>
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-1">
          <dt className="label-caps">{it.label}</dt>
          <dd className="text-body text-ink">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
