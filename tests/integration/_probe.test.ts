import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { parseImport } from '@/domain/migration/parse'
import { commitBatch, createBatch } from '@/server/services/migration/batch'
import { rememberOptions } from '@/server/services/migration/review'

const S = 'pb_salon'
const TZ = 'Europe/London'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'pb-' } } })
  await unsafeDb.salon.create({
    data: {
      id: S, slug: 'pb-salon', name: 'Probe', defaultTimezone: TZ,
      settings: { create: {} },
      locations: { create: { id: 'pb_loc', name: 'Main', timezone: TZ } },
      serviceCategories: { create: { id: 'pb_cat', name: 'Hair', slug: 'hair' } },
    },
  })
  await unsafeDb.user.create({ data: { id: 'pb_user', email: 'pb-sty@example.com' } })
  await unsafeDb.membership.create({ data: { id: 'pb_mem', salonId: S, userId: 'pb_user', role: 'STYLIST' } })
  await unsafeDb.stylistProfile.create({ data: { id: 'pb_sty', salonId: S, membershipId: 'pb_mem', displayName: 'Wren' } })
  await unsafeDb.service.create({ data: { id: 'pb_svc', salonId: S, categoryId: 'pb_cat', name: 'Balayage', slug: 'balayage', basePriceCents: 28500 } })
}

const OPTIONS = { serviceMap: { Balayage: 'pb_svc', Toner: null }, stylistMap: { Wren: 'pb_sty' } }
const newBatch = () => createBatch(S, { locationId: 'pb_loc', filename: 'f.csv', sourcePlatform: 'FRESHA', sourceAssetKey: 'k', createdByUserId: 'pb_owner' })

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'pb-' } } })
})

describe('probes', () => {
  it('A: a future booking imports as COMPLETED history', async () => {
    const t = [
      'Client,Mobile,Date,Time,Service,Team member,Price,Status',
      'Cy Okafor,07700 900999,01/09/2027,15:00,Balayage,Wren,285,Confirmed',
    ].join('\n')
    const rows = parseImport(t, { platform: 'FRESHA', defaultCallingCode: '44' }).rows
    const b = await newBatch()
    const counts = await commitBatch(S, b.id, rows, OPTIONS)
    console.log('counts', counts)
    const appt = await unsafeDb.appointment.findFirstOrThrow({ where: { salonId: S } })
    console.log('status', appt.status, 'startsAt', appt.startsAt.toISOString(), 'checkedOutAt', appt.checkedOutAt?.toISOString(), 'actual', appt.actualTotalCents)
    const cy = await unsafeDb.clientProfile.findFirstOrThrow({ where: { salonId: S } })
    console.log('completedVisits', cy.completedVisits, 'spend', cy.lifetimeSpendCents, 'firstVisitAt', cy.firstVisitAt?.toISOString(), 'lastVisitAt', cy.lastVisitAt?.toISOString())
    const seg = await unsafeDb.appointmentSegment.count({ where: { salonId: S } })
    console.log('segments', seg)
  })

  it('B: one person on two rows becomes two clients when contact details are only on the first', async () => {
    const t = [
      'Client,Mobile,Email,Date,Time,Service,Team member,Price,Status',
      'Ada Rivera,07700 900123,ada@example.com,03/04/2024,14:30,Balayage,Wren,285,Completed',
      'Ada Rivera,,,13/04/2024,09:00,Toner,Wren,45,Completed',
    ].join('\n')
    const rows = parseImport(t, { platform: 'FRESHA', defaultCallingCode: '44' }).rows
    const b = await newBatch()
    const counts = await commitBatch(S, b.id, rows, OPTIONS)
    console.log('counts', counts)
    const clients = await unsafeDb.clientProfile.findMany({ where: { salonId: S }, select: { id: true, firstName: true, lastName: true, phone: true, completedVisits: true } })
    console.log('clients', clients)
  })

  it('C: rememberOptions un-finishes a completed batch so it can be committed twice', async () => {
    const t = [
      'Client,Mobile,Email,Date,Time,Service,Team member,Price,Status',
      'Ada Rivera,07700 900123,ada@example.com,03/04/2024,14:30,Balayage,Wren,285,Completed',
    ].join('\n')
    const rows = parseImport(t, { platform: 'FRESHA', defaultCallingCode: '44' }).rows
    const b = await newBatch()
    await commitBatch(S, b.id, rows, OPTIONS)
    // exactly what commitImportAction does before calling commitBatch again
    await rememberOptions(S, b.id, { dateOrder: 'DMY', defaultCallingCode: '44' })
    const second = await commitBatch(S, b.id, rows, OPTIONS)
    console.log('second run counts', second)
    const appts = await unsafeDb.appointment.count({ where: { salonId: S } })
    const ada = await unsafeDb.clientProfile.findFirstOrThrow({ where: { salonId: S, phone: '+447700900123' } })
    console.log('appointments now', appts, 'completedVisits', ada.completedVisits, 'spend', ada.lifetimeSpendCents)
    const consents = await unsafeDb.contactConsent.count({ where: { salonId: S } })
    console.log('consent rows', consents)
  })
})
