import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContextFor } from '@/server/auth/page'
import { clientAppointments, hairTimeline } from '@/server/services/client-portal'
import { clientRecord } from '@/server/services/front-desk'
import { consentState, verifySubmission } from '@/server/services/compliance'
import { predictionFor } from '@/server/services/hair-prediction'
import { membershipFor, salonPlans } from '@/server/services/memberships'
import { strandTestsFor } from '@/server/services/requirements'
import { HairTimeline } from '@/components/salon/hair-timeline'
import { ConsentPanel } from './consent-panel'
import { NotesPanel } from './notes-panel'
import { FeesPanel } from './fees-panel'
import { DepositsPanel } from './deposits-panel'
import { SubjectRights } from './subject-rights'
import { FormsPanel } from './forms-panel'
import { permitted } from '@/server/auth/context'
import { HairForm } from './hair-form'
import { MembershipPanel } from './membership-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeading, Stat } from '@/components/ui/data'
import { formatDayHeading, formatMinutes, formatTime, localDateIn } from '@/lib/format'

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

  const { client, accuracy, fees, deposits, overrunCount, averageOverrunMin } = record

  const [{ upcoming, past }, timeline, consent, prediction, hair, membership, plans, strandTests] =
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
      /*
       * Every strand test on this client. `strandTestsFor` had only a test
       * reading it — and a strand test that cannot be looked up later is
       * evidence nobody can produce when it matters.
       */
      strandTestsFor(ctx.salonId, id),
    ])

  /*
   * One row per form the salon publishes, carrying whichever signature is the
   * most recent for this client.
   *
   * Driven off the templates rather than the submissions, because the useful
   * question at a desk is "what has this person not signed" — a list built
   * from submissions can only ever show what has already been done.
   *
   * `verifySubmission` re-hashes the wording, so a form signed against text
   * that has since been edited is shown as exactly that rather than as a valid
   * consent to words nobody agreed to.
   */
  const forms = await Promise.all(
    consent.templates
      .filter((template) => template.requiresSignature)
      .map(async (template) => {
        const latest = consent.submissions.find(
          (submission) => submission.formTemplateId === template.id,
        )
        const check = latest ? await verifySubmission(ctx.salonId, latest.id) : null

        return {
          key: template.key,
          name: template.name,
          version: template.version,
          bodyMarkdown: template.bodyMarkdown,
          isLegalPlaceholder: template.isLegalPlaceholder,
          signed: latest
            ? {
                signerName: latest.signature?.signerName ?? null,
                signerRelationship: latest.signature?.signerRelationship ?? null,
                signedOn: formatDayHeading(
                  localDateIn(ctx.timezone, latest.submittedAt),
                  ctx.timezone,
                ),
                current: check?.matches ?? true,
                signedVersion: check?.signedVersion ?? template.version,
                currentVersion: check?.currentVersion ?? template.version,
              }
            : null,
        }
      }),
  )

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

      {deposits.length > 0 && (
        <section>
          <SectionHeading
            title="Deposits"
            description="Money of theirs the salon is holding, and what has been done with it."
          />
          <div className="mt-6">
            <DepositsPanel
              salonSlug={salon}
              currency={ctx.currency}
              deposits={deposits.map((deposit) => ({
                id: deposit.id,
                amountCents: deposit.amountCents,
                status: deposit.status,
                serviceNames:
                  deposit.appointment?.services.map((row) => row.service.name) ?? [],
                whenLabel: deposit.appointment
                  ? formatDayHeading(
                      localDateIn(ctx.timezone, deposit.appointment.startsAt),
                      ctx.timezone,
                    )
                  : null,
                expiresLabel: deposit.authorizationExpiresAt
                  ? formatDayHeading(
                      localDateIn(ctx.timezone, deposit.authorizationExpiresAt),
                      ctx.timezone,
                    )
                  : null,
              }))}
            />
          </div>
        </section>
      )}

      {/*
       * Near the top, with the notes, because the conversation that starts
       * "I've been charged for something" is the one the desk is least ready
       * for and this is the only screen that can answer it.
       */}
      {fees.length > 0 && (
        <section>
          <SectionHeading
            title="Cancellation fees"
            description="What this client has been charged for cancelling late, and whether it was taken."
          />
          <div className="mt-6">
            <FeesPanel
              salonSlug={salon}
              currency={ctx.currency}
              fees={fees.map((fee) => ({
                id: fee.id,
                appointmentId: fee.appointmentId,
                computedCents: fee.computedCents,
                chargedCents: fee.chargedCents,
                status: fee.status,
                waiveReason: fee.waiveReason,
                serviceNames: fee.appointment.services.map((row) => row.service.name),
                whenLabel: formatDayHeading(
                  localDateIn(ctx.timezone, fee.appointment.startsAt),
                  ctx.timezone,
                ),
              }))}
            />
          </div>
        </section>
      )}

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
                      localDateIn(ctx.timezone, appointment.startsAt),
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

      {forms.length > 0 && (
        <section>
          <SectionHeading
            title="Forms"
            description="What this salon asks people to sign, and who signed it."
          />
          <div className="mt-6">
            <FormsPanel salonSlug={salon} clientProfileId={client.id} forms={forms} />
          </div>
        </section>
      )}

      {/*
       * Immediately after consent, because they are the same conversation:
       * what this salon may do with somebody's information, and what that
       * person may ask it to hand over or destroy.
       */}
      <section>
        <SectionHeading
          title="What they can ask for"
          description="A copy of everything held about them, and — where the law gives them the right — its removal."
        />
        <div className="mt-6">
          <SubjectRights
            salonSlug={salon}
            clientProfileId={client.id}
            clientName={`${client.firstName} ${client.lastName ?? ''}`.trim()}
            canErase={permitted(ctx, 'client.erase', { salonId: ctx.salonId })}
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
                {/*
                  * `formatDayHeading` takes a local calendar date, not an
                  * instant. Handing it an ISO string builds
                  * `2026-08-15T12:34:56.789ZT12:00:00Z`, which is an Invalid
                  * Date, and `Intl` throws on it — a server-side exception
                  * rather than a wrong-looking date.
                  */}
                {formatDayHeading(localDateIn(ctx.timezone, prediction.dueAt), ctx.timezone)}
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

      {strandTests.length > 0 && (
        <section>
          <SectionHeading
            title="Strand tests"
            description="What the hair actually did, before the work. The record somebody reads back if there is ever a question about it."
          />
          <ul className="mt-6 flex flex-col divide-y divide-line border-y border-line">
            {strandTests.map((test) => (
              <li key={test.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <div>
                  <p className="text-body text-ink">
                    {formatDayHeading(localDateIn(ctx.timezone, test.performedAt), ctx.timezone)}
                    {test.startLevel !== null && test.liftAchievedLevel !== null && (
                      <span className="text-ink-muted">
                        {' '}
                        · lifted {test.startLevel} to {test.liftAchievedLevel}
                      </span>
                    )}
                  </p>
                  {test.resultNotes && (
                    <p className="mt-1 text-secondary text-ink-muted">{test.resultNotes}</p>
                  )}
                </div>
                <Badge tone={test.decision === 'ABORT' ? 'danger' : test.decision === 'MODIFY' ? 'warn' : 'success'}>
                  {test.decision === 'ABORT'
                    ? 'do not do it'
                    : test.decision === 'MODIFY'
                      ? 'change the plan'
                      : 'go ahead'}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

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
