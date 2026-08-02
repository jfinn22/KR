import { Prisma } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { CrossTenantError, dbFor } from '@/server/db/tenant-client'
import { GLOBAL_MODELS, SHARED_LIBRARY_MODELS } from '@/server/db/model-registry'

/**
 * Tenant isolation is the claim with the worst blast radius if it is wrong, so
 * it is asserted structurally rather than by spot-checking a few queries.
 *
 * The registry test walks the Prisma DMMF, so a model added in a later
 * workstream cannot quietly skip the tenancy decision — it fails here.
 */

const A = { salon: 'iso_salon_a', slug: 'iso-a' }
const B = { salon: 'iso_salon_b', slug: 'iso-b' }

async function wipe() {
  await unsafeDb.salon.deleteMany({ where: { id: { in: [A.salon, B.salon] } } })
  await unsafeDb.user.deleteMany({ where: { email: { startsWith: 'iso-' } } })
}

async function seedSalon(id: string, slug: string) {
  await unsafeDb.salon.create({
    data: {
      id,
      slug,
      name: `Salon ${slug}`,
      settings: { create: {} },
      locations: { create: { id: `${id}_loc`, name: 'Main' } },
      serviceCategories: { create: { id: `${id}_cat`, name: 'Colour', slug: 'colour' } },
    },
  })

  await unsafeDb.user.create({
    data: { id: `${id}_user`, email: `iso-${slug}@example.com`, name: `User ${slug}` },
  })

  await unsafeDb.membership.create({
    data: { id: `${id}_mem`, salonId: id, userId: `${id}_user`, role: 'STYLIST' },
  })

  await unsafeDb.stylistProfile.create({
    data: {
      id: `${id}_sty`,
      salonId: id,
      membershipId: `${id}_mem`,
      displayName: `Stylist ${slug}`,
    },
  })

  await unsafeDb.clientProfile.create({
    data: { id: `${id}_cli`, salonId: id, firstName: 'Ada', lastName: slug.toUpperCase() },
  })

  await unsafeDb.service.create({
    data: {
      id: `${id}_svc`,
      salonId: id,
      categoryId: `${id}_cat`,
      name: 'Balayage',
      slug: 'balayage',
      basePriceCents: 20000,
    },
  })

  await unsafeDb.retailProduct.create({
    data: { id: `${id}_prod`, salonId: id, sku: 'SKU1', name: 'Bond builder', priceCents: 3200 },
  })
}

beforeAll(async () => {
  await wipe()
  await seedSalon(A.salon, A.slug)
  await seedSalon(B.salon, B.slug)
}, 60_000)

afterAll(async () => {
  await wipe()
  await unsafeDb.$disconnect()
})

describe('model registry covers the whole schema', () => {
  const models = Prisma.dmmf.datamodel.models

  it('every model is either global or carries salonId', () => {
    const undecided: string[] = []
    for (const model of models) {
      if (GLOBAL_MODELS.has(model.name)) continue
      const hasSalonId = model.fields.some((f) => f.name === 'salonId')
      if (!hasSalonId) undecided.push(model.name)
    }
    expect(
      undecided,
      `These models are neither in GLOBAL_MODELS nor carry salonId. Add a salonId ` +
        `field or register them as global — do not leave the decision implicit.`,
    ).toEqual([])
  })

  it('every shared-library model has a NULLABLE salonId', () => {
    for (const name of SHARED_LIBRARY_MODELS) {
      const model = models.find((m) => m.name === name)
      expect(
        model,
        `${name} is registered as shared-library but is not in the schema`,
      ).toBeDefined()
      const field = model!.fields.find((f) => f.name === 'salonId')
      expect(field, `${name}.salonId missing`).toBeDefined()
      expect(field!.isRequired, `${name}.salonId must be nullable to hold platform rows`).toBe(
        false,
      )
    }
  })

  it('every registered global model actually exists', () => {
    for (const name of GLOBAL_MODELS) {
      expect(
        models.some((m) => m.name === name),
        `GLOBAL_MODELS lists ${name}, which is not in the schema`,
      ).toBe(true)
    }
  })

  it('every non-shared tenant model has a REQUIRED salonId', () => {
    const optional: string[] = []
    for (const model of models) {
      if (GLOBAL_MODELS.has(model.name) || SHARED_LIBRARY_MODELS.has(model.name)) continue
      const field = model.fields.find((f) => f.name === 'salonId')
      if (field && !field.isRequired) optional.push(model.name)
    }
    expect(optional).toEqual([])
  })
})

describe('reads cannot cross the tenant boundary', () => {
  const a = dbFor(A.salon)

  it('findMany returns only this salon’s rows', async () => {
    const clients = await a.clientProfile.findMany()
    expect(clients).toHaveLength(1)
    expect(clients[0]!.salonId).toBe(A.salon)
  })

  it('findFirst cannot reach the other salon even when asked by id', async () => {
    const found = await a.clientProfile.findFirst({ where: { id: `${B.salon}_cli` } })
    expect(found).toBeNull()
  })

  it('findUnique on another salon’s row returns nothing', async () => {
    const found = await a.service.findFirst({ where: { id: `${B.salon}_svc` } })
    expect(found).toBeNull()
  })

  it('count is scoped', async () => {
    expect(await a.service.count()).toBe(1)
    expect(await a.retailProduct.count()).toBe(1)
  })

  it('an explicit foreign salonId is rejected rather than silently corrected', async () => {
    await expect(a.clientProfile.findMany({ where: { salonId: B.salon } })).rejects.toThrow(
      CrossTenantError,
    )
  })

  it('a caller’s own OR filter is preserved, not clobbered', async () => {
    const rows = await a.clientProfile.findMany({
      where: { OR: [{ firstName: 'Ada' }, { firstName: 'Grace' }] },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.salonId).toBe(A.salon)
  })
})

describe('writes cannot cross the tenant boundary', () => {
  const a = dbFor(A.salon)

  it('create stamps the caller’s salonId', async () => {
    const created = await a.retailProduct.create({
      data: { sku: 'STAMP-1', name: 'Gloss', priceCents: 1000 } as never,
    })
    expect(created.salonId).toBe(A.salon)
    await unsafeDb.retailProduct.delete({ where: { id: created.id } })
  })

  it('create with a foreign salonId throws', async () => {
    await expect(
      a.retailProduct.create({
        data: { salonId: B.salon, sku: 'BAD-1', name: 'Nope', priceCents: 1 } as never,
      }),
    ).rejects.toThrow(CrossTenantError)
  })

  it('updateMany cannot touch another salon’s rows', async () => {
    const result = await a.retailProduct.updateMany({
      where: { id: `${B.salon}_prod` },
      data: { name: 'Hijacked' },
    })
    expect(result.count).toBe(0)

    const untouched = await unsafeDb.retailProduct.findUnique({ where: { id: `${B.salon}_prod` } })
    expect(untouched?.name).toBe('Bond builder')
  })

  it('deleteMany cannot delete another salon’s rows', async () => {
    const result = await a.clientProfile.deleteMany({ where: { id: `${B.salon}_cli` } })
    expect(result.count).toBe(0)
    expect(await unsafeDb.clientProfile.count({ where: { salonId: B.salon } })).toBe(1)
  })
})

describe('global and shared-library models', () => {
  it('global models are not scoped — identity is cross-tenant by design', async () => {
    const users = await dbFor(A.salon).user.findMany({ where: { email: { startsWith: 'iso-' } } })
    expect(users.length).toBe(2)
  })

  it('shared-library rows are visible alongside the salon’s own', async () => {
    await unsafeDb.consultationTemplate.create({
      data: { id: 'iso_tpl_shared', key: 'iso-shared', name: 'Platform starter', isSystem: true },
    })
    await unsafeDb.consultationTemplate.create({
      data: { id: 'iso_tpl_a', salonId: A.salon, key: 'iso-own', name: 'Salon A template' },
    })
    await unsafeDb.consultationTemplate.create({
      data: { id: 'iso_tpl_b', salonId: B.salon, key: 'iso-own-b', name: 'Salon B template' },
    })

    const visible = await dbFor(A.salon).consultationTemplate.findMany({
      where: { key: { startsWith: 'iso-' } },
      orderBy: { id: 'asc' },
    })

    expect(visible.map((t) => t.id)).toEqual(['iso_tpl_a', 'iso_tpl_shared'])

    await unsafeDb.consultationTemplate.deleteMany({
      where: { id: { in: ['iso_tpl_shared', 'iso_tpl_a', 'iso_tpl_b'] } },
    })
  })
})

describe('row-level security policies are installed', () => {
  it('every table with a salonId has RLS enabled and a tenant policy', async () => {
    const rows = await unsafeDb.$queryRaw<{ table_name: string; rls: boolean; policies: bigint }[]>`
      SELECT c.relname          AS table_name,
             c.relrowsecurity   AS rls,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'salonId' AND NOT a.attisdropped
        )
    `

    expect(rows.length).toBeGreaterThan(50)
    const unprotected = rows.filter((r) => !r.rls || Number(r.policies) === 0)
    expect(
      unprotected.map((r) => r.table_name),
      'tables carrying salonId without RLS + a tenant policy',
    ).toEqual([])
  })
})
