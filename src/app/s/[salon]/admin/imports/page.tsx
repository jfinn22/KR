import Link from 'next/link'
import { pageContextFor } from '@/server/auth/page'
import { importHistory, PLATFORM_CHOICES } from '@/server/services/migration/review'
import { SectionHeading, Table, TableWrap, Td, Th, Tr } from '@/components/ui/data'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { UploadForm } from './upload-form'

export const dynamic = 'force-dynamic'

/**
 * Bringing a salon's history across.
 *
 * The list is here rather than behind the upload because the reassuring thing
 * about an import is the one before it: an owner who can see that Friday's
 * attempt was undone cleanly will try again on Monday. A migration screen that
 * only ever shows a file picker asks for trust it has not earned.
 */
export default async function ImportsPage({ params }: { params: Promise<{ salon: string }> }) {
  const { salon } = await params
  const ctx = await pageContextFor(salon, 'migration.import')

  const [batches, locations] = await Promise.all([
    importHistory(ctx.salonId),
    ctx.db.location.findMany({
      where: { salonId: ctx.salonId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return (
    <div className="flex flex-col gap-12">
      <header>
        <h1 className="heading-flourish font-display text-display-lg text-ink">
          Bring your history across
        </h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          Your clients and everything they have had done, out of the platform you are leaving. We
          show you what we made of the file before anything is saved, and every import can be undone
          in one go afterwards.
        </p>
      </header>

      <section>
        <SectionHeading
          title="A new import"
          description="One file at a time. Clients and appointments in the same export is ideal; either on its own works."
        />
        <div className="mt-6">
          <UploadForm salonSlug={salon} locations={locations} platforms={[...PLATFORM_CHOICES]} />
        </div>
      </section>

      <section>
        <SectionHeading title="What you have run" description="Newest first." />
        <div className="mt-6">
          {batches.length === 0 ? (
            <EmptyState
              title="Nothing imported yet"
              description="When you run one it will be listed here, with what it created and a way back out of it."
            />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>File</Th>
                    <Th>From</Th>
                    <Th>State</Th>
                    <Th>What it did</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <Tr key={batch.id}>
                      <Td>
                        <Link
                          href={`/s/${salon}/admin/imports/${batch.id}`}
                          className="font-medium text-ink underline-offset-2 hover:underline"
                        >
                          {batch.filename}
                        </Link>
                      </Td>
                      <Td>{labelOf(batch.sourcePlatform)}</Td>
                      <Td>
                        <Badge tone={toneOf(batch.status)}>{stateOf(batch.status)}</Badge>
                      </Td>
                      <Td>{describeCounts(batch.countsJson)}</Td>
                      <Td>{batch.createdAt.toLocaleDateString()}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </section>
    </div>
  )
}

function labelOf(platform: string): string {
  return PLATFORM_CHOICES.find((choice) => choice.value === platform)?.label ?? platform
}

/** The owner's words for the state, not the enum's. */
function stateOf(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Uploaded'
    case 'REVIEWING':
      return 'Waiting on you'
    case 'COMMITTING':
      return 'Running'
    case 'COMPLETED':
      return 'Imported'
    case 'FAILED':
      return 'Stopped'
    case 'UNDONE':
      return 'Undone'
    default:
      return status
  }
}

function toneOf(status: string): 'info' | 'warn' | 'danger' | 'neutral' | 'success' {
  if (status === 'COMPLETED') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'REVIEWING' || status === 'COMMITTING') return 'warn'
  return 'neutral'
}

function describeCounts(counts: unknown): string {
  if (!counts || typeof counts !== 'object') return '—'
  const value = counts as { clientsCreated?: number; appointmentsCreated?: number }
  const clients = value.clientsCreated ?? 0
  const appointments = value.appointmentsCreated ?? 0
  return `${clients} client${clients === 1 ? '' : 's'}, ${appointments} visit${
    appointments === 1 ? '' : 's'
  }`
}
