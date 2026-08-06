import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { attachmentRate, firstTimerInterventions, rebookReport } from '@/server/services/retention'
import { unhappyCheckIns } from '@/server/services/check-in'
import { ResolveCheckInButton } from './resolve-button'
import { lastDays } from '@/server/services/analytics'
import { FIRST_TIMER_GRACE_DAYS, REBOOK_WINDOW_DAYS } from '@/domain/retention/windows'
import { SectionHeading, Stat, Table, TableWrap, Td, Th, Tr } from '@/components/ui/data'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'

export const dynamic = 'force-dynamic'

/**
 * Who the salon is losing, and who keeps people.
 *
 * A first visit that never became a second is the most expensive thing that
 * happens quietly in a salon — the acquisition is already paid for, there is no
 * complaint on file, and nothing appears in a diary to be missing. This screen
 * exists to make that visible while somebody can still pick up the phone.
 *
 * Deliberately not on the insights page. Insights is a thing an owner reads;
 * this is a thing the desk works through, and a list you act on does not belong
 * behind a chart.
 */
export default async function RetentionPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'report.viewSalon')

  const range = lastDays(180, ctx.timezone, ctx.now)
  const [atRisk, rebook, attachment, unhappy] = await Promise.all([
    firstTimerInterventions(ctx.salonId, ctx.now),
    rebookReport(ctx.salonId, range, ctx.now),
    attachmentRate(ctx.salonId, lastDays(90, ctx.timezone, ctx.now)),
    unhappyCheckIns(ctx.salonId),
  ])

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">Keeping people</h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          The clients you already have, and whether they came back. A first visit that never became
          a second is the most expensive thing that happens quietly in a salon.
        </p>
      </header>

      {unhappy.length > 0 && (
        <section>
          <SectionHeading
            title="Somebody is not happy"
            description="They tapped “not quite right” on their check-in. The whole value of asking three days later is that somebody rings them back inside the week."
          />
          <ul className="mt-6 flex flex-col gap-4">
            {unhappy.map((row) => (
              <li
                key={row.id}
                className="rounded-lg border-l-4 border-l-warn bg-warn-soft px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <Link
                    href={`/s/${salon}/desk/clients/${row.clientProfile.id}`}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {`${row.clientProfile.firstName} ${row.clientProfile.lastName}`.trim()}
                  </Link>
                  <span className="text-secondary text-ink-muted">
                    {row.clientProfile.phone ?? 'No number on file'}
                    {row.appointment.primaryStylist &&
                      ` · in with ${row.appointment.primaryStylist.displayName}`}
                  </span>
                </div>
                {row.note && <p className="mt-2 text-body text-ink">“{row.note}”</p>}
                <ResolveCheckInButton salonSlug={salon} checkInId={row.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading
          title="First-timers who have not been back"
          description={`Seen once, more than ${FIRST_TIMER_GRACE_DAYS} days ago, with nothing in the diary. Early enough that a call still works.`}
        />
        <div className="mt-6">
          {atRisk.length === 0 ? (
            <EmptyState
              title="Nobody is slipping"
              description="Every first-timer from the last few months has either been back or has something booked."
            />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Client</Th>
                    <Th>First seen</Th>
                    <Th>Who did it</Th>
                    <Th>How to reach them</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((client) => (
                    <Tr key={client.clientProfileId}>
                      <Td>
                        <span className="font-medium text-ink">
                          {`${client.firstName} ${client.lastName}`.trim()}
                        </span>
                      </Td>
                      <Td>
                        {client.daysSince} days ago
                        {client.daysSince > FIRST_TIMER_GRACE_DAYS * 2 && (
                          <Badge tone="warn" className="ml-2">
                            Getting late
                          </Badge>
                        )}
                      </Td>
                      <Td>{client.stylistName ?? '—'}</Td>
                      <Td>{client.phone ?? client.email ?? 'No contact details'}</Td>
                      <Td>
                        <Link
                          href={`/s/${salon}/desk/clients/${client.clientProfileId}`}
                          className="text-secondary text-ink underline-offset-2 hover:underline"
                        >
                          Open
                        </Link>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </section>

      <section>
        <SectionHeading
          title="Who people come back to"
          description={`Of the visits that have had ${REBOOK_WINDOW_DAYS} days to be followed by another, how many were. A visit that has not had its window yet is not counted — it has not failed, it has not been asked.`}
        />
        <div className="mt-6">
          {rebook.length === 0 ? (
            <EmptyState
              title="Not enough history yet"
              description="Come back once there are visits old enough to have been followed by another."
            />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Stylist</Th>
                    <Th>Came back</Th>
                    <Th>Of</Th>
                    <Th>Rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {rebook.map((row) => (
                    <Tr key={row.stylistProfileId}>
                      <Td>{row.displayName}</Td>
                      <Td className="tabular">{row.returned}</Td>
                      <Td className="tabular">{row.eligible}</Td>
                      <Td className="tabular">
                        {/* Null, never 0 — "we cannot say" and "nobody came back"
                            are different things to put next to somebody's name. */}
                        {row.rate === null ? '—' : `${Math.round(row.rate * 100)}%`}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </section>

      <section>
        <SectionHeading
          title="Aftercare"
          description="How much of what your stylists recommended was actually bought. A measure of whether the conversation is happening — not a target."
        />
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          <Stat label="Recommended" value={String(attachment.recommended)} />
          <Stat label="Bought" value={String(attachment.purchased)} />
          <Stat
            label="Of what was suggested"
            value={attachment.rate === null ? '—' : `${Math.round(attachment.rate * 100)}%`}
          />
        </div>
      </section>
    </div>
  )
}
