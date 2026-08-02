import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { unsafeDb } from '@/server/db/client'
import { installOutboxSink } from '@/server/outbox-sink'
import { JOB_REGISTRY, RECURRING } from './handlers'
import { claim, complete, enqueue, fail, type ClaimedJob } from './queue'

/**
 * The job worker: `pnpm worker`.
 *
 * A LONG-LIVED process. It holds in-flight state and drains gracefully on
 * SIGTERM, so it belongs on an always-on host — a Fly Machine, an ECS task, a
 * systemd unit — and NOT on a serverless function, where reminders would
 * silently stop. `/api/cron/[job]` exists for hosts that cannot run this.
 */

const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000)
const BATCH = Number(process.env.WORKER_BATCH_SIZE ?? 10)
const QUEUES = (process.env.WORKER_QUEUES ?? 'default').split(',')

let stopping = false
const inFlight = new Set<string>()

const log = (message: string, extra?: unknown) =>
  console.log(`[worker ${WORKER_ID}] ${message}`, extra ?? '')

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

async function run(job: ClaimedJob): Promise<void> {
  const definition = JOB_REGISTRY[job.type]
  if (!definition) {
    await fail(job, new Error(`No handler registered for job type "${job.type}"`))
    return
  }

  // Heartbeat, so the reaper does not mistake a slow job for a dead worker.
  const heartbeat = setInterval(() => {
    void unsafeDb.job
      .updateMany({ where: { id: job.id, lockedBy: WORKER_ID }, data: { lockedAt: new Date() } })
      .catch(() => {})
  }, 15_000)

  try {
    const payload = definition.schema.parse(job.payloadJson ?? {})
    await withTimeout(definition.timeoutMs, () => definition.handler(payload))
    await complete(job.id)
  } catch (err) {
    log(`job ${job.type} failed`, err instanceof Error ? err.message : err)
    await fail(job, err)
  } finally {
    clearInterval(heartbeat)
    inFlight.delete(job.id)
  }
}

/**
 * Keep the recurring sweeps topped up.
 *
 * Deduped on a time bucket, so firing this more often than necessary — or from
 * two workers at once — is a no-op rather than a double-send.
 */
async function scheduleRecurring(): Promise<void> {
  const now = Date.now()
  for (const entry of RECURRING) {
    const bucket = Math.floor(now / (entry.everyMinutes * 60_000))
    await enqueue({
      type: entry.type,
      payload: {},
      dedupeKey: `${entry.key}:${bucket}`,
      priority: 200,
    })
  }
}

async function loop(): Promise<void> {
  installOutboxSink()
  log(`started — queues=${QUEUES.join(',')} batch=${BATCH}`)

  while (!stopping) {
    try {
      await scheduleRecurring()

      const capacity = BATCH - inFlight.size
      const jobs = await claim(WORKER_ID, QUEUES, capacity)

      if (jobs.length === 0) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        continue
      }

      for (const job of jobs) {
        inFlight.add(job.id)
        void run(job)
      }

      await new Promise((r) => setTimeout(r, 100))
    } catch (err) {
      log('loop error', err instanceof Error ? err.message : err)
      await new Promise((r) => setTimeout(r, POLL_MS * 2))
    }
  }

  log(`draining ${inFlight.size} in-flight job(s)…`)
  const deadline = Date.now() + 30_000
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200))
  }

  await unsafeDb.$disconnect()
  log('stopped')
  process.exit(0)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1)
    log(`${signal} received — finishing in-flight work`)
    stopping = true
  })
}

void loop()
