import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { serverEnv } from '@/env'
import { installOutboxSink } from '@/server/outbox-sink'
import { queueStats } from '@/server/jobs/queue'
import { drainQueue, newRunnerId, scheduleRecurring } from '@/server/jobs/run'

/**
 * Work the job queue from a scheduler, for hosts with no always-on process.
 *
 * `pnpm worker` is the right way to run jobs and this is not a replacement for
 * it — it is what makes a serverless deployment honest. Without something
 * draining the queue, `outbox.dispatch` never sends a confirmation,
 * `hold.expire` never releases a slot somebody abandoned, and `waitlist.match`
 * never offers a cancellation to the next person. Nothing errors. The product
 * just quietly stops keeping its promises.
 *
 * Unlike `/api/cron/[job]`, which only enqueues, this one RUNS the work. That
 * is a deliberate difference: on a platform where nothing is always on, a route
 * that only enqueues is a route that fills a queue nobody empties.
 *
 * GET as well as POST because platform schedulers — Vercel Cron, GitHub
 * Actions, cron-job.org — issue a GET and cannot all be persuaded otherwise.
 */

export const dynamic = 'force-dynamic'

/*
 * The ceiling the platform will allow this function. The budget below has to
 * stay under it: a function killed at the wall clock leaves whatever it was
 * running locked as RUNNING, and although `system.reap` recovers those a few
 * minutes later, routinely relying on that turns every sweep into a retry.
 */
export const maxDuration = 60

const BUDGET_MS = 45_000
/** Do not start another job without this much clock left. */
const RESERVE_MS = 10_000
const BATCH = 5

async function handle(request: Request): Promise<NextResponse> {
  const env = serverEnv()

  /*
   * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when that variable
   * is set on the project. The query-string form is accepted for schedulers
   * that cannot set headers, but it leaks into access logs and referrers.
   */
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    new URL(request.url).searchParams.get('secret')

  if (!provided || !secretsEqual(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The mock sms and email adapters write to `DevOutbox` through this sink.
  // Without it a dispatched notification is built and then dropped.
  installOutboxSink()

  // Top up the recurring sweeps first, so this single endpoint is the whole
  // scheduler: one timer hitting one URL keeps every periodic job running.
  await scheduleRecurring()

  const result = await drainQueue({
    runnerId: newRunnerId('drain'),
    queues: (process.env.WORKER_QUEUES ?? 'default').split(','),
    budgetMs: BUDGET_MS,
    reserveMs: RESERVE_MS,
    batchSize: BATCH,
  })

  return NextResponse.json({ ...result, stats: await queueStats() })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
