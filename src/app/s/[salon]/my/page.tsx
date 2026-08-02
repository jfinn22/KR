import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContext } from '@/server/auth/page'
import { clientHome } from '@/server/services/client-portal'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
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

  // Staff land here too; they belong in the staff workspace, not this page.
  if (ctx.principal.kind !== 'client') {
    return (
      <EmptyState
        title="You are signed in as staff"
        description="This page is the client view. Your work lives in the salon workspace."
        action={
          <Button asChild>
            <Link href={`/s/${salon}/admin/services`}>Go to the salon</Link>
          </Button>
        }
      />
    )
  }

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
          <Card className="mt-5">
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-display text-display-sm text-ink">Nothing booked yet</p>
                <p className="mt-1 text-secondary text-ink-muted">
                  Tell us what you are after and we will tell you honestly what it takes.
                </p>
              </div>
              <Button asChild>
                <Link href={`/s/${salon}/my/consult/new`}>Start a consultation</Link>
              </Button>
            </CardContent>
          </Card>
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
                  className="flex flex-col gap-4 rounded-lg border border-line bg-canvas p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body font-medium text-ink">
                      {plan.sessions.length > 1
                        ? `Visit ${nextSession.sequence} of ${plan.sessions.length}`
                        : 'Your plan is approved'}
                    </p>
                    <p className="mt-1 text-secondary text-ink-muted">{nextSession.name}</p>
                  </div>
                  <Button asChild>
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
                <Link
                  key={consultation.id}
                  href={`/s/${salon}/my/consult/${consultation.id}`}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5 transition-colors hover:bg-surface-alt sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body font-medium text-ink">
                      {consultation.serviceNames.join(' + ')}
                    </p>
                    <p className="mt-1 text-secondary text-ink-muted">
                      {consultation.status === 'DRAFT'
                        ? 'Pick up where you left off'
                        : `Sent ${formatRelative(consultation.updatedAt)}`}
                    </p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <section>
        <SectionHeading
          title="Something new"
          description="Every service starts with a few questions, so what we quote is what you pay."
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
