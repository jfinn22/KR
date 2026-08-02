import { unsafeDb } from '@/server/db/client'
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
  tx: Prisma.TransactionClient | typeof unsafeDb = unsafeDb,
): Promise<string | null> {
  if (input.dedupeKey) {
    const existing = await tx.job.findFirst({
      where: { dedupeKey: input.dedupeKey, status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true },
    })
    if (existing) return null
  }

  const job = await tx.job.create({
    data: {
      type: input.type,
      payloadJson: input.payload as never,
      salonId: input.salonId ?? null,
      queue: input.queue ?? 'default',
      runAt: input.runAt ?? new Date(),
      priority: input.priority ?? 100,
      maxAttempts: input.maxAttempts ?? 5,
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
