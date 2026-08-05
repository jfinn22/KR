import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContextFor } from '@/server/auth/page'
import { clientAppointments, hairTimeline } from '@/server/services/client-portal'
import { clientRecord } from '@/server/services/front-desk'
import { consentState } from '@/server/services/compliance'
import { predictionFor } from '@/server/services/hair-prediction'
import { membershipFor, salonPlans } from '@/server/services/memberships'
import { HairTimeline } from '@/components/salon/hair-timeline'
import { ConsentPanel } from './consent-panel'
import { NotesPanel } from './notes-panel'
import { HairForm } from './hair-form'
import { MembershipPanel } from './membership-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeading, Stat } from '@/components/ui/data'
import { formatDayHeading, formatMinutes, formatTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The client record, as the salon sees it.
 *
 * The same hair timeline the client can read, plus the things they cannot: how
 * often they have not turned up, and whether the estimates for them have been
 * running over. A stylist about to take somebody new from a colleague's column
 * should be able to learn all of it in one screen.
 */
export default async function ClientRecordPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContextFor(salon, 'client.viewAny')

  const record = await clientRecord(ctx.salonId, id)
  if (!record) notFound()

  const { client, accuracy, overrunCount, averageOverrunMin } = record

  const [{ upcoming, past }, timeline, consent, prediction, hair, membership, plans] =
    await Promise.all([
    clientAppointments(ctx.salonId, client.id),
    hairTimeline(ctx.salonId, client.id),
    consentState(ctx.salonId, client.id),
    predictionFor(ctx.salonId, id),
      ctx.db.hairProfile.findFirst({
      where: { salonId: ctx.salonId, clientProfileId: id },
      select: {
        naturalLevel: true,
        currentLevelRoots: true,
        greyPercent: true,
        washesPerWeek: true,
        heatStylingPerWeek: true,
        swimsChlorinatedWeekly: true,
        usesPurpleShampoo: true,
        hardWater: true,
        growthCmPerMonth: true,
      },
    }),
      membershipFor(ctx.salonId, id),
      salonPlans(ctx.salonId),
    ])

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/desk/clients`}>← Search</Link>
        </Button>
      </div>

      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-display-lg text-ink">
            {`${client.firstName} ${client.lastName ?? ''}`.trim()}
          </h1>
          {client.completedVisits === 0 && <Badge tone="info">New client</Badge>}
          {client.noShowCount >= 2 && <Badge tone="danger">Repeat no-shows</Badge>}
        </div>
        <p className="mt-2 text-body text-ink-muted">
          {[client.email, client.phone].filter(Boolean).join(' · ') || 'No contact details on file'}
        </p>

        {/*
         * With them in the chair, on the stylist's own device.
         *
         * The consultation flow always existed and only a client could start
         * one — so a walk-in either got no consultation at all or got a link
         * emailed to them to fill in later, at home, from memory. The person
         * best placed to answer "how porous are the ends" is the one holding
         * them.
         */}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={`/s/${salon}/my/consult/new?client=${client.id}`}>
              Start a consultation here
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/s/${salon}/desk/book?client=${client.id}`}>Book them in</Link>
          </Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Visits" value={client.completedVisits} />
        <Stat
          label="No-shows"
          value={client.noShowCount}
          hint={client.noShowCount > 0 ? 'Deposit likely required' : 'Reliable'}
        />
        <Stat
          label="Typical overrun"
          value={averageOverrunMin > 0 ? formatMinutes(averageOverrunMin) : 'None'}
          hint={
            overrunCount > 0
              ? `${overrunCount} of the last ${accuracy.length} ran over`
              : 'Estimates have held'
          }
        />
        <Stat
          label="Natural level"
          tone="hair"
          value={client.hairProfile?.naturalLevel ?? '—'}
          hint={
            client.hairProfile?.currentLevelMids
              ? `now ${client.hairProfile.currentLevelMids}`
              : undefined
          }
        />
      </div>

      {/*
       * High on the page, above "Coming up", because it is the thing a stylist
       * taking somebody else's client wants before they read anything else.
       */}
      <section>
        <SectionHeading
          title="Notes"
          description="What the salon has learned about this client. Carried across every visit."
        />
        <div className="mt-6">
          <NotesPanel
            salonSlug={salon}
            clientProfileId={client.id}
            initialNotes={client.internalNotes}
          />
        </div>
      </section>

      {upcoming.length > 0 && (
        <section>
          <SectionHeading title="Coming up" />
          <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
            {upcoming.map((appointment) => (
              <li key={appointment.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-secondary text-ink">
                    {appointment.services.map((s) => s.service.name).join(' + ')}
                  </p>
                  <p className="tabular text-label text-ink-subtle">
                    {formatDayHeading(
                      appointment.startsAt.toISOString().slice(0, 10),
                      ctx.timezone,
                    )}{' '}
                    at {formatTime(appointment.startsAt.toISOString(), ctx.timezone)} ·{' '}
                    {appointment.primaryStylist.displayName}
                  </p>
                </div>
                <Badge tone="info">{appointment.status.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading
          title="Consent and safety"
          description="Recorded with a date, so the salon can always say when permission started and stopped."
        />
        <div className="mt-6">
          <ConsentPanel
            salonSlug={salon}
            clientProfileId={client.id}
            granted={consent.grants
              .filter((grant) => grant.status === 'GRANTED')
              .map((grant) => grant.kind)}
            patchTests={consent.patchTests.map((test) => ({
              id: test.id,
              appliedAt: test.appliedAt.toISOString(),
              result: test.result,
              validUntil: test.validUntil.toISOString(),
              isCurrent: test.isCurrent,
            }))}
          />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Membership"
          description="What they pay for every month, and what is left of it this period."
        />
        <div className="mt-6">
          <MembershipPanel
            salonSlug={salon}
            clientProfileId={id}
            plans={plans
              .filter((plan) => plan.isActive)
              .map((plan) => ({
                id: plan.id,
                name: plan.name,
                priceCents: plan.priceCents,
                interval: plan.interval,
              }))}
            membership={
              membership
                ? {
                    id: membership.id,
                    planId: membership.planId,
                    planName: membership.planName,
                    priceCents: membership.priceCents,
                    status: membership.status,
                    renewsAt: membership.renewsAt?.toISOString() ?? null,
                    cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
                    suspended: membership.suspended,
                    benefits: membership.entitlements.map((entitlement) => ({
                      label: entitlement.label,
                      used:
                        membership.usedThisPeriod[
                          `${entitlement.serviceId ?? '*'}:${entitlement.kind}:${entitlement.value}`
                        ] ?? 0,
                      allowance: entitlement.perPeriod,
                    })),
                  }
                : null
            }
          />
        </div>
      </section>

      <section>
        <SectionHeading
          title="When they need to be back"
          description="Two clocks — the tone going and the roots showing — and whichever runs out first."
        />
        <div className="mt-6">
          {prediction.dueAt === null ? (
            <p className="text-body text-ink-muted">
              We cannot say yet. To work it out we would need{' '}
              {prediction.missing.slice(0, 3).join(', ')}.
            </p>
          ) : (
            <div className="rounded-lg border-l-4 border-l-gold-500 bg-gold-100/50 px-5 py-4">
              <p className="font-display text-display-sm text-ink">
                {formatDayHeading(prediction.dueAt.toISOString(), ctx.timezone)}
              </p>
              <p className="mt-1 text-body text-ink">
                {prediction.driver === 'ROOTS'
                  ? 'The roots will be showing by then.'
                  : 'The tone will have gone by then.'}{' '}
                About {prediction.intervalWeeks} weeks from their colour.
              </p>
              {prediction.confidence === 'ROUGH' && (
                <p className="mt-2 text-secondary text-ink-muted">
                  A rough figure — we are using averages for{' '}
                  {prediction.missing.slice(0, 2).join(' and ')}.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-8">
          <SectionHeading
            title="What their hair is like"
            description="What the prediction above is built from. Everything here changes it."
          />
          <div className="mt-6">
            <HairForm
              salonSlug={salon}
              clientProfileId={id}
              initial={{
                naturalLevel: hair?.naturalLevel ?? null,
                currentLevelRoots: hair?.currentLevelRoots ?? null,
                greyPercent: hair?.greyPercent ?? null,
                washesPerWeek: hair?.washesPerWeek ?? null,
                heatStylingPerWeek: hair?.heatStylingPerWeek ?? null,
                swimsChlorinatedWeekly: hair?.swimsChlorinatedWeekly ?? false,
                usesPurpleShampoo: hair?.usesPurpleShampoo ?? false,
                hardWater: hair?.hardWater ?? false,
                growthCmPerMonth:
                  hair?.growthCmPerMonth === null || hair?.growthCmPerMonth === undefined
                    ? null
                    : Number(hair.growthCmPerMonth),
              }}
            />
          </div>
        </div>
      </section>

      <section>
        <SectionHeading
          title="Their hair"
          description={`${past.length} previous visit${past.length === 1 ? '' : 's'} on record.`}
        />
        <div className="mt-6">
          <HairTimeline
            entries={timeline}
            emptyTitle="Nothing on record yet"
            emptyDescription="Once they have been in, everything done will show up here."
          />
        </div>
      </section>
    </div>
  )
}
