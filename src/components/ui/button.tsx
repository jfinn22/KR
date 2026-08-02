import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Buttons have to be findable at a glance.
 *
 * The earlier set was near-black navy and hairline-bordered white, which looked
 * restrained on a design page and disappeared in a salon — a bordered white
 * button next to a white card is a rectangle nobody reads as an action, and
 * near-black blue reads as disabled. So:
 *
 *  - Primary is a lit blue with white text, carrying a soft shadow so it stands
 *    off the card rather than sitting flush in it.
 *  - Secondary is bordered in blue rather than grey, with blue text — clearly a
 *    button, clearly the quieter of the two.
 *  - Gold is a solid fill with black type. It is the most visible thing on any
 *    screen it appears on, so it is reserved for the one moment that matters:
 *    booking, paying, approving.
 *
 * 44px default height for comfortable tapping, and semibold throughout —
 * medium weight on a coloured fill loses more legibility than it looks like it
 * should.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-all active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-blue-500 text-ink-inverse shadow-raised hover:bg-blue-700 hover:shadow-overlay active:bg-blue-900',
        secondary:
          'border-2 border-blue-500/35 bg-canvas text-blue-700 hover:border-blue-500 hover:bg-blue-50',
        gold: 'bg-gold-500 text-ink shadow-raised hover:bg-gold-300 hover:shadow-overlay',
        ghost: 'text-blue-700 hover:bg-blue-50',
        link: 'text-blue-500 underline-offset-4 hover:underline',
        danger: 'bg-danger text-ink-inverse shadow-raised hover:bg-danger/90',
        'danger-quiet': 'border-2 border-danger/30 bg-danger-soft text-danger hover:bg-danger/10',
      },
      size: {
        sm: 'h-9 px-3.5 text-secondary',
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
