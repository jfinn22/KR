import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Pill badges. Gold is reserved for premium tiers and the approved state. */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label font-medium uppercase tracking-[0.08em] [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-alt text-ink-muted',
        info: 'bg-blue-100 text-blue-900',
        gold: 'bg-gold-100 text-gold-700',
        success: 'bg-success-soft text-success',
        warn: 'bg-warn-soft text-warn',
        danger: 'bg-danger-soft text-danger',
        outline: 'border border-line text-ink-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
