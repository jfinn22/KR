import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { pageContext } from '@/server/auth/page'
import { clientHome } from '@/server/services/client-portal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeading } from '@/components/ui/data'
import { formatDayHeading, formatTime, localDateIn } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The client's home.
 *
 * Answers three questions in order of how often they are asked: when am I next
 * in, is there anything waiting on me, and can I book the same thing again.
 * Everything else is a click away.
 */

const CONSULT_STATUS = {
  DRAFT: { tone: 'warn', label: 'Not finished' },
  SUBMITTED: { tone: 'info', label: 'With the salon' },
  IN_REVIEW: { tone: 'info', label: 'Being reviewed' },
  NEEDS_MORE_INFO: { tone: 'warn', label: 'Needs a bit more' },
} as const

export default async function ClientHomePage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContext(salon)

  // Staff land here from a bookmark or the logo; send them to their own day
  // rather than showing a client page they cannot use.
  if (ctx.principal.kind !== 'client') redirect(`/s/${salon}/desk`)

  const { next, openConsultations, plans, recent } = await clientHome(
    ctx.salonId,
    ctx.principal.clientProfileId,
  )
  if (!ctx.salonId) notFound()

  const tz = ctx.timezone

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h1 className="font-display text-display-lg text-ink">Hello again</h1>

        {next ? (
          <Card featured className="mt-5">
            <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="label-caps mb-1">Your next appointment</p>
                <p className="font-display text-display-md text-ink">
                  {formatDayHeading(localDateIn(tz, next.startsAt), tz)}
                </p>
                <p className="tabular mt-1 text-body text-ink">
                  {formatTime(next.startsAt.toISOString(), tz)} –{' '}
                  {formatTime(next.endsAt.toISOString(), tz)} with {next.primaryStylist.displayName}
                </p>
                <p className="mt-1 text-secondary text-ink-muted">
                  {next.services.map((s) => s.service.name).join(' + ')} · {next.location.name}
                </p>
              </div>

              <Button asChild variant="secondary">
                <Link href={`/s/${salon}/my/appointments`}>Manage</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="wash-blue mt-5 flex flex-col gap-4 rounded-xl p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-display-sm text-ink">Nothing booked yet</p>
              <p className="mt-1 max-w-prose text-secondary text-ink-muted">
                Tell us what you are after — the shade, and a picture of it if you have one — and we
                will tell you honestly what it takes.
              </p>
            </div>
            <Button asChild>
              <Link href={`/s/${salon}/my/consult/new`}>Start a consultation</Link>
            </Button>
          </div>
        )}
      </section>

      {plans.length > 0 && (
        <section>
          <SectionHeading title="Ready to book" />
          <div className="mt-4 flex flex-col gap-3">
            {plans.map((plan) => {
              const nextSession = plan.sessions.find((session) => !session.appointment)
              if (!nextSession) return null
              return (
                <div
                  key={plan.id}
                  className="wash-gold flex flex-col gap-4 rounded-lg p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body font-medium text-ink">
                      {plan.sessions.length > 1
                        ? `Visit ${nextSession.sequence} of ${plan.sessions.length}`
                        : 'Your plan is approved'}
                    </p>
                    <p className="mt-1 text-secondary text-ink-muted">{nextSession.name}</p>
                  </div>
                  <Button variant="gold" asChild>
                    <Link href={`/s/${salon}/my/book/${plan.id}?session=${nextSession.sequence}`}>
                      Pick a time
                    </Link>
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {openConsultations.length > 0 && (
        <section>
          <SectionHeading title="Your consultations" />
          <div className="mt-4 flex flex-col gap-3">
            {openConsultations.map((consultation) => {
              const status = CONSULT_STATUS[consultation.status as keyof typeof CONSULT_STATUS] ?? {
                tone: 'neutral' as const,
                label: consultation.status,
              }
              return (
                <div
                  key={consultation.id}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/s/${salon}/my/consult/${consultation.id}`} className="group">
                      <p className="text-body font-medium text-ink group-hover:text-blue-700">
                        {consultation.serviceNames.join(' + ')}
                      </p>
                      <p className="mt-1 text-secondary text-ink-muted">
                        {consultation.status === 'DRAFT'
                          ? 'Pick up where you left off'
                          : `Sent ${formatRelative(consultation.updatedAt)}`}
                      </p>
                    </Link>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>

                  {/*
                   * Reachable from outside the flow too. A client often only
                   * finds the picture they wanted days after they answered the
                   * questions, and having to restart a consultation to add it
                   * is how a salon ends up guessing.
                   */}
                  <Link
                    href={`/s/${salon}/my/consult/${consultation.id}/inspiration`}
                    className="wash-rose flex items-center justify-between gap-3 rounded-md px-4 py-3 transition-colors hover:border-rose-500"
                  >
                    <span className="text-secondary text-ink">
                      Add a picture of the look you want
                    </span>
                    <span aria-hidden="true" className="text-secondary font-medium text-rose-700">
                      Add →
                    </span>
                  </Link>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <SectionHeading
          title="Something new"
          description="Every service starts with a few questions and a picture of what you are after, so what we quote is what you pay."
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/s/${salon}/my/consult/new`}>Start a consultation</Link>
          </Button>

          {recent && (
            <Button asChild variant="secondary">
              <Link
                href={`/s/${salon}/my/consult/new?services=${recent.services
                  .map((s) => s.serviceId)
                  .join(',')}`}
              >
                Book {recent.services.map((s) => s.service.name).join(' + ')} again
              </Link>
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

function formatRelative(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date)
}
