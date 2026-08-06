import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { auditActions, auditTrail } from '@/server/services/audit-trail'

/**
 * Reading back what was done, and who did it.
 *
 * `AuditLog` had three writers and not one reader. Every mutation through
 * `withAuthz` has landed a row since the platform was built — including the
 * written reason where the policy demanded one — and nothing in the product
 * could show any of it, while `audit.view` sat granted to owners and managers
 * gating nothing.
 */

const S = 'au_salon'
const OTHER = 'au_other'
const NOW = new Date('2026-06-15T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

async function seed() {
  await unsafeDb.auditLog.deleteMany({ where: { salonId: { in: [S, OTHER] } } })
  await unsafeDb.auditLog.deleteMany({ where: { action: { startsWith: 'au.' } } })
  await unsafeDb.salon.deleteMany({ where: { id: { in: [S, OTHER] } } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@au.test' } } })

  for (const id of [S, OTHER]) {
    await unsafeDb.salon.create({
      data: {
        id,
        slug: id.replace('_', '-'),
        name: `Audit ${id}`,
        defaultTimezone: 'Europe/London',
        settings: { create: {} },
      },
    })
  }
  await unsafeDb.user.create({ data: { id: 'au_user', email: 'nia@au.test', name: 'Nia' } })
}

async function entry(over: Record<string, unknown> = {}) {
  return unsafeDb.auditLog.create({
    data: {
      salonId: S,
      actorType: 'USER',
      actorUserId: 'au_user',
      actorRole: 'MANAGER',
      action: 'au.flag.override',
      entityType: 'Consultation',
      createdAt: ago(1),
      ...over,
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.auditLog.deleteMany({ where: { salonId: { in: [S, OTHER] } } })
  await unsafeDb.salon.deleteMany({ where: { id: { in: [S, OTHER] } } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@au.test' } } })
})

describe('reading the trail', () => {
  it('resolves who did it into a name', async () => {
    await entry({ reason: 'Client has had this exact service here twice.' })

    const rows = await auditTrail(S, {}, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorName: 'Nia',
      actorRole: 'MANAGER',
      action: 'au.flag.override',
      entityType: 'Consultation',
    })
  })

  it('never shows another salon’s', async () => {
    await entry({ reason: 'Ours.' })
    await entry({ salonId: OTHER, reason: 'Theirs.' })

    const rows = await auditTrail(S, {}, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('Ours.')
  })

  it('never widens to the platform’s own rows', async () => {
    /*
     * `AuditLog.salonId` is nullable because platform-level actions have no
     * tenant. Those are not a salon's to read, and a null in the predicate
     * would widen the query rather than narrow it.
     */
    await entry({ reason: 'Ours.' })
    await unsafeDb.auditLog.create({
      data: {
        salonId: null,
        actorType: 'SYSTEM',
        action: 'au.platform.thing',
        entityType: 'Subscription',
        createdAt: ago(1),
        reason: 'Platform level.',
      },
    })

    expect(await auditTrail(S, {}, NOW)).toHaveLength(1)
  })

  it('defaults to what somebody had to justify', async () => {
    await entry({ reason: 'Overrode it because…' })
    await entry({ action: 'au.appointment.book', reason: null })

    const reasoned = await auditTrail(S, { reasonedOnly: true }, NOW)
    expect(reasoned).toHaveLength(1)
    expect(reasoned[0]?.reason).toMatch(/Overrode/)

    expect(await auditTrail(S, {}, NOW)).toHaveLength(2)
  })

  it('narrows to one action', async () => {
    await entry()
    await entry({ action: 'au.discount.applyOverCap' })

    const rows = await auditTrail(S, { action: 'au.discount.applyOverCap' }, NOW)
    expect(rows).toHaveLength(1)
  })

  it('leaves out anything older than the window', async () => {
    await entry({ createdAt: ago(2) })
    await entry({ createdAt: ago(60) })

    expect(await auditTrail(S, { days: 7 }, NOW)).toHaveLength(1)
    expect(await auditTrail(S, { days: 90 }, NOW)).toHaveLength(2)
  })

  it('puts the newest first, which is what somebody scrolls for', async () => {
    await entry({ createdAt: ago(5), reason: 'older' })
    await entry({ createdAt: ago(1), reason: 'newer' })

    const rows = await auditTrail(S, {}, NOW)
    expect(rows[0]?.reason).toBe('newer')
  })

  it('says the system did it when there is no user', async () => {
    await entry({ actorType: 'SYSTEM', actorUserId: null, actorRole: null })

    const rows = await auditTrail(S, {}, NOW)
    expect(rows[0]?.actorName).toBeNull()
    expect(rows[0]?.actorType).toBe('SYSTEM')
  })

  it('caps how much it will return', async () => {
    for (let i = 0; i < 12; i += 1) await entry()
    expect(await auditTrail(S, { take: 5 }, NOW)).toHaveLength(5)
  })
})

describe('what the filter can offer', () => {
  it('counts the actions this salon has actually taken', async () => {
    await entry()
    await entry()
    await entry({ action: 'au.discount.applyOverCap' })

    const actions = await auditActions(S, 30, NOW)
    expect(actions).toContainEqual({ action: 'au.flag.override', count: 2 })
    expect(actions).toContainEqual({ action: 'au.discount.applyOverCap', count: 1 })
  })

  it('offers nothing from another salon', async () => {
    await entry({ salonId: OTHER, action: 'au.theirs' })
    expect(await auditActions(S, 30, NOW)).toEqual([])
  })
})
