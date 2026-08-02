import { unsafeDb } from '@/server/db/client'
import { ownerDashboard } from '@/server/services/analytics'
import { aiUsage } from '@/server/services/ai'
import {
  feedFor,
  issueFeedToken,
  listConnections,
  signWebhook,
  verifyWebhook,
} from '@/server/services/integrations'

/**
 * Drives the owner dashboard and the integration surfaces against the seeded
 * database. The seed has 120 completed appointments with real quote-accuracy
 * rows, so the accuracy figures here are the ones a salon would actually see.
 */

async function main() {
  const salon = await unsafeDb.salon.findUniqueOrThrow({ where: { slug: 'aurora' } })

  const data = await ownerDashboard(salon.id, 'America/New_York', 180)

  console.log('\n▸ Quote accuracy')
  const { overall } = data.accuracy
  console.log(`  samples          ${overall.sampleCount}`)
  console.log(
    `  held within 15m  ${overall.withinToleranceRate === null ? 'not enough data' : `${Math.round(overall.withinToleranceRate * 100)}%`}`,
  )
  console.log(`  typical miss     ${overall.medianErrorMin ?? '—'}m`)
  console.log(`  bias             ${overall.medianBiasMin ?? '—'}m`)
  console.log(`  over / under     ${overall.overranCount} / ${overall.underranCount}`)
  console.log(
    `  price held       ${data.accuracy.priceHeldRate === null ? 'not enough data' : `${Math.round(data.accuracy.priceHeldRate * 100)}%`}`,
  )

  console.log('\n  by stylist:')
  for (const row of data.accuracy.perStylist.slice(0, 6)) {
    console.log(
      `    ${row.name.padEnd(18)} ${String(row.sampleCount).padStart(3)} done  ` +
        `${row.withinToleranceRate === null ? '  too few' : `${String(Math.round(row.withinToleranceRate * 100)).padStart(3)}% held`}  ` +
        `bias ${row.medianBiasMin ?? '—'}m`,
    )
  }

  console.log('\n▸ Funnel')
  for (const step of data.funnel.steps) {
    const rate =
      step.conversionFromPrevious === null
        ? ''
        : ` (${Math.round(step.conversionFromPrevious * 100)}% of previous)`
    console.log(`  ${step.label.padEnd(22)} ${String(step.count).padStart(4)}${rate}`)
  }
  console.log(`  worst drop: ${data.funnel.worst?.label ?? 'none'}`)

  console.log('\n▸ Chair time')
  for (const row of data.utilisation.slice(0, 6)) {
    console.log(
      `  ${row.name.padEnd(18)} ${String(row.chairMin).padStart(5)}m chair  ${String(row.freedMin).padStart(4)}m freed  ` +
        `${row.utilisation === null ? '—' : `${Math.round(row.utilisation * 100)}%`}`,
    )
  }

  console.log('\n▸ Rules')
  if (data.rules.length === 0) console.log('  none fired in this window')
  for (const rule of data.rules.slice(0, 6)) {
    console.log(
      `  ${rule.code.padEnd(24)} fired ${String(rule.fired).padStart(3)}  ` +
        `${rule.overrideRate === null ? 'too few' : `${Math.round(rule.overrideRate * 100)}% overruled`}` +
        `${rule.needsReview ? '  ← worth revisiting' : ''}`,
    )
  }

  console.log('\n▸ Money')
  console.log(`  taken       ${data.revenue.currentCents / 100}`)
  console.log(`  previous    ${data.revenue.previousCents / 100}`)
  console.log(
    `  change      ${data.revenue.changeRate === null ? 'no baseline' : `${Math.round(data.revenue.changeRate * 100)}%`}`,
  )
  console.log(
    `  completed ${data.revenue.completed} · no-shows ${data.revenue.noShows} · cancelled ${data.revenue.cancelled}`,
  )
  console.log(
    `  no-show rate ${data.revenue.noShowRate === null ? 'not enough data' : `${Math.round(data.revenue.noShowRate * 100)}%`}`,
  )

  const ai = await aiUsage(salon.id)
  console.log(
    `\n▸ AI: ${ai.callCount} calls, ${ai.tokens} tokens, acceptance ${ai.acceptanceRate ?? 'not judged'}`,
  )

  // --- Integrations ---------------------------------------------------------
  const stylist = await unsafeDb.stylistProfile.findFirstOrThrow({ where: { salonId: salon.id } })

  const { token } = await issueFeedToken(salon.id, stylist.id)
  const feed = await feedFor(stylist.id, token)
  console.log(`\n▸ Calendar feed for ${stylist.displayName}`)
  console.log(`  served: ${feed !== null}`)
  console.log(`  events: ${(feed?.ics.match(/BEGIN:VEVENT/g) ?? []).length}`)
  console.log(`  wrong token refused: ${(await feedFor(stylist.id, 'not-the-token')) === null}`)

  // A leaked URL must expose one diary, not the salon's.
  const other = await unsafeDb.stylistProfile.findFirstOrThrow({
    where: { salonId: salon.id, id: { not: stylist.id } },
  })
  console.log(
    `  one stylist's token does not open another's: ${(await feedFor(other.id, token)) === null}`,
  )

  const full = feed?.ics ?? ''
  console.log(`  shows initials only: ${!/SUMMARY:.*Rivera/.test(full)}`)

  const connections = await listConnections(salon.id)
  console.log(`  connections listed: ${connections.length}`)
  console.log(
    `  no raw credentials in the listing: ${!JSON.stringify(connections).includes(token)}`,
  )

  // --- Webhook signing -------------------------------------------------------
  const body = JSON.stringify({ topic: 'appointment.booked', id: 'a1' })
  const now = Math.floor(Date.now() / 1000)
  const signature = signWebhook('sekret', body, now)

  console.log('\n▸ Webhook signatures')
  console.log(
    `  valid accepted:   ${verifyWebhook({ secret: 'sekret', body, timestamp: now, signature, now })}`,
  )
  console.log(
    `  replay rejected:  ${!verifyWebhook({ secret: 'sekret', body, timestamp: now - 3600, signature, now })}`,
  )
  console.log(
    `  tampered rejected: ${!verifyWebhook({ secret: 'sekret', body: `${body} `, timestamp: now, signature, now })}`,
  )
  console.log(
    `  wrong secret rejected: ${!verifyWebhook({ secret: 'other', body, timestamp: now, signature, now })}`,
  )

  await unsafeDb.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
