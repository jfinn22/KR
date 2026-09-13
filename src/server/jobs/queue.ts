import { unsafeDb } from '@/server/db/client'
import type { TenantTx } from '@/server/db/tenant-client'
import type { Prisma } from '@prisma/client'

/**
 * A Postgres-backed job queue.
 *
 * No Redis and no broker: one fewer thing to run, and — more importantly — job
 * state lives in the same transaction boundary as the domain data, so a booking
 * and the confirmation it must send commit together or not at all.
 */

export interface EnqueueInput {
  type: string
  payload: Record<string, unknown>
  salonId?: string | null
  queue?: string
  runAt?: Date
  priority?: number
  maxAttempts?: number
  /**
   * Collapses duplicates. Re-materialising reminders after a reschedule, or a
   * cron tick firing twice, must not produce two sends.
   */
  dedupeKey?: string | null
  /**
   * What the dedupe key claims.
   *
   * `in-flight` (the default) means "there must not be two of these waiting or
   * running at once". Once the job finishes, the same key may be used again —
   * which is what makes a reminder re-materialisable after a reschedule.
   *
   * `ever` means "this unit of work has been done, full stop". Only pass it
   * when the key names something that happens exactly once — a time bucket, a
   * provider event id — because a SUCCEEDED, FAILED or DEAD row will then block
   * the key for good. Requires an index on `dedupeKey`, since the lookup can no
   * longer be narrowed to the handful of rows that are still in flight.
   */
  dedupeScope?: 'in-flight' | 'ever'
}

export interface ClaimedJob {
  id: string
  type: string
  payloadJson: unknown
  salonId: string | null
  attempts: number
  maxAttempts: number
}

export async function enqueue(
  input: EnqueueInput,
  tx: Prisma.TransactionClient | TenantTx | typeof unsafeDb = unsafeDb,
): Promise<string | null> {
  if (input.dedupeKey) {
    const existing = await tx.job.findFirst({
      where: {
        dedupeKey: input.dedupeKey,
        ...(input.dedupeScope === 'ever' ? {} : { status: { in: ['PENDING', 'RUNNING'] } }),
      },
      select: { id: true },
    })
    if (existing) return null
  }

  // Dynamic import avoids a cycle with handlers.ts, which imports enqueue.
  let definedAttempts: number | undefined
  if (input.maxAttempts == null) {
    const { JOB_REGISTRY } = await import('./handlers')
    definedAttempts = JOB_REGISTRY[input.type]?.maxAttempts
  }

  const job = await tx.job.create({
    data: {
      type: input.type,
      payloadJson: input.payload as never,
      salonId: input.salonId ?? null,
      queue: input.queue ?? 'default',
      runAt: input.runAt ?? new Date(),
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? definedAttempts ?? 5,
      dedupeKey: input.dedupeKey ?? null,
    },
    select: { id: true },
  })
  return job.id
}

/**
 * Claim a batch.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several workers run without any of them
 * blocking or handing out the same job twice — the lock and the status update
 * happen in one statement, so there is no window between selecting and claiming.
 */
export async function claim(
  workerId: string,
  queues: string[],
  limit: number,
): Promise<ClaimedJob[]> {
  if (limit <= 0) return []

  return unsafeDb.$queryRaw<ClaimedJob[]>`
    UPDATE "Job"
       SET status = 'RUNNING',
           "lockedAt" = now(),
           "lockedBy" = ${workerId},
           attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM "Job"
        WHERE status = 'PENDING'
          AND "runAt" <= now()
          AND queue = ANY(${queues})
        ORDER BY priority, "runAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
    RETURNING id, type, "payloadJson", "salonId", attempts, "maxAttempts"
  `
}

export async function complete(jobId: string): Promise<void> {
  await unsafeDb.job.update({
    where: { id: jobId },
    data: { status: 'SUCCEEDED', completedAt: new Date(), lastError: null },
  })
}

/**
 * Fail with exponential backoff, or bury the job once it is out of attempts.
 *
 * Jitter matters: without it, a provider outage produces a thundering herd of
 * retries at exactly the same instant when it recovers.
 */
export async function fail(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const dead = job.attempts >= job.maxAttempts

  const backoffMs = Math.min(2 ** job.attempts * 30_000, 6 * 3_600_000)
  const jitter = Math.floor((job.id.charCodeAt(0) % 17) * 1000)

  await unsafeDb.job.update({
    where: { id: job.id },
    data: dead
      ? { status: 'DEAD', lastError: message, completedAt: new Date() }
      : {
          status: 'PENDING',
          lastError: message,
          lockedAt: null,
          lockedBy: null,
          runAt: new Date(Date.now() + backoffMs + jitter),
        },
  })
}

/**
 * Recover jobs whose worker died mid-flight.
 *
 * Without this a crash silently strands work as RUNNING for ever.
 */
export async function reap(staleAfterMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMinutes * 60_000)
  const result = await unsafeDb.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', lockedAt: null, lockedBy: null },
  })
  return result.count
}

/**
 * Delete succeeded job rows that nothing can still be deduping against.
 *
 * SUCCEEDED only. A DEAD row is the record of something that never happened and
 * somebody has to look at; it stays.
 *
 * Nothing has ever deleted from `Job`. Every notification, every sweep and
 * every webhook delivery leaves a row behind for ever, on the table the queue
 * reads from on every claim — and `dedupeScope: 'ever'` now looks through those
 * rows too, so letting them accumulate without bound is no longer merely untidy.
 *
 * `olderThanMs` is a correctness parameter, not a taste one: deleting a
 * SUCCEEDED row whose dedupe key names a bucket that has not closed yet makes
 * that work run a second time. The caller owns that floor — see `systemReap`.
 *
 * Deletes in bounded batches and stops at `maxRows`. A backlog of millions of
 * rows drains over successive runs instead of holding one enormous transaction
 * open, which on a live queue is the difference between a quiet cleanup and a
 * stalled worker.
 */
export async function pruneCompleted(olderThanMs: number, maxRows = 20_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs)
  const batchSize = 5_000
  let deleted = 0

  while (deleted < maxRows) {
    const count = await unsafeDb.$executeRaw`
      DELETE FROM "Job"
       WHERE id IN (
         SELECT id FROM "Job"
          WHERE status = 'SUCCEEDED'
            AND "completedAt" < ${cutoff}
          LIMIT ${Math.min(batchSize, maxRows - deleted)}
       )
    `
    deleted += count
    if (count === 0) break
  }

  return deleted
}

/** Queue depth, for the health endpoint and the owner dashboard. */
export async function queueStats(): Promise<{
  pending: number
  running: number
  dead: number
  oldestPendingAt: Date | null
}> {
  const [pending, running, dead, oldest] = await Promise.all([
    unsafeDb.job.count({ where: { status: 'PENDING' } }),
    unsafeDb.job.count({ where: { status: 'RUNNING' } }),
    unsafeDb.job.count({ where: { status: 'DEAD' } }),
    unsafeDb.job.findFirst({
      where: { status: 'PENDING' },
      orderBy: { runAt: 'asc' },
      select: { runAt: true },
    }),
  ])
  return { pending, running, dead, oldestPendingAt: oldest?.runAt ?? null }
}
