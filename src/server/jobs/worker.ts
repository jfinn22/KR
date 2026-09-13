import os from 'node:os'
import { unsafeDb } from '@/server/db/client'
import { installOutboxSink } from '@/server/outbox-sink'
import { claim } from './queue'
import { newRunnerId, runJob, scheduleRecurring } from './run'

/**
 * The job worker: `pnpm worker`.
 *
 * A LONG-LIVED process. It holds in-flight state and drains gracefully on
 * SIGTERM, so it belongs on an always-on host — a Fly Machine, an ECS task, a
 * systemd unit — and NOT on a serverless function, where reminders would
 * silently stop.
 *
 * `/api/cron/drain` is the answer for hosts that cannot run this: same job
 * execution, same retry rules — both call `runJob` — but bounded by a wall
 * clock and driven by a platform scheduler instead of a loop.
 *
 * What lives here rather than in `run.ts` is only what a long-lived process
 * has and a function does not: concurrency across several jobs, a poll
 * interval, and finishing what it started when the host asks it to stop.
 */

const WORKER_ID = newRunnerId('worker')
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000)
const BATCH = Number(process.env.WORKER_BATCH_SIZE ?? 10)
const QUEUES = (process.env.WORKER_QUEUES ?? 'default').split(',')

let stopping = false
const inFlight = new Set<string>()

const log = (message: string, extra?: unknown) =>
  console.log(`[worker ${os.hostname()}] ${message}`, extra ?? '')

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
        void runJob(job, WORKER_ID)
          .then((outcome) => {
            if (!outcome.ok) log(`job ${job.type} failed`, outcome.error)
          })
          .finally(() => inFlight.delete(job.id))
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
