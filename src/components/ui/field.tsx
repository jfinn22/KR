'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

/** Uppercase micro-label. Every input gets one — never a placeholder as label. */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn('label-caps block', className)} {...props} />
))
Label.displayName = 'Label'

const inputStyles =
  'w-full rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-body text-ink placeholder:text-ink-subtle transition-colors hover:border-line-strong focus:border-blue-500 focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-subtle aria-[invalid=true]:border-danger'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputStyles, 'h-11', className)} {...props} />
  ),
)
Input.displayName = 'Input'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputStyles, 'min-h-24 resize-y', className)} {...props} />
))
Textarea.displayName = 'Textarea'

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(inputStyles, 'h-11 pr-9', className)} {...props} />
  ),
)
Select.displayName = 'Select'

/** Label + control + help/error, spaced consistently. */
function Field({
  label,
  htmlFor,
  help,
  error,
  required,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  help?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  /*
   * Associate the label with its control, whether or not the caller bothered.
   *
   * `htmlFor` has been supported since this was written and twenty-five of the
   * forty-five callers did not pass it — so those labels were decoration, and
   * a screen reader announced the placeholder instead. Generating the id here
   * fixes every one of them at once, and means the next caller cannot get it
   * wrong by omission.
   *
   * An explicit `htmlFor`, or an id the child already carries, always wins.
   */
  const generated = React.useId()
  const child = children as React.ReactElement<{ id?: string }>
  const ownId = React.isValidElement(child) ? child.props.id : undefined
  const controlId = htmlFor ?? ownId ?? generated

  /*
   * Only stamp an id when the caller supplied neither. A caller that passed
   * `htmlFor` has already wired it to the right control — and its child here
   * is often a wrapping <div>, so stamping that would put the id on the
   * wrapper and quietly steal it from the input inside.
   */
  const labelled =
    !htmlFor && !ownId && React.isValidElement(child)
      ? React.cloneElement(child, { id: controlId })
      : children

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={controlId}>
        {label}
        {required && <span className="ml-1 text-gold-700">*</span>}
      </Label>
      {labelled}
      {error ? (
        <p className="text-secondary text-danger">{error}</p>
      ) : help ? (
        <p className="text-secondary text-ink-muted">{help}</p>
      ) : null}
    </div>
  )
}

export { Label, Input, Textarea, Select, Field, inputStyles }
