import { requireContext } from '@/server/auth/context'
import { loadPlan, sessionBookability } from '@/server/services/service-plan'
import { findSlots } from '@/server/services/scheduling/slots'
import { EmptyState } from '@/components/ui/feedback'
import { BookingFlow } from './booking-flow'

export const dynamic = 'force-dynamic'

/** How far ahead the first search looks. Widened by the client on request. */
const INITIAL_WINDOW_DAYS = 21

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string; planId: string }>
  searchParams: Promise<{ session?: string }>
}) {
  const [{ salon, planId }, query] = await Promise.all([params, searchParams])
  const ctx = await requireContext(salon)

  const sequence = Number(query.session ?? '1') || 1
  const plan = await loadPlan(ctx.salonId, planId)
  const session = plan.sessions.find((s) => s.sequence === sequence)

  if (!session) {
    return (
      <EmptyState
        title="That visit is not part of this plan"
        description="Head back to your account and pick it from there."
      />
    )
  }
  if (session.appointment) {
    return (
      <EmptyState
        title="Already booked"
        description="This visit is in the diary. You can see it under your appointments."
      />
    )
  }

  const gate = await sessionBookability(ctx.salonId, planId, sequence)

  // The window opens at the earliest the hair is ready, not today.
  const from = gate.earliestDate ?? localToday(ctx.timezone)
  const to = addDays(from, INITIAL_WINDOW_DAYS)

  const initial = gate.bookable
    ? await findSlots({
        salonId: ctx.salonId,
        servicePlanId: planId,
        sequence,
        fromDate: from,
        toDate: to,
      })
    : { slots: [], reason: gate.reason, bookable: false, earliestDate: gate.earliestDate }

  return (
    <BookingFlow
      salonSlug={salon}
      timeZone={ctx.timezone}
      currency={ctx.currency}
      servicePlanId={planId}
      sequence={sequence}
      sessionName={session.name}
      totalSessions={plan.sessions.length}
      stylistName={plan.stylistProfile?.displayName ?? null}
      initialFrom={from}
      initialTo={to}
      initialResult={initial}
    />
  )
}

function localToday(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date())
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
