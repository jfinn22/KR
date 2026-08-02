'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'

/**
 * Choosing a time.
 *
 * Grouped by day, times as buttons, and the appointment's real length shown
 * against every one — a client picking 2pm for a five-hour balayage should see
 * "2:00pm – 7:00pm" before they commit, not after.
 *
 * Deliberately not a calendar grid: a month view implies the salon is open at
 * every cell and turns most of the screen into disabled greys.
 */

export interface OfferedSlot {
  startsAt: string
  endsAt: string
  stylistId: string
  stylistName: string
  localDate: string
  durationMin: number
  offersInterleave: boolean
  token: string
}

export interface SlotPickerProps {
  slots: readonly OfferedSlot[]
  timeZone: string
  selectedToken?: string | null
  onSelect: (slot: OfferedSlot) => void
  onWiden?: () => void
  reason?: string | null
  busy?: boolean
  /** Show which stylist each time belongs to. Off when one is pinned. */
  showStylist?: boolean
}

export function SlotPicker({
  slots,
  timeZone,
  selectedToken,
  onSelect,
  onWiden,
  reason,
  busy,
  showStylist,
}: SlotPickerProps) {
  const days = groupByDay(slots)

  if (slots.length === 0) {
    return (
      <EmptyState
        title="Nothing free in this range"
        description={reason ?? 'Try a wider set of dates and we will look again.'}
        action={
          onWiden && (
            <Button variant="secondary" onClick={onWiden} disabled={busy}>
              Look further ahead
            </Button>
          )
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map(([localDate, daySlots]) => (
        <section key={localDate}>
          <h3 className="font-display text-display-sm text-ink">
            {formatDayHeading(localDate, timeZone)}
          </h3>

          <div className="mt-3 flex flex-wrap gap-2">
            {daySlots.map((slot) => {
              const isSelected = slot.token === selectedToken
              return (
                <button
                  key={slot.token}
                  type="button"
                  disabled={busy}
                  onClick={() => onSelect(slot)}
                  aria-pressed={isSelected}
                  className={cn(
                    'group flex min-w-32 flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-blue-900 bg-blue-900 text-ink-inverse'
                      : 'border-line bg-canvas text-ink hover:border-line-strong hover:bg-surface-alt',
                    busy && 'pointer-events-none opacity-50',
                  )}
                >
                  <span className="tabular text-body font-medium">
                    {formatTime(slot.startsAt, timeZone)}
                  </span>
                  <span
                    className={cn(
                      'tabular text-label',
                      isSelected ? 'text-ink-inverse/75' : 'text-ink-subtle',
                    )}
                  >
                    until {formatTime(slot.endsAt, timeZone)}
                  </span>
                  {showStylist && (
                    <span
                      className={cn(
                        'text-label',
                        isSelected ? 'text-ink-inverse/75' : 'text-ink-muted',
                      )}
                    >
                      {slot.stylistName}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      ))}

      {onWiden && (
        <div>
          <Button variant="secondary" onClick={onWiden} disabled={busy}>
            Show more dates
          </Button>
        </div>
      )}
    </div>
  )
}

/** The confirmation line above the button. Says exactly what is being booked. */
export function SlotSummary({
  slot,
  timeZone,
  className,
}: {
  slot: OfferedSlot
  timeZone: string
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-blue-50 p-4', className)}>
      <p className="label-caps mb-1">Your appointment</p>
      <p className="text-body text-ink">
        <span className="font-medium">{formatDayHeading(slot.localDate, timeZone)}</span> at{' '}
        <span className="tabular font-medium">{formatTime(slot.startsAt, timeZone)}</span>,
        finishing around <span className="tabular">{formatTime(slot.endsAt, timeZone)}</span>
      </p>
      <p className="mt-1 text-secondary text-ink-muted">
        {formatDuration(slot.durationMin)} with {slot.stylistName}
      </p>
      {slot.offersInterleave && (
        <Badge tone="gold" className="mt-3">
          Efficient booking
        </Badge>
      )}
    </div>
  )
}

// --- Formatting -------------------------------------------------------------

function groupByDay(slots: readonly OfferedSlot[]): [string, OfferedSlot[]][] {
  const days = new Map<string, OfferedSlot[]>()
  for (const slot of slots) {
    const list = days.get(slot.localDate)
    if (list) list.push(slot)
    else days.set(slot.localDate, [slot])
  }
  for (const list of days.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(new Date(iso))
    .replace(/\s?([ap])m/i, (_, meridiem: string) => meridiem.toLowerCase() + 'm')
}

export function formatDayHeading(localDate: string, timeZone: string): string {
  // Midday, so the date cannot slip across a boundary when it is re-zoned.
  const date = new Date(`${localDate}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(date)
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} minutes`
  if (mins === 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${hours}h ${mins}m`
}
