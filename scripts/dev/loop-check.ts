/**
 * Drives the whole client loop against the seeded dev database, service by
 * service, with no browser involved. Proves the pieces connect.
 */
import { unsafeDb } from '@/server/db/client'
import {
  evaluateConsultation,
  loadConsultation,
  saveAnswer,
  startConsultation,
  submitConsultation,
} from '@/server/services/consultation'
import { maybeAutoApprove, reviewConsultation } from '@/server/services/service-plan'
import { findSlots, resolveSlot } from '@/server/services/scheduling/slots'
import { createHold, bookFromHold } from '@/server/services/scheduling/booking'

async function main() {
  const salon = await unsafeDb.salon.findUniqueOrThrow({ where: { slug: 'aurora' } })
  const client = await unsafeDb.clientProfile.findFirstOrThrow({
    where: { salonId: salon.id, email: 'client@aurora.test' },
  })

  const cut = await unsafeDb.service.findFirstOrThrow({
    where: { salonId: salon.id, isChemical: false, isActive: true },
    include: { phases: true },
  })
  console.log(`\n▸ Service: ${cut.name} (${cut.phases.length} phases)`)

  const id = await startConsultation({
    salonId: salon.id,
    clientProfileId: client.id,
    serviceIds: [cut.id],
  })
  console.log(`  consultation ${id}`)

  const view = await loadConsultation(salon.id, id)
  console.log(`  ${view.steps.length} steps, ${view.questions.length} questions`)
  console.log(`  photos required: [${view.requiredPhotoViews.join(', ') || 'none'}]`)
  console.log(`  photos suggested: [${view.suggestedPhotoViews.join(', ')}]`)

  // Answer every question with something plausible.
  {
    for (const q of view.questions) {
      const value =
        q.inputType === 'BOOLEAN'
          ? false
          : q.inputType === 'LEVEL_PICKER'
            ? 6
            : q.inputType === 'SCALE'
              ? 3
              : q.inputType === 'NUMBER'
                ? 4
                : q.inputType === 'DATE'
                  ? '2026-09-01'
                  : (firstOption(q.optionsJson) ?? 'no')
      await saveAnswer({ salonId: salon.id, consultationId: id, questionKey: q.key, value })
    }
  }

  const after = await loadConsultation(salon.id, id)
  console.log(
    `  completion ${Math.round(after.completion * 100)}%, missing ${after.missing.length}`,
  )

  const evaluation = await submitConsultation({ salonId: salon.id, consultationId: id })
  console.log(`  decision  ${evaluation.recommendedDecision}`)
  console.log(`  flags     ${evaluation.flags.map((f) => f.code).join(', ') || 'none'}`)
  console.log(`  duration  ${evaluation.duration.totalMin} min (${evaluation.duration.confidence})`)
  console.log(`  price     ${evaluation.price.estimatedTotalCents / 100}`)
  console.log(`  sessions  ${evaluation.plan.sessionCount}`)

  let planId = await maybeAutoApprove({ salonId: salon.id, consultationId: id, evaluation })
  console.log(`  auto-approve → ${planId ?? 'no (salon has not opted in)'}`)

  if (!planId) {
    const owner = await unsafeDb.user.findUniqueOrThrow({ where: { email: 'owner@aurora.test' } })
    const reviewed = await reviewConsultation({
      salonId: salon.id,
      consultationId: id,
      reviewerUserId: owner.id,
      decision: 'APPROVE',
    })
    planId = reviewed.servicePlanId
    console.log(`  stylist approved → plan ${planId}`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const to = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)

  const search = await findSlots({
    salonId: salon.id,
    servicePlanId: planId!,
    sequence: 1,
    fromDate: today,
    toDate: to,
  })
  console.log(
    `\n▸ Slots: ${search.slots.length} found${search.reason ? ` (${search.reason})` : ''}`,
  )

  const first = search.slots[0]
  if (!first) {
    console.log('  NO SLOTS — cannot complete the loop')
    process.exit(1)
  }
  console.log(`  first: ${first.startsAt} → ${first.endsAt} with ${first.stylistName}`)

  const resolved = await resolveSlot({
    salonId: salon.id,
    servicePlanId: planId!,
    sequence: 1,
    fromDate: today,
    toDate: to,
    token: first.token,
  })
  if (!resolved) {
    console.log('  RESOLVE FAILED')
    process.exit(1)
  }
  console.log('  re-solved from token ✓')

  const plan = await unsafeDb.servicePlan.findUniqueOrThrow({
    where: { id: planId! },
    include: { sessions: { include: { services: true } } },
  })
  const session = plan.sessions[0]!

  const { holdId } = await createHold({
    salonId: salon.id,
    locationId: resolved.locationId,
    clientProfileId: client.id,
    slot: resolved.slot,
    chain: resolved.chain,
    servicePlanId: plan.id,
    servicePlanSessionId: session.id,
    ttlSeconds: 600,
  })
  console.log(`  held ${holdId}`)

  const booking = await bookFromHold({
    salonId: salon.id,
    holdId,
    clientProfileId: client.id,
    services: session.services.map((s) => ({
      serviceId: s.serviceId,
      plannedDurationMin: s.plannedDurationMin,
      priceCents: s.plannedPriceCents,
    })),
    timeZone: 'America/New_York',
  })
  console.log(`\n▸ BOOKED ${booking.appointmentId}`)
  console.log(`  ${booking.startsAt.toISOString()} → ${booking.endsAt.toISOString()}`)

  const segments = await unsafeDb.appointmentSegment.findMany({
    where: { appointmentId: booking.appointmentId },
    orderBy: { startsAt: 'asc' },
  })
  console.log(`  ${segments.length} segments:`)
  for (const s of segments) {
    console.log(
      `    ${s.kind.padEnd(16)} ${s.startsAt.toISOString().slice(11, 16)}–${s.endsAt.toISOString().slice(11, 16)}  blocks=${s.blocksStylist}`,
    )
  }

  // --- Now the high-risk path -----------------------------------------------
  const balayage = await unsafeDb.service.findFirstOrThrow({
    where: { salonId: salon.id, isLightening: true, isActive: true },
  })
  console.log(`\n▸ High-risk path: ${balayage.name}`)

  const riskyId = await startConsultation({
    salonId: salon.id,
    clientProfileId: client.id,
    serviceIds: [balayage.id],
  })
  const riskyView = await loadConsultation(salon.id, riskyId)
  console.log(`  photos required: ${riskyView.requiredPhotoViews.length} views`)

  {
    for (const q of riskyView.questions) {
      // Box dye yes, target level 9 — the staged-lift case.
      const value = q.key.includes('box')
        ? true
        : q.inputType === 'LEVEL_PICKER'
          ? 9
          : q.inputType === 'BOOLEAN'
            ? false
            : q.inputType === 'SCALE'
              ? 3
              : q.inputType === 'NUMBER'
                ? 4
                : q.inputType === 'DATE'
                  ? '2026-09-01'
                  : (firstOption(q.optionsJson) ?? 'no')
      await saveAnswer({ salonId: salon.id, consultationId: riskyId, questionKey: q.key, value })
    }
  }

  const risky = await evaluateConsultation({ salonId: salon.id, consultationId: riskyId })
  console.log(`  decision  ${risky.recommendedDecision}`)
  console.log(`  blocks    ${risky.blocksOnlineBooking}`)
  console.log(`  flags     ${risky.flags.map((f) => `${f.code}(${f.severity})`).join(', ')}`)
  console.log(`  sessions  ${risky.plan.sessionCount}`)
  console.log(
    `  auto      ${await maybeAutoApprove({ salonId: salon.id, consultationId: riskyId, evaluation: risky })}`,
  )

  const everyFlagHasPath = risky.flags.every((f) => f.recommendedPath.length > 10)
  console.log(`  every flag has a recommended path: ${everyFlagHasPath}`)

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
