import Link from 'next/link'
import { pageContext } from '@/server/auth/page'
import { clientAppointments } from '@/server/services/client-portal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/feedback'
import { SectionHeading } from '@/components/ui/data'
import { formatDayHeading, formatTime, localDateIn } from '@/lib/format'
import { CancelButton } from './cancel-button'

export const dynamic = 'force-dynamic'

const STATUS = {
  BOOKED: { tone: 'info', label: 'Booked' },
  CONFIRMED: { tone: 'success', label: 'Confirmed' },
  COMPLETED: { tone: 'neutral', label: 'Done' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  NO_SHOW: { tone: 'danger', label: 'Missed' },
  IN_PROGRESS: { tone: 'gold', label: 'In the chair' },
} as const

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>
  searchParams: Promise<{ booked?: string }>
}) {
  const [{ salon }, query] = await Promise.all([params, searchParams])
  const ctx = await pageContext(salon)

  if (ctx.principal.kind !== 'client') {
    return <EmptyState title="This is the client view" description="Your diary lives elsewhere." />
  }

  const { upcoming, past } = await clientAppointments(ctx.salonId, ctx.principal.clientProfileId)

  return (
    <div className="flex flex-col gap-12">
      {query.booked && (
        <div className="rounded-lg border border-l-4 border-line border-l-gold-500 bg-gold-100/50 p-5">
          <p className="font-display text-display-sm text-ink">You are booked in</p>
          <p className="mt-1 text-secondary text-ink-muted">
            We have sent you a confirmation. See you then.
          </p>
        </div>
      )}

      <section>
        <h1 className="font-display text-display-lg text-ink">Your appointments</h1>

        {upcoming.length === 0 ? (
          <EmptyState
            className="mt-6"
            title="Nothing coming up"
            description="Start a consultation and we will tell you what your next visit involves."
            action={
              <Button asChild>
                <Link href={`/s/${salon}/my/consult/new`}>Start a consultation</Link>
              </Button>
            }
          />
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {upcoming.map((appointment) => {
              const status = STATUS[appointment.status as keyof typeof STATUS] ?? {
                tone: 'neutral' as const,
                label: appointment.status,
              }
              return (
                <article
                  key={appointment.id}
                  className="rounded-lg border border-line bg-canvas p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="font-display text-display-sm text-ink">
                          {formatDayHeading(
                            localDateIn(ctx.timezone, appointment.startsAt),
                            ctx.timezone,
                          )}
                        </p>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </div>

                      <p className="tabular mt-1 text-body text-ink">
                        {formatTime(appointment.startsAt.toISOString(), ctx.timezone)} –{' '}
                        {formatTime(appointment.endsAt.toISOString(), ctx.timezone)}
                      </p>
                      <p className="mt-1 text-secondary text-ink-muted">
                        {appointment.services.map((s) => s.service.name).join(' + ')} with{' '}
                        {appointment.primaryStylist.displayName} · {appointment.location.name}
                      </p>
                    </div>

                    <CancelButton salonSlug={salon} appointmentId={appointment.id} />
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <SectionHeading title="Previously" />
          <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
            {past.map((appointment) => {
              const status = STATUS[appointment.status as keyof typeof STATUS] ?? {
                tone: 'neutral' as const,
                label: appointment.status,
              }
              return (
                <li
                  key={appointment.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div>
                    <p className="text-body text-ink">
                      {appointment.services.map((s) => s.service.name).join(' + ')}
                    </p>
                    <p className="tabular text-secondary text-ink-subtle">
                      {formatDayHeading(
                        localDateIn(ctx.timezone, appointment.startsAt),
                        ctx.timezone,
                      )}{' '}
                      · {appointment.primaryStylist.displayName}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
