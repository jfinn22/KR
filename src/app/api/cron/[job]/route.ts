import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { serverEnv } from '@/env'
import { JOB_REGISTRY } from '@/server/jobs/handlers'
import { enqueue, queueStats } from '@/server/jobs/queue'

export const dynamic = 'force-dynamic'

/**
 * Enqueue a sweep from an external scheduler.
 *
 * The worker is a long-lived process and is the right way to run jobs. This
 * exists for hosts that cannot run one — a platform cron can hit these paths on
 * a timer instead. It only ENQUEUES; the work still happens in a worker, so a
 * request timeout can never truncate a job halfway.
 *
 * Prefer `Authorization: Bearer <CRON_SECRET>`. Query-string `?secret=` is
 * still accepted for hosts that cannot set headers, but it leaks into access
 * logs and referrers — do not use it when you have a choice.
 */
export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const env = serverEnv()
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    new URL(request.url).searchParams.get('secret')

  if (!provided || !secretsEqual(provided, env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { job } = await params
  if (!JOB_REGISTRY[job]) {
    return NextResponse.json(
      { error: `Unknown job "${job}"`, known: Object.keys(JOB_REGISTRY) },
      { status: 404 },
    )
  }

  const bucket = Math.floor(Date.now() / 60_000)
  const jobId = await enqueue({
    type: job,
    payload: {},
    dedupeKey: `cron:${job}:${bucket}`,
    priority: 200,
  })

  return NextResponse.json({
    enqueued: jobId !== null,
    // null means an identical job is already pending — that is success, not an
    // error, and saying so avoids a scheduler retrying pointlessly.
    reason: jobId === null ? 'already pending' : undefined,
    stats: await queueStats(),
  })
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
