'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Field, Input, Select } from '@/components/ui/field'
import {
  ANY_TIME,
  DAY_LABELS,
  EVERY_DAY,
  dayInMask,
  describeWindow,
  isNarrowed,
  type BookingWindow,
} from '@/domain/scheduling/window'

/**
 * "Approve, but Tuesdays and Thursdays, mornings only."
 *
 * A real thing a colourist says about a five-hour correction, and until now
 * there was nowhere to put it — the client got the whole open diary and the
 * stylist found out on the day.
 *
 * Collapsed by default and off by default, for the same reason the price and
 * duration overrides start blank: the common case is agreeing with the diary,
 * and a control sitting open invites a narrowing nobody needed. Every
 * restriction here removes availability, so an idle fiddle costs the client
 * appointments.
 */

/** Coarse enough to pick without thinking, fine enough to mean something. */
const TIMES: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Any time' },
  { value: 8 * 60, label: '8am' },
  { value: 9 * 60, label: '9am' },
  { value: 10 * 60, label: '10am' },
  { value: 11 * 60, label: '11am' },
  { value: 12 * 60, label: '12pm' },
  { value: 13 * 60, label: '1pm' },
  { value: 14 * 60, label: '2pm' },
  { value: 15 * 60, label: '3pm' },
  { value: 16 * 60, label: '4pm' },
  { value: 17 * 60, label: '5pm' },
  { value: 1440, label: 'End of day' },
]

export interface WindowPickerProps {
  value: BookingWindow
  onChange: (window: BookingWindow) => void
}

export function WindowPicker({ value, onChange }: WindowPickerProps) {
  const [open, setOpen] = React.useState(false)
  const narrowed = isNarrowed(value)

  function toggleDay(day: number) {
    const next = value.dayOfWeekMask ^ (1 << day)
    // Zero days is not a narrowing, it is an outage — the solver would return
    // nothing forever and the client would be told the salon is full. The
    // database refuses it too; this refuses it before they can ask.
    if (next === 0) return
    onChange({ ...value, dayOfWeekMask: next })
  }

  function reset() {
    onChange(ANY_TIME)
    setOpen(false)
  }

  return (
    <div className="mt-6 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label-caps">When they can book it</p>
          <p className="mt-1 text-secondary text-ink-muted">
            {narrowed ? describeWindow(value) : 'Anything the diary can take.'}
          </p>
        </div>
        <div className="flex gap-2">
          {narrowed && (
            <button
              type="button"
              onClick={reset}
              className="text-secondary text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="text-secondary text-blue-700 underline underline-offset-4 hover:text-blue-900"
          >
            {open ? 'Done' : 'Narrow it'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div>
            <p className="label-caps mb-2">Days</p>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, day) => {
                const on = dayInMask(value.dayOfWeekMask, day)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'min-w-14 rounded-lg border px-3 py-2 text-secondary transition-colors',
                      on
                        ? 'border-blue-500 bg-blue-50 text-blue-900'
                        : 'border-line bg-canvas text-ink-muted hover:border-line-strong',
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {value.dayOfWeekMask !== EVERY_DAY && (
              <p className="mt-2 text-secondary text-gold-700">
                Fewer days means fewer times. They may wait longer.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Starts no earlier than" htmlFor="win-start">
              <Select
                id="win-start"
                value={String(value.windowStartMinute)}
                onChange={(e) => onChange({ ...value, windowStartMinute: Number(e.target.value) })}
              >
                {TIMES.filter((t) => t.value < 1440).map((time) => (
                  <option key={time.value} value={time.value}>
                    {time.value === 0 ? 'Any time' : time.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Starts no later than"
              htmlFor="win-end"
              // Said out loud because a stylist reading "no later than 1pm" on a
              // five-hour service could reasonably read it as "finished by 1pm",
              // and would then narrow something they did not mean to.
              help="The start, not the finish."
              error={
                value.windowEndMinute <= value.windowStartMinute
                  ? 'That is before the earliest start.'
                  : undefined
              }
            >
              <Select
                id="win-end"
                value={String(value.windowEndMinute)}
                onChange={(e) => onChange({ ...value, windowEndMinute: Number(e.target.value) })}
              >
                {TIMES.filter((t) => t.value > 0).map((time) => (
                  <option key={time.value} value={time.value}>
                    {time.value === 1440 ? 'End of day' : time.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Not before" htmlFor="win-from" help="Leave blank for as soon as possible">
              <Input
                id="win-from"
                type="date"
                value={value.earliestDate ?? ''}
                onChange={(e) => onChange({ ...value, earliestDate: e.target.value || null })}
              />
            </Field>

            <Field
              label="Not after"
              htmlFor="win-to"
              help="A wedding, a holiday, a colour that cannot wait"
              error={
                value.earliestDate && value.latestDate && value.latestDate < value.earliestDate
                  ? 'That is before the start of the range.'
                  : undefined
              }
            >
              <Input
                id="win-to"
                type="date"
                value={value.latestDate ?? ''}
                onChange={(e) => onChange({ ...value, latestDate: e.target.value || null })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  )
}
