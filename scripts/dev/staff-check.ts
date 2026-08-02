import { unsafeDb } from '@/server/db/client'
import { reviewDetail, reviewQueue, queueStats, resolveFlag } from '@/server/services/review-queue'
import { deskDay, daySchedule, findClients, clientRecord } from '@/server/services/front-desk'
import { advanceAppointment } from '@/server/services/appointment-lifecycle'
import { reviewConsultation } from '@/server/services/service-plan'
import { saveAnswer, startConsultation, submitConsultation } from '@/server/services/consultation'

/**
 * Drives the staff surfaces against the seeded database: review queue, review
 * detail, flag resolution, the desk's day, and the full day-of lifecycle.
 * Faster than a browser for finding the bugs that only appear on real data.
 */

async function main() {
  const salon = await unsafeDb.salon.findUniqueOrThrow({ where: { slug: 'aurora' } })
  const owner = await unsafeDb.user.findUniqueOrThrow({ where: { email: 'owner@aurora.test' } })
  const client = await unsafeDb.clientProfile.findFirstOrThrow({
    where: { salonId: salon.id, email: 'client@aurora.test' },
  })

  // --- Produce something worth reviewing -----------------------------------
  const balayage = await unsafeDb.service.findFirstOrThrow({
    where: { salonId: salon.id, isLightening: true, isActive: true },
  })

  const consultationId = await startConsultation({
    salonId: salon.id,
    clientProfileId: client.id,
    serviceIds: [balayage.id],
  })

  const questions = await unsafeDb.consultationQuestion.findMany({
    where: { salonId: salon.id },
    orderBy: { sortOrder: 'asc' },
  })

  for (const question of questions) {
    const value = question.key.includes('box')
      ? true
      : question.inputType === 'LEVEL_PICKER'
        ? question.key === 'goal_level'
          ? 9
          : 5
        : question.inputType === 'BOOLEAN'
          ? false
          : question.inputType === 'DATE'
            ? '2026-03-01'
            : question.inputType === 'SINGLE_SELECT'
              ? firstOption(question.optionsJson)
              : question.inputType === 'LONG_TEXT'
                ? 'No concerns.'
                : 3
    await saveAnswer({ salonId: salon.id, consultationId, questionKey: question.key, value })
  }
  await submitConsultation({ salonId: salon.id, consultationId })

  // --- The queue ------------------------------------------------------------
  const [queue, stats] = await Promise.all([
    reviewQueue(salon.id, { filter: 'WAITING' }),
    queueStats(salon.id),
  ])
  console.log(
    `\n▸ Review queue: ${queue.length} waiting, ${stats.overdue} overdue, ${stats.blocked} blockers`,
  )
  for (const item of queue.slice(0, 3)) {
    console.log(
      `  ${item.clientName.padEnd(18)} ${item.maxSeverity.padEnd(8)} ${item.flagCount} flags  ${item.sessionCount} visit(s)  ${item.recommendedDecision}`,
    )
  }

  const ordered = queue.map((q) => `${q.overdue ? 'OVERDUE' : q.maxSeverity}`)
  console.log(`  order: ${ordered.slice(0, 6).join(' → ')}`)

  // --- The detail -----------------------------------------------------------
  const detail = await reviewDetail(salon.id, consultationId)
  console.log(`\n▸ Review detail`)
  console.log(
    `  answers    ${detail.answered.filter((a) => a.wasAnswered).length}/${detail.answered.length}`,
  )
  console.log(`  photos     ${detail.photos.length}`)
  console.log(
    `  flags      ${detail.flags.map((f) => `${f.code}(${f.severity}/${f.status})`).join(', ') || 'none'}`,
  )
  console.log(`  prior      ${detail.priorVisits.length} completed visits`)
  console.log(`  evaluation ${detail.evaluationMeta?.rulesetVersion ?? 'none'}`)

  // --- Overriding a flag needs a reason -------------------------------------
  const flag = detail.flags[0]
  if (flag) {
    let refused = false
    try {
      await resolveFlag({
        salonId: salon.id,
        flagId: flag.id,
        status: 'OVERRIDDEN',
        userId: owner.id,
      })
    } catch {
      refused = true
    }
    console.log(`\n▸ Override without a reason refused: ${refused}`)

    await resolveFlag({
      salonId: salon.id,
      flagId: flag.id,
      status: 'ACKNOWLEDGED',
      userId: owner.id,
    })
    const after = await unsafeDb.riskFlag.findUniqueOrThrow({ where: { id: flag.id } })
    console.log(`  acknowledged: ${after.status}`)
  }

  // --- Approving with an override -------------------------------------------
  const approved = await reviewConsultation({
    salonId: salon.id,
    consultationId,
    reviewerUserId: owner.id,
    decision: 'APPROVE_WITH_CHANGES',
    overrides: { durationMin: 300, priceCents: 30000 },
  })
  const plan = await unsafeDb.servicePlan.findUniqueOrThrow({
    where: { id: approved.servicePlanId! },
    include: { sessions: true },
  })
  console.log(`\n▸ Approved with changes`)
  console.log(`  plan       ${plan.estimatedTotalMin} min, ${plan.estimatedTotalCents / 100}`)
  console.log(`  sessions   ${plan.sessions.length}`)
  console.log(`  stylist    ${plan.stylistProfileId}`)

  // Approving twice must be refused.
  let doubleRefused = false
  try {
    await reviewConsultation({
      salonId: salon.id,
      consultationId,
      reviewerUserId: owner.id,
      decision: 'APPROVE',
    })
  } catch {
    doubleRefused = true
  }
  console.log(`  double approval refused: ${doubleRefused}`)

  // --- The desk -------------------------------------------------------------
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const day = await deskDay(salon.id, { localDate: today, timeZone: 'America/New_York' })
  console.log(`\n▸ Desk, ${day.localDate}`)
  console.log(
    `  booked ${day.stats.booked} · arrived ${day.stats.arrived} · expected ${day.stats.expectedCents / 100} · unpaid deposits ${day.stats.unpaidDeposits}`,
  )
  console.log(
    `  overdue ${day.overdue.length} · arriving ${day.arriving.length} · in chair ${day.inChair.length} · finished ${day.finished.length}`,
  )

  const schedule = await daySchedule(salon.id, { localDate: today, timeZone: 'America/New_York' })
  const withWork = schedule.columns.filter((c) => c.segments.length > 0)
  console.log(`  diary: ${withWork.length} stylists with work`)
  for (const column of withWork.slice(0, 3)) {
    const free = column.segments.filter((s) => !s.blocksStylist)
    console.log(
      `    ${column.stylist.displayName.padEnd(16)} ${column.segments.length} segments, ${free.length} free`,
    )
  }

  // --- Search ---------------------------------------------------------------
  const found = await findClients(salon.id, 'a')
  const byName = await findClients(salon.id, client.firstName)
  console.log(`\n▸ Search`)
  console.log(`  one letter returns nothing: ${found.length === 0}`)
  console.log(`  by first name: ${byName.length} result(s)`)

  const record = await clientRecord(salon.id, client.id)
  console.log(
    `  record: ${record?.client.completedVisits} visits, avg overrun ${record?.averageOverrunMin}m`,
  )

  // --- The day-of lifecycle -------------------------------------------------
  const upcoming = await unsafeDb.appointment.findFirst({
    where: { salonId: salon.id, status: { in: ['BOOKED', 'CONFIRMED'] } },
    orderBy: { startsAt: 'asc' },
  })

  if (!upcoming) {
    console.log('\n▸ No bookable appointment to walk through')
  } else {
    console.log(`\n▸ Lifecycle on ${upcoming.id}`)

    // Ending a chair that never started must be refused.
    let outOfOrder = false
    try {
      await advanceAppointment({
        salonId: salon.id,
        appointmentId: upcoming.id,
        step: 'END_CHAIR',
      })
    } catch (err) {
      outOfOrder = true
      console.log(`  end before start refused: ${(err as Error).message}`)
    }
    if (!outOfOrder) console.log('  PROBLEM: end before start was allowed')

    for (const step of ['CHECK_IN', 'START_CHAIR', 'END_CHAIR'] as const) {
      const result = await advanceAppointment({
        salonId: salon.id,
        appointmentId: upcoming.id,
        step,
      })
      console.log(`  ${step.padEnd(12)} → ${result.status}`)
    }

    const done = await unsafeDb.appointment.findUniqueOrThrow({ where: { id: upcoming.id } })
    console.log(`  chair recorded: ${done.chairStartedAt !== null && done.chairEndedAt !== null}`)

    const job = await unsafeDb.job.findFirst({
      where: { type: 'quoteaccuracy.capture', dedupeKey: `quote:${upcoming.id}` },
    })
    console.log(`  calibration job queued: ${job !== null}`)

    const clientAfter = await unsafeDb.clientProfile.findUniqueOrThrow({
      where: { id: done.clientProfileId },
    })
    console.log(`  visit counted: ${clientAfter.lastVisitAt !== null}`)
  }

  await unsafeDb.$disconnect()
}

function firstOption(optionsJson: unknown): string | null {
  // The seeded templates use { options: [...] }; a bare array is also valid.
  const list = Array.isArray(optionsJson)
    ? optionsJson
    : optionsJson && typeof optionsJson === 'object'
      ? ((optionsJson as { options?: unknown[] }).options ?? [])
      : []

  if (list.length > 0) {
    const first = list[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object') {
      const record = first as Record<string, unknown>
      const value = record.value ?? record.key
      return value === undefined ? null : String(value)
    }
  }
  return null
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
