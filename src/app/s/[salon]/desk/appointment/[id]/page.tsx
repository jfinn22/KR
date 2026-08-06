import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { handoffCard } from '@/server/services/handoff'
import { aftercareFor } from '@/server/services/retention'
import { costOfService } from '@/server/services/backbar'
import { formulaFor } from '@/server/services/formulas'
import { AftercareForm } from './aftercare-form'
import { BackbarForm } from './backbar-form'
import { FormulaForm } from './formula-form'
import { JourneyLadder } from '@/components/salon/journey-ladder'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeading } from '@/components/ui/data'
import { requirementsFor } from '@/server/services/requirements'
import { RequirementsPanel } from './requirements-panel'
import { formatDayHeading, formatMinutes, formatTime, localDateIn } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The handoff card.
 *
 * A consultation is done once, by whoever was free, possibly six weeks before
 * the appointment and possibly by somebody who is off that day. What they
 * learned is spread across nine tables, and the stylist standing at the chair
 * has none of it unless they go and look in nine places.
 *
 * They will not. They will ask the client, who will say "just a bit off the
 * ends" and not mention the box dye — and the whole consultation was for
 * nothing.
 *
 * The ORDER on this screen is the design, and it is the same order a good
 * stylist's head works in:
 *
 *   1. anything that stops the appointment
 *   2. what was on the hair last time
 *   3. what they are asking for, and where this visit sits in the plan
 *   4. everything else
 *
 * A screen that opens with the client's visit count and buries a missing patch
 * test three sections down is worse than no screen, because it looks thorough.
 */

const SEVERITY_TONE = {
  BLOCKER: 'danger',
  HIGH: 'danger',
  CAUTION: 'warn',
  INFO: 'info',
} as const

export default async function HandoffPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContextFor(salon, 'appointment.viewAny')

  const card = await handoffCard(ctx.salonId, id)

  const [aftercare, cost, todaysFormula, products, requirements] = await Promise.all([
    aftercareFor(ctx.salonId, id),
    costOfService(ctx.salonId, id),
    /*
     * This appointment's own formula, not the handoff card's `lastFormula` —
     * that one is deliberately the most recent mix from any visit, which is the
     * right thing to read before starting and the wrong thing to cost.
     */
    formulaFor(ctx.salonId, id),
    ctx.db.retailProduct.findMany({
      where: { salonId: ctx.salonId, isActive: true },
      select: { id: true, name: true, brand: true },
      orderBy: { name: 'asc' },
      take: 30,
    }),
    /*
     * Read after the card, because a requirement hangs off the consultation the
     * card resolves. These are the things the engine asked for before this work
     * could happen — and until now nothing on any screen could answer one.
     */
    requirementsFor(ctx.salonId, { consultationId: card.appointment.consultationId ?? undefined }),
  ])
  const { appointment, client, stoppers, lastFormula, references, photos, journey, plan } = card

  const tz = ctx.timezone
  const live = stoppers.filter((s) => !s.overriddenBy)
  const handled = stoppers.filter((s) => s.overriddenBy)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/s/${salon}/desk`}>← Today</Link>
        </Button>
      </div>

      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-display-lg text-ink">{client.name}</h1>
          {client.completedVisits === 0 && <Badge tone="info">First visit</Badge>}
          {client.noShowCount >= 2 && <Badge tone="danger">Repeat no-shows</Badge>}
        </div>
        <p className="tabular mt-2 text-body text-ink">
          {formatDayHeading(localDateIn(tz, appointment.startsAt), tz)} ·{' '}
          {formatTime(appointment.startsAt.toISOString(), tz)}–
          {formatTime(appointment.endsAt.toISOString(), tz)} ·{' '}
          {formatMinutes(appointment.estimatedDurationMin)}
        </p>
        <p className="mt-1 text-body text-ink-muted">
          {appointment.serviceNames.join(' + ')}
          {plan && plan.total > 1 && ` · visit ${plan.sequence} of ${plan.total}`}
        </p>
        {/*
         * Only when it was somebody else. "Consulted by Wren" on Wren's own
         * appointment costs a glance and says nothing.
         */}
        {appointment.consultedBy && (
          <p className="mt-1 text-secondary text-ink-muted">
            Consulted by {appointment.consultedBy}.
          </p>
        )}
      </header>

      {requirements.length > 0 && (
        <section>
          <SectionHeading
            title="What has to happen first"
            description="Raised by the consultation. A strand test can be recorded here; going ahead without one needs a written reason."
          />
          <div className="mt-4">
            <RequirementsPanel
              salonSlug={salon}
              clientProfileId={client.id}
              consultationId={appointment.consultationId}
              requirements={requirements.map((requirement) => ({
                id: requirement.id,
                kind: requirement.kind,
                rationale: requirement.rationale,
                status: requirement.status,
                waiveReason: requirement.waiveReason,
              }))}
            />
          </div>
        </section>
      )}

      {/* --- 1. Anything that stops the appointment --------------------------- */}
      {(live.length > 0 || client.priorReactionToColor || client.allergies.length > 0) && (
        <section>
          <SectionHeading title="Before you start" />
          <div className="mt-4 flex flex-col gap-3">
            {/*
             * A recorded reaction goes above the engine's own flags. The engine
             * reasons about risk; this is a thing that already happened to this
             * person, and it outranks any inference.
             */}
            {client.priorReactionToColor && (
              <div className="rounded-lg border border-line bg-danger-soft p-5">
                <p className="text-body font-medium text-ink">
                  This client has reacted to colour before.
                </p>
              </div>
            )}

            {client.allergies.length > 0 && (
              <div className="rounded-lg border border-line bg-danger-soft p-5">
                <p className="label-caps mb-1">Allergies</p>
                <p className="text-body text-ink">{client.allergies.join(', ')}</p>
              </div>
            )}

            {live.map((stopper, index) => (
              <div
                key={`${stopper.kind}-${index}`}
                className="rounded-lg border border-line bg-warn-soft p-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[stopper.severity]}>
                    {stopper.severity.toLowerCase()}
                  </Badge>
                  <p className="text-body font-medium text-ink">{stopper.title}</p>
                </div>
                <p className="mt-2 text-body text-ink-muted">{stopper.detail}</p>
              </div>
            ))}
          </div>

          {/*
           * Overridden flags are shown, not hidden. "Somebody decided this was
           * fine" is a different thing from "this never came up", and the
           * stylist about to do the work is entitled to know which.
           */}
          {handled.length > 0 && (
            <div className="mt-4 rounded-lg border border-line p-5">
              <p className="label-caps mb-2">Already signed off</p>
              <ul className="flex flex-col gap-2">
                {handled.map((stopper, index) => (
                  <li key={`handled-${index}`} className="text-secondary text-ink-muted">
                    <span className="text-ink">{stopper.title}</span>
                    {stopper.overrideReason ? ` — ${stopper.overrideReason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* --- 2. What was on the hair last time -------------------------------- */}
      <section>
        <SectionHeading
          title="Last time"
          description="What actually went on the hair, and how it came out."
        />
        {lastFormula ? (
          <div className="mt-4 rounded-lg border border-line p-5">
            <p className="text-secondary text-ink-muted">
              {formatDayHeading(localDateIn(tz, lastFormula.at), tz)} · {lastFormula.stylistName} ·{' '}
              {lastFormula.purpose.replace(/_/g, ' ').toLowerCase()}
            </p>

            <ul className="mt-3 flex flex-col gap-1">
              {lastFormula.components.map((component, index) => (
                <li key={index} className="tabular text-body text-ink">
                  {component.product}
                  {component.parts != null && ` · ${component.parts} parts`}
                  <span className="ml-2 text-ink-muted">{component.role.toLowerCase()}</span>
                </li>
              ))}
            </ul>

            <p className="tabular mt-3 text-secondary text-ink-muted">
              {[
                lastFormula.developerVolume != null && `${lastFormula.developerVolume} vol`,
                lastFormula.ratio,
                lastFormula.processingTimeMin != null &&
                  `${lastFormula.processingTimeMin} min`,
                lastFormula.technique,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {lastFormula.applicationNotes && (
              <p className="mt-3 whitespace-pre-line text-body text-ink">
                {lastFormula.applicationNotes}
              </p>
            )}
            {lastFormula.resultNotes && (
              <p className="mt-2 text-body text-ink-muted">
                How it came out: {lastFormula.resultNotes}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-body text-ink-muted">
            Nothing on file. If this is colour, write the formula down at the end — the next
            person doing this hair will be reading this box.
          </p>
        )}
      </section>

      {/* --- 3. What they are asking for -------------------------------------- */}
      {(references.length > 0 || plan?.notesToClient || journey?.worthShowing) && (
        <section>
          <SectionHeading title="What they want" />

          {plan?.targetShade && (
            <p className="mt-3 text-body text-ink">
              Asked for <span className="font-medium">{plan.targetShade}</span>.
            </p>
          )}

          {plan?.notesToClient && (
            <div className="mt-4 rounded-lg border border-line p-5">
              <p className="label-caps mb-1">What they were told</p>
              <p className="whitespace-pre-line text-body text-ink">{plan.notesToClient}</p>
            </div>
          )}

          {references.length > 0 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {references.map((photo) => (
                <article key={photo.id} className="overflow-hidden rounded-lg border border-line">
                  {photo.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt="" className="aspect-[4/3] w-full object-cover" />
                  )}
                  <div className="flex flex-wrap gap-1.5 p-3">
                    {photo.attributes.map((attribute) => (
                      <Badge key={attribute.key} tone="gold">
                        {attribute.key.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}

          {journey?.worthShowing && (
            <div className="mt-6">
              <JourneyLadder journey={journey} audience="staff" />
            </div>
          )}
        </section>
      )}

      {/* --- 4. Everything else ----------------------------------------------- */}
      {photos.length > 0 && (
        <section>
          <SectionHeading
            title="Their hair, as they sent it"
            description="Taken at home, in their own light. Worth a look before you judge the tone in here."
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {photos.map((photo) => (
              <figure key={photo.id} className="overflow-hidden rounded-lg border border-line">
                {photo.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.url} alt="" className="aspect-[4/3] w-full object-cover" />
                )}
                <figcaption className="p-2 text-label text-ink-muted">
                  {photo.view.replace(/_/g, ' ').toLowerCase()}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {(client.internalNotes || appointment.internalNote || appointment.clientNote) && (
        <section>
          <SectionHeading title="Notes" />
          <div className="mt-4 flex flex-col gap-3">
            {appointment.clientNote && (
              <div className="rounded-lg border border-line p-5">
                <p className="label-caps mb-1">From the client, about this visit</p>
                <p className="whitespace-pre-line text-body text-ink">{appointment.clientNote}</p>
              </div>
            )}
            {appointment.internalNote && (
              <div className="rounded-lg border border-line p-5">
                <p className="label-caps mb-1">About this visit</p>
                <p className="whitespace-pre-line text-body text-ink">
                  {appointment.internalNote}
                </p>
              </div>
            )}
            {client.internalNotes && (
              <div className="rounded-lg border border-line p-5">
                <p className="label-caps mb-1">About this client</p>
                <p className="whitespace-pre-line text-body text-ink">{client.internalNotes}</p>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display text-display-sm text-ink">What you mixed</h2>
        <p className="mt-1 max-w-prose text-secondary text-ink-muted">
          Written here, it reaches three places at once: the next person to do this hair, the
          client&rsquo;s own record, and the cost below.
        </p>
        <div className="mt-5">
          <FormulaForm
            salonSlug={salon}
            appointmentId={appointment.id}
            products={products}
            initial={
              todaysFormula
                ? {
                    purpose: todaysFormula.purpose,
                    developerVolume: todaysFormula.developerVolume,
                    ratio: todaysFormula.ratio,
                    processingTimeMin: todaysFormula.processingTimeMin,
                    applicationNotes: todaysFormula.applicationNotes,
                    components: todaysFormula.components.map((c) => ({
                      productName: c.productName ?? '',
                      shadeCode: c.shadeCode,
                      parts: c.parts === null ? null : Number(c.parts),
                      retailProductId: c.retailProductId,
                    })),
                  }
                : null
            }
          />
        </div>
      </section>

      <section>
        <h2 className="font-display text-display-sm text-ink">What it cost</h2>
        <p className="mt-1 max-w-prose text-secondary text-ink-muted">
          Two numbers at the bowl. Everything else comes off the formula, and what was left over is
          the half a salon can actually do something about.
        </p>
        <div className="mt-5">
          <BackbarForm
            salonSlug={salon}
            appointmentId={appointment.id}
            formulaId={todaysFormula?.id ?? null}
            cost={
              cost
                ? {
                    lines: cost.lines,
                    totalCents: cost.totalCents,
                    wasteCents: cost.wasteCents,
                    marginPct: cost.margin?.marginPct ?? null,
                    incomplete: cost.incomplete,
                  }
                : null
            }
          />
        </div>
      </section>

      <section>
        <h2 className="font-display text-display-sm text-ink">Afterwards</h2>
        <p className="mt-1 max-w-prose text-secondary text-ink-muted">
          Written now, while you still remember why. The reason is what makes a product
          recommendation aftercare rather than a sale.
        </p>
        <div className="mt-5">
          <AftercareForm
            salonSlug={salon}
            appointmentId={appointment.id}
            products={products}
            initialAdvice={aftercare.advice}
            initialProducts={aftercare.recommendations.map((rec) => ({
              id: rec.id,
              name: rec.retailProduct.name,
              reason: rec.reason,
              status: rec.status,
            }))}
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Button asChild variant="secondary">
          <Link href={`/s/${salon}/desk/clients/${client.id}`}>Full client record</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/s/${salon}/desk/checkout/${appointment.id}`}>Check out</Link>
        </Button>
      </div>
    </div>
  )
}
