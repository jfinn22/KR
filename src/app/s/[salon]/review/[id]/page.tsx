import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { reviewDetail } from '@/server/services/review-queue'
import { capableStylists } from '@/server/services/catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeading } from '@/components/ui/data'
import { formatDayHeading, formatMinutes, formatMoney, localDateIn } from '@/lib/format'
import { describeShade, readShadeAnswer } from '@/domain/hair/tone'
import { JourneyLadder } from '@/components/salon/journey-ladder'
import { ReviewFlags } from './review-flags'
import { DecisionPanel } from './decision-panel'
import { AiSummaryCard } from './ai-summary'

export const dynamic = 'force-dynamic'

/**
 * One consultation, everything about it, in one screen.
 *
 * The order is the order a stylist actually thinks in: what did they ask for,
 * what does their hair look like, what did they tell us, what does the engine
 * think, and only then — what do I decide. Putting the decision buttons first
 * would produce faster reviews and worse ones.
 *
 * Flags show `detail`, not `clientExplanation`: this reader is a colourist and
 * wants "underlying pigment at level 5 with box dye present", not the softened
 * version the client saw.
 */
export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContextFor(salon, 'consultation.review')

  const detail = await reviewDetail(ctx.salonId, id)
  const {
    consultation,
    services,
    photos,
    inspiration,
    flags,
    evaluation,
    priorVisits,
    journey,
    videos,
  } = detail

  const stylists = await capableStylists(ctx.salonId, consultation.requestedServiceIds)

  const client = consultation.clientProfile
  const clientName = `${client.firstName} ${client.lastName ?? ''}`.trim()
  const decided = consultation.status === 'APPROVED' || consultation.status === 'DECLINED'

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/review`}>← Queue</Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-display-lg text-ink">{clientName}</h1>
            {client.completedVisits === 0 && <Badge tone="info">New client</Badge>}
            {client.noShowCount > 0 && (
              <Badge tone="warn">
                {client.noShowCount} no-show{client.noShowCount === 1 ? '' : 's'}
              </Badge>
            )}
            {decided && <Badge tone="gold">{consultation.status.toLowerCase()}</Badge>}
          </div>

          <p className="mt-2 text-body text-ink-muted">
            {services.map((service) => service.name).join(' + ')}
            {consultation.submittedAt
              ? ` · sent ${formatDayHeading(localDateIn(ctx.timezone, consultation.submittedAt), ctx.timezone)}`
              : ''}
          </p>
        </div>

        {evaluation && (
          <dl className="flex gap-8">
            <Figure
              label="Estimate"
              value={formatMoney(evaluation.price.estimatedTotalCents, ctx.currency)}
            />
            <Figure label="In the chair" value={formatMinutes(evaluation.duration.totalMin)} />
            <Figure
              label="Visits"
              value={String(evaluation.plan.sessionCount)}
              hint={evaluation.complexity.band.toLowerCase()}
            />
          </dl>
        )}
      </header>

      {/* Advisory, generated on request, never on load. */}
      <AiSummaryCard salonSlug={salon} consultationId={id} />

      {/* --- What the engine found ------------------------------------------ */}
      {flags.length > 0 && (
        <section>
          <SectionHeading
            title="Risk flags"
            description="Shown as the engine sees them. The client saw a softer version of the same thing."
          />
          <ReviewFlags salonSlug={salon} consultationId={id} flags={flags} readOnly={decided} />
        </section>
      )}

      {/* --- The client's own words ----------------------------------------- */}
      <section>
        <SectionHeading
          title={consultation.startedInChair ? 'What the stylist recorded' : 'What they told us'}
          description={
            consultation.startedInChair
              ? 'Filled in at the salon, with the hair in front of whoever answered — so these are observations rather than recollections.'
              : undefined
          }
        />
        <dl className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {detail.answered.map((entry) => (
            <div key={entry.key} className="border-b border-line pb-3">
              <dt className="label-caps">{entry.prompt}</dt>
              <dd
                className={
                  entry.wasAnswered ? 'mt-1 text-body text-ink' : 'mt-1 text-body text-ink-subtle'
                }
              >
                {entry.wasAnswered ? renderAnswer(entry.answer) : 'Not answered'}
              </dd>
            </div>
          ))}
        </dl>

        {consultation.clientNote && (
          <div className="mt-6 rounded-lg border border-line bg-surface p-5">
            <p className="label-caps mb-1">Their note</p>
            <p className="text-body text-ink">{consultation.clientNote}</p>
          </div>
        )}
      </section>

      {/* --- Photos ---------------------------------------------------------- */}
      {photos.length > 0 && (
        <section>
          <SectionHeading title="Their hair" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {photos.map((photo) => (
              <figure key={photo.id} className="overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.view.toLowerCase()}
                  className="aspect-[3/4] w-full object-cover"
                />
                <figcaption className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="text-label uppercase tracking-[0.08em] text-ink-subtle">
                    {photo.view.toLowerCase()}
                  </span>
                  {photo.qualityScore !== null && photo.qualityScore < 0.4 && (
                    <span className="text-label text-warn">low</span>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* --- What they are pointing at ---------------------------------------- */}
      {inspiration.length > 0 && (
        <section>
          <SectionHeading
            title="What they want"
            description="Tagged by the client, so you know which part of the picture they mean."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {inspiration.map((photo) => (
              <article key={photo.id} className="overflow-hidden rounded-lg border border-line">
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="" className="aspect-[4/3] w-full object-cover" />
                )}
                <div className="flex flex-wrap gap-1.5 p-3">
                  {photo.attributes.length === 0 ? (
                    <span className="text-label text-ink-subtle">Untagged</span>
                  ) : (
                    photo.attributes.map((attribute) => (
                      <Badge key={attribute.key} tone="gold">
                        {attribute.key.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    ))
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* --- The hair, moving -------------------------------------------------- */}
      {videos.length > 0 && (
        <section>
          <SectionHeading
            title="How it moves"
            description="Banding reads as a line in a photograph and as a stripe travelling down the length when the head turns. Worth thirty seconds before you decide."
          />
          <div className="mt-4 flex flex-col gap-4">
            {videos.map((video) => (
              <figure key={video.id} className="overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={video.url} controls playsInline className="w-full" />
                <figcaption className="p-3">
                  {video.prompt && <p className="text-secondary text-ink">{video.prompt}</p>}
                  {video.clientNote && (
                    <p className="mt-1 text-secondary text-ink-muted">{video.clientNote}</p>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* --- What the client was shown ---------------------------------------- */}
      {journey?.worthShowing && (
        <section>
          <SectionHeading
            title="The journey they have seen"
            description="Exactly what is on their screen. If visit two leaves somebody copper, this is where you find that out before you approve it."
          />
          <div className="mt-4">
            <JourneyLadder journey={journey} audience="staff" />
          </div>
        </section>
      )}

      {/* --- What actually happened before ------------------------------------ */}
      {priorVisits.length > 0 && (
        <section>
          <SectionHeading
            title="Last few visits"
            description="What actually happened beats any estimate."
          />
          <ul className="mt-4 flex flex-col divide-y divide-line border-y border-line">
            {priorVisits.map((visit) => {
              const actual =
                visit.chairStartedAt && visit.chairEndedAt
                  ? Math.round(
                      (visit.chairEndedAt.getTime() - visit.chairStartedAt.getTime()) / 60_000,
                    )
                  : null

              return (
                <li key={visit.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-secondary text-ink">
                      {visit.services.map((s) => s.service.name).join(' + ')}
                    </p>
                    <p className="text-label text-ink-subtle">
                      {visit.startsAt.toISOString().slice(0, 10)} ·{' '}
                      {visit.primaryStylist.displayName}
                    </p>
                  </div>
                  {actual !== null && (
                    <span className="tabular text-secondary text-ink-muted">
                      {formatMinutes(actual)} in the chair
                      {actual > visit.estimatedDurationMin && (
                        <span className="ml-2 text-warn">
                          +{actual - visit.estimatedDurationMin}m over
                        </span>
                      )}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* --- The decision ----------------------------------------------------- */}
      <DecisionPanel
        salonSlug={salon}
        consultationId={id}
        currency={ctx.currency}
        decided={decided}
        servicePlanId={detail.consultation.servicePlan?.id ?? null}
        recommended={evaluation?.recommendedDecision ?? 'STYLIST_REVIEW'}
        estimate={
          evaluation
            ? {
                durationMin: evaluation.duration.totalMin,
                priceCents: evaluation.price.estimatedTotalCents,
                depositCents: evaluation.deposit.amountCents,
              }
            : null
        }
        stylists={stylists.map((stylist) => ({ id: stylist.id, name: stylist.displayName }))}
        currentStylistId={consultation.requestedStylistId}
      />
    </div>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="label-caps">{label}</dt>
      <dd className="tabular font-display text-display-sm text-ink">{value}</dd>
      {hint && <p className="text-label text-ink-subtle">{hint}</p>}
    </div>
  )
}

/** Answers are JSON. Render each shape the way a person would say it. */
function renderAnswer(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  if (Array.isArray(value)) return value.map(String).join(', ')

  /*
   * A shade reads as what the client chose, not as the object it is stored in.
   * Both halves are shown because they answer different questions: the name is
   * what they asked for, the level is what the service has to achieve.
   */
  const shade = readShadeAnswer(value)
  if (shade) return describeShade(shade.tone) ?? `Level ${shade.level}`

  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
