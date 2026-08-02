import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Buttons are flat and confident: solid navy for primary, hairline-bordered
 * white for secondary, gold-bordered ghost for premium/upsell moments.
 * No gradients, no drop shadows, 44px default height for comfortable tapping.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-blue-900 text-ink-inverse hover:bg-blue-700 active:bg-blue-900',
        secondary:
          'border border-line bg-canvas text-ink hover:bg-surface-alt hover:border-line-strong',
        gold: 'border border-gold-500 bg-gold-100 text-gold-700 hover:bg-gold-300/40',
        ghost: 'text-ink hover:bg-surface-alt',
        link: 'text-blue-500 underline-offset-4 hover:underline',
        danger: 'bg-danger text-ink-inverse hover:bg-danger/90',
        'danger-quiet': 'border border-danger/30 bg-danger-soft text-danger hover:bg-danger/10',
      },
      size: {
        sm: 'h-9 px-3 text-secondary',
        md: 'h-11 px-5 text-secondary',
        lg: 'h-12 px-7 text-body',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
