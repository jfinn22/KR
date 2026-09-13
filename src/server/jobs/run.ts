import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { unsafeDb } from '@/server/db/client'
import { JOB_REGISTRY, RECURRING } from './handlers'
import { claim, complete, enqueue, fail, type ClaimedJob } from './queue'

/**
 * Running a job, independent of what is doing the running.
 *
 * There are two callers and they live in different worlds. `pnpm worker` is a
 * long-lived process that holds several jobs in flight at once and drains on
 * SIGTERM. `/api/cron/drain` is a serverless function with a hard wall-clock
 * limit and no life after the response is sent.
 *
 * What they share is everything that matters for correctness: claim with a
 * lock, validate the payload, run under a timeout, heartbeat so the reaper does
 * not mistake slow for dead, and mark the outcome exactly once. That belongs in
 * one place — the alternative is two copies of the retry and timeout rules
 * drifting apart, which is the kind of bug that only shows up as a client
 * getting two text messages.
 */

/** A worker identity that says which kind of runner it was, for the lock column. */
export function newRunnerId(kind: 'worker' | 'drain'): string {
  return `${kind}:${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
}

async function withTimeout<T>(ms: number, work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Job timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface JobOutcome {
  ok: boolean
  /** Present when the job failed; already recorded on the row. */
  error?: string
}

/**
 * Run one claimed job to a recorded outcome.
 *
 * Never throws: a runner looping over a batch must not lose the rest of the
 * batch because one handler blew up.
 */
export async function runJob(job: ClaimedJob, runnerId: string): Promise<JobOutcome> {
  const definition = JOB_REGISTRY[job.type]
  if (!definition) {
    const error = `No handler registered for job type "${job.type}"`
    await fail(job, new Error(error))
    return { ok: false, error }
  }

  // Heartbeat, so the reaper does not mistake a slow job for a dead runner.
  const heartbeat = setInterval(() => {
    void unsafeDb.job
      .updateMany({ where: { id: job.id, lockedBy: runnerId }, data: { lockedAt: new Date() } })
      .catch(() => {})
  }, 15_000)

  try {
    const payload = definition.schema.parse(job.payloadJson ?? {})
    await withTimeout(definition.timeoutMs, () => definition.handler(payload))
    await complete(job.id)
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    /*
     * A timeout does not cancel the handler — Promise.race leaves it running.
     * Re-queueing a side-effecting job (SMS, webhook) after a timeout is how
     * clients get two texts. `fail` buries it once attempts run out; until then
     * each handler's own idempotency (dedupe keys, claimed outbox rows) is what
     * makes the retry safe.
     */
    await fail(job, err)
    return { ok: false, error }
  } finally {
    clearInterval(heartbeat)
  }
}

/**
 * Keep the recurring sweeps topped up.
 *
 * The dedupe key names a time bucket, so the question this has to ask the
 * database is "has this bucket already been done?" — not "is a copy in flight
 * right now?", which is what `enqueue` asks by default and what every other
 * caller wants. Scoping to PENDING/RUNNING is why the worker used to re-enqueue
 * all thirteen sweeps the instant the previous copies succeeded:
 * `calibration.recompute`, declared once a day, ran several times a second on an
 * idle queue.
 *
 * With `dedupeScope: 'ever'` the row itself holds the bucket, so calling this on
 * every loop iteration — or from `/api/cron/drain` on a timer — costs one
 * indexed lookup per sweep and enqueues nothing until the interval has genuinely
 * elapsed.
 *
 * The check and the insert are still two statements, so two runners hitting the
 * same bucket rollover in the same millisecond can both insert. That is the
 * pre-existing window and it is deliberately left: a duplicate sweep is
 * indistinguishable from a retry, which every handler already has to survive.
 */
export async function scheduleRecurring(): Promise<void> {
  const now = Date.now()
  for (const entry of RECURRING) {
    const bucket = Math.floor(now / (entry.everyMinutes * 60_000))
    await enqueue({
      type: entry.type,
      payload: {},
      dedupeKey: `${entry.key}:${bucket}`,
      dedupeScope: 'ever',
      priority: 200,
    })
  }
}

export interface DrainResult {
  claimed: number
  succeeded: number
  failed: number
  /** True when work was left on the queue because the time budget ran out. */
  budgetExhausted: boolean
}

/**
 * Work the queue until it is empty or the clock runs out.
 *
 * For hosts with no always-on process. Two rules keep this honest on a platform
 * that can freeze the instance the moment a response is sent:
 *
 * Jobs are awaited, never fired and forgotten. A serverless function that
 * responds while work is still in flight has that work killed mid-write.
 *
 * A new job is only started with `reserveMs` still on the clock, so the common
 * case finishes inside the budget. When that guess is wrong the job is left
 * RUNNING with a lock, and `system.reap` — already in the recurring list —
 * returns it to the queue a few minutes later. That is the same recovery path a
 * crashed long-lived worker uses; serverless just reaches it more often.
 */
export async function drainQueue(opts: {
  runnerId: string
  queues: string[]
  budgetMs: number
  reserveMs: number
  batchSize: number
}): Promise<DrainResult> {
  const deadline = Date.now() + opts.budgetMs
  const result: DrainResult = { claimed: 0, succeeded: 0, failed: 0, budgetExhausted: false }

  for (;;) {
    if (Date.now() + opts.reserveMs >= deadline) {
      result.budgetExhausted = true
      return result
    }

    const jobs = await claim(opts.runnerId, opts.queues, opts.batchSize)
    if (jobs.length === 0) return result
    result.claimed += jobs.length

    for (const job of jobs) {
      const outcome = await runJob(job, opts.runnerId)
      if (outcome.ok) result.succeeded += 1
      else result.failed += 1

      if (Date.now() + opts.reserveMs >= deadline) {
        result.budgetExhausted = true
        return result
      }
    }
  }
}
