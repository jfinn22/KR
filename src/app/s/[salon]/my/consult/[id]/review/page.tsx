import Link from 'next/link'
import { requireContext } from '@/server/auth/context'
import { consultationContext } from '@/server/services/client-portal'
import { PlanSummary } from '@/components/salon/plan-summary'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'

export const dynamic = 'force-dynamic'

/**
 * The answer.
 *
 * The screen the whole product exists to produce: what this will cost, how long
 * it takes, whether it is one visit or three, and what could go wrong — before
 * anybody has sat down.
 *
 * What happens next depends on what the engine concluded, and the difference
 * matters. A client who is blocked from booking online should not see a
 * greyed-out button; they should see the specific next step that unblocks them.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await requireContext(salon)

  const { consultation, evaluation, serviceNames, servicePlanId } = await consultationContext(
    ctx.salonId,
    id,
  )

  if (!evaluation) {
    return (
      <EmptyState
        title="Not evaluated yet"
        description="Finish the questions and we will work out what this takes."
        action={
          <Button asChild>
            <Link href={`/s/${salon}/my/consult/${id}`}>Back to the questions</Link>
          </Button>
        }
      />
    )
  }

  const blocked = evaluation.blocksOnlineBooking
  const awaitingStylist = !servicePlanId && !blocked

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <p className="label-caps">{Object.values(serviceNames).join(' + ')}</p>
          <StatusBadge
            status={consultation.status}
            blocked={blocked}
            approved={Boolean(servicePlanId)}
          />
        </div>
        <h1 className="mt-2 font-display text-display-lg text-ink">
          {blocked
            ? 'Let us do this properly'
            : servicePlanId
              ? 'Here is your plan'
              : 'Here is what we think'}
        </h1>
      </header>

      <PlanSummary evaluation={evaluation} currency={ctx.currency} serviceNames={serviceNames} />

      {/*
       * Deliberately after the plan, not before: a client should read what we
       * found before being asked what to do about it.
       */}
      <Card featured>
        <CardContent className="flex flex-col gap-4">
          {blocked ? (
            <>
              <h2 className="font-display text-display-sm text-ink">
                This one needs a person, not a form
              </h2>
              <p className="max-w-prose text-body text-ink-muted">
                Nothing here says no. It says that what you are after deserves ten minutes with a
                colourist and a look at your hair in daylight, rather than a booking made on a
                guess.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href={`/s/${salon}/my/consult/new?consult=1`}>
                    Book an in-person consultation
                  </Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link href={`/s/${salon}/my`}>Back to my account</Link>
                </Button>
              </div>
            </>
          ) : servicePlanId ? (
            <>
              <h2 className="font-display text-display-sm text-ink">Ready when you are</h2>
              <p className="max-w-prose text-body text-ink-muted">
                {evaluation.plan.sessions.length > 1
                  ? 'Book the first visit now — we will sort the rest once we see how your hair takes it.'
                  : 'Pick a time that suits you.'}
              </p>
              <div>
                <Button asChild>
                  <Link href={`/s/${salon}/my/book/${servicePlanId}?session=1`}>Pick a time</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-display text-display-sm text-ink">With your stylist now</h2>
              <p className="max-w-prose text-body text-ink-muted">
                {awaitingStylist
                  ? 'One of the team is having a look. You will hear from us shortly, and we will send you a link to book as soon as it is agreed.'
                  : 'We will be in touch shortly.'}
              </p>
              <div>
                <Button variant="secondary" asChild>
                  <Link href={`/s/${salon}/my`}>Back to my account</Link>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-secondary text-ink-subtle">
        This estimate was worked out from your answers on{' '}
        {new Date(evaluation.evaluatedAt).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
        . If anything changes, tell us and we will look again.
      </p>
    </div>
  )
}

function StatusBadge({
  status,
  blocked,
  approved,
}: {
  status: string
  blocked: boolean
  approved: boolean
}) {
  if (approved) return <Badge tone="gold">Approved</Badge>
  if (blocked) return <Badge tone="warn">In-person needed</Badge>
  if (status === 'DECLINED') return <Badge tone="danger">Not taken forward</Badge>
  return <Badge tone="info">Being reviewed</Badge>
}
