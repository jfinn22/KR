import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { RECURRING } from '@/server/jobs/handlers'
import { complete, enqueue, pruneCompleted } from '@/server/jobs/queue'
import { scheduleRecurring } from '@/server/jobs/run'

/**
 * A daily sweep running once a day.
 *
 * `scheduleRecurring` deduped on a key that encodes a time bucket, but
 * `enqueue` only looked for PENDING and RUNNING copies of that key. The moment
 * a sweep succeeded the key was free again, so the worker — which calls
 * `scheduleRecurring` on every loop iteration — re-enqueued all thirteen of
 * them, ran them, and re-enqueued them again. 2,299 jobs in fifteen seconds on
 * an idle database, with `calibration.recompute` and `membership.sweep` among
 * them: jobs whose declared interval is a day.
 *
 * The serverless path never showed it, because `/api/cron/drain` is called on a
 * timer rather than in a loop. It only bit on the always-on host the worker is
 * meant to run on.
 */

const TYPES = RECURRING.map((entry) => entry.type)

/** Mark everything the scheduler just queued as done, as a worker would. */
async function drain(): Promise<void> {
  const jobs = await unsafeDb.job.findMany({
    where: { type: { in: TYPES }, status: 'PENDING' },
    select: { id: true },
  })
  for (const job of jobs) await complete(job.id)
}

async function sweepRows() {
  return unsafeDb.job.findMany({
    where: { type: { in: TYPES } },
    select: { id: true, dedupeKey: true },
  })
}

beforeEach(async () => {
  await unsafeDb.job.deleteMany({ where: { type: { in: TYPES } } })
})

afterAll(async () => {
  await unsafeDb.job.deleteMany({ where: { type: { in: TYPES } } })
})

describe('recurring sweeps', () => {
  it('does not re-enqueue a bucket that has already been worked', async () => {
    await scheduleRecurring()
    const first = await sweepRows()
    expect(first).toHaveLength(RECURRING.length)

    await drain()
    await scheduleRecurring()

    /*
     * Asserted per key rather than as a total, because a one-minute sweep may
     * legitimately open a new bucket while the test runs. What must never
     * happen — and is exactly what the bug did — is a second row for a bucket
     * that already has one.
     */
    const byKey = new Map<string, number>()
    for (const row of await sweepRows()) {
      byKey.set(row.dedupeKey!, (byKey.get(row.dedupeKey!) ?? 0) + 1)
    }
    expect([...byKey.values()].filter((count) => count > 1)).toEqual([])

    // The sweeps whose interval is measured in hours cannot have rolled over,
    // so for those the count is flatly unchanged.
    const slow = RECURRING.filter((entry) => entry.everyMinutes >= 60).map((e) => e.type)
    expect(await unsafeDb.job.count({ where: { type: { in: slow } } })).toBe(slow.length)
  })

  it('enqueues again once the bucket rolls over', async () => {
    await scheduleRecurring()
    await drain()

    // Age every row by one bucket. Cheaper and far steadier than waiting a day
    // for `calibration.recompute`, and it exercises the same comparison.
    for (const row of await sweepRows()) {
      const [key, bucket] = row.dedupeKey!.split(/:(?=\d+$)/)
      await unsafeDb.job.update({
        where: { id: row.id },
        data: { dedupeKey: `${key}:${Number(bucket) - 1}` },
      })
    }

    await scheduleRecurring()
    expect(await sweepRows()).toHaveLength(RECURRING.length * 2)
  })

  it('leaves every other caller free to reuse a key after success', async () => {
    // The retry and re-materialisation semantics the rest of the queue depends
    // on: a key is a claim on work in flight, not a tombstone.
    const first = await enqueue({ type: 'system.reap', payload: {}, dedupeKey: 'test:reuse' })
    expect(first).not.toBeNull()
    expect(await enqueue({ type: 'system.reap', payload: {}, dedupeKey: 'test:reuse' })).toBeNull()

    await complete(first!)
    expect(
      await enqueue({ type: 'system.reap', payload: {}, dedupeKey: 'test:reuse' }),
    ).not.toBeNull()

    // Opting in is what changes the question asked.
    await drain()
    expect(
      await enqueue({
        type: 'system.reap',
        payload: {},
        dedupeKey: 'test:reuse',
        dedupeScope: 'ever',
      }),
    ).toBeNull()
  })
})

describe('pruning succeeded jobs', () => {
  it('deletes rows past the window and keeps everything the scheduler still needs', async () => {
    const day = 24 * 3_600_000
    const rows = [
      { key: 'test:prune:fresh', status: 'SUCCEEDED' as const, ageMs: 2 * day },
      { key: 'test:prune:stale', status: 'SUCCEEDED' as const, ageMs: 9 * day },
      { key: 'test:prune:dead', status: 'DEAD' as const, ageMs: 9 * day },
    ]

    for (const row of rows) {
      await unsafeDb.job.create({
        data: {
          type: 'system.reap',
          payloadJson: {},
          dedupeKey: row.key,
          status: row.status,
          completedAt: new Date(Date.now() - row.ageMs),
        },
      })
    }

    await pruneCompleted(7 * day)

    const survivors = await unsafeDb.job.findMany({
      where: { dedupeKey: { in: rows.map((r) => r.key) } },
      select: { dedupeKey: true },
    })
    expect(survivors.map((r) => r.dedupeKey).sort()).toEqual([
      // A DEAD row is the record of something that never happened; it stays.
      'test:prune:dead',
      // Still inside the window — and a daily sweep's bucket is only 24h wide,
      // so deleting this one is how a once-a-day job starts running twice.
      'test:prune:fresh',
    ])
  })
})
