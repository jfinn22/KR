import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContextFor } from '@/server/auth/page'
import { importReview } from '@/server/services/migration/review'
import { DomainError } from '@/server/errors'
import { SectionHeading, Stat, Table, TableWrap, Td, Th, Tr } from '@/components/ui/data'
import { Badge } from '@/components/ui/badge'
import { ReviewForm, UndoPanel } from './review-form'

export const dynamic = 'force-dynamic'

/**
 * What we made of the file.
 *
 * Owners do not trust a single "Migrate now" button, and the research is
 * unanimous about why: a black box that swallows their entire history and says
 * "done" is a scary thing to press. So this screen shows the work first — the
 * columns we recognised, the rows we could not read and their line numbers, and
 * three real rows exactly as they came out — and only then offers a button.
 */
export default async function ImportReviewPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContextFor(salon, 'migration.import')

  let review
  try {
    review = await importReview(ctx.salonId, id)
  } catch (error) {
    if (error instanceof DomainError && error.code === 'NOT_FOUND') notFound()
    throw error
  }

  const { batch, parsed, summary } = review
  const done = batch.status === 'COMPLETED' || batch.status === 'UNDONE'

  return (
    <div className="flex flex-col gap-12">
      <header>
        <Link
          href={`/s/${salon}/admin/imports`}
          className="text-secondary text-ink-muted underline-offset-2 hover:underline"
        >
          ← All imports
        </Link>
        <h1 className="heading-flourish mt-3 font-display text-display-lg text-ink">
          {batch.filename}
        </h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          {done
            ? 'This file has been imported. Everything it created is listed below, and can be taken back out in one go.'
            : 'Here is what we read. Nothing has been saved to your salon yet.'}
        </p>
      </header>

      <section className="grid gap-6 sm:grid-cols-4">
        <Stat label="Rows" value={String(summary.totalRows)} />
        <Stat label="Contactable clients" value={String(summary.usableClients)} />
        <Stat label="Appointments" value={String(summary.usableAppointments)} />
        <Stat label="Rows with a problem" value={String(summary.rowsWithProblems)} />
      </section>

      {summary.blockers.length > 0 && (
        <section className="rounded-lg border-l-4 border-l-danger bg-danger-soft px-5 py-4">
          <h2 className="font-display text-display-sm text-ink">Before this can be imported</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {summary.blockers.map((blocker) => (
              <li key={blocker} className="text-secondary text-ink">
                {blocker}
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.warnings.length > 0 && (
        <section className="rounded-lg border-l-4 border-l-gold-500 bg-gold-100/50 px-5 py-4">
          <h2 className="font-display text-display-sm text-ink">Worth knowing</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {summary.warnings.map((warning) => (
              <li key={warning} className="text-secondary text-ink">
                {warning}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading
          title="What each column was taken to mean"
          description="Anything we did not recognise is listed at the end and will not be imported."
        />
        <div className="mt-6 flex flex-wrap gap-2">
          {parsed.columns.map((column) => (
            <span
              key={column.header}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-secondary"
            >
              <span className="text-ink">{column.header}</span>
              <span className="text-ink-muted">→ {FIELD_LABELS[column.field] ?? column.field}</span>
              {column.confidence < 1 && <Badge tone="warn">a guess</Badge>}
            </span>
          ))}
          {parsed.unmappedHeaders.map((header) => (
            <span
              key={header}
              className="inline-flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-1.5 text-secondary text-ink-muted"
            >
              {header} → not imported
            </span>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          title="The first few rows, as we read them"
          description="Three real rows settle more doubt than any amount of column mapping."
        />
        <div className="mt-6">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Line</Th>
                  <Th>Client</Th>
                  <Th>Phone</Th>
                  <Th>When</Th>
                  <Th>Service</Th>
                  <Th>Who</Th>
                  <Th>Price</Th>
                </tr>
              </thead>
              <tbody>
                {review.sample.map((row) => (
                  <Tr key={row.line}>
                    <Td>{row.line}</Td>
                    <Td>{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</Td>
                    <Td>{row.phone ?? <span className="text-ink-muted">could not read</span>}</Td>
                    <Td>{row.appointmentDate ?? '—'}</Td>
                    <Td>{row.serviceName ?? '—'}</Td>
                    <Td>{row.stylistName ?? '—'}</Td>
                    <Td>{row.priceCents === null ? '—' : formatCents(row.priceCents)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      </section>

      {done ? (
        <section>
          <SectionHeading
            title="What it did"
            description="And how to take it back out again."
          />
          <div className="mt-6 flex flex-col gap-6">
            <CountsPanel counts={batch.countsJson} />
            <UndoPanel salonSlug={salon} batchId={batch.id} undone={batch.status === 'UNDONE'} />
          </div>
        </section>
      ) : (
        <section>
          <SectionHeading
            title="Your decisions"
            description="One per name in the file, not one per row."
          />
          <div className="mt-6">
            <ReviewForm
              salonSlug={salon}
              batchId={batch.id}
              dateOrderAmbiguous={parsed.dateOrderAmbiguous}
              initialDateOrder={parsed.dateOrder}
              initialCallingCode={review.defaultCallingCode}
              services={review.services}
              stylists={review.stylists}
              salonServices={review.salonServices}
              salonStylists={review.salonStylists}
              blockers={summary.blockers}
            />
          </div>
        </section>
      )}
    </div>
  )
}

function CountsPanel({ counts }: { counts: unknown }) {
  if (!counts || typeof counts !== 'object') {
    return <p className="text-secondary text-ink-muted">No record of what it created.</p>
  }
  const value = counts as Record<string, number>
  const lines: [string, number | undefined][] = [
    ['Clients created', value.clientsCreated],
    ['Matched to clients you already had', value.clientsMatched],
    ['Appointments imported', value.appointmentsCreated],
    ['Upcoming ones booked in', value.appointmentsBooked],
    ['Upcoming ones the chair was taken for', value.appointmentsClashed],
    ['Appointments skipped', value.appointmentsSkipped],
    ['Imported without one of your services', value.appointmentsUnmappedService],
  ]

  return (
    <dl className="grid max-w-xl gap-3 sm:grid-cols-2">
      {lines.map(([label, number]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-secondary text-ink-muted">{label}</dt>
          <dd className="font-display text-display-sm text-ink">{number ?? 0}</dd>
        </div>
      ))}
    </dl>
  )
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'name',
  firstName: 'first name',
  lastName: 'surname',
  email: 'email',
  phone: 'phone',
  clientNotes: 'notes about the client',
  clientSince: 'client since',
  appointmentDate: 'date',
  appointmentTime: 'time',
  serviceName: 'service',
  stylistName: 'who did it',
  durationMin: 'how long',
  priceCents: 'price',
  appointmentStatus: 'what happened',
  appointmentNotes: 'notes on the visit',
  formulaText: 'formula',
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}
