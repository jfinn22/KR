import { Prisma } from '@prisma/client'
import { unsafeDb } from './client'
import { isGlobalModel, isSharedLibraryModel } from './model-registry'

/**
 * Tenant scoping as a Prisma client extension.
 *
 * Isolation is structural rather than a matter of remembering a `where`
 * clause on every query. Every operation on a tenant-scoped model gets
 * `salonId` injected into its filter, and every write gets `salonId` stamped
 * onto its data. A caller that passes a *different* salonId is not silently
 * corrected — it throws, because that mismatch is always a bug.
 *
 * Since Prisma 5, `where` on findUnique/update/delete accepts extra non-unique
 * filters alongside the unique field, which is what lets one code path cover
 * every operation.
 */

export class CrossTenantError extends Error {
  constructor(model: string, operation: string, expected: string, received: string) {
    super(
      `Cross-tenant access blocked: ${model}.${operation} scoped to salon ${expected} ` +
        `but received salon ${received}`,
    )
    this.name = 'CrossTenantError'
  }
}

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

const WHERE_AND_DATA_OPS = new Set(['update', 'updateMany', 'upsert'])
const WHERE_ONLY_OPS = new Set(['delete', 'deleteMany'])
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn'])

type AnyArgs = Record<string, unknown>

function assertMatches(model: string, operation: string, salonId: string, value: unknown) {
  if (typeof value === 'string' && value !== salonId) {
    throw new CrossTenantError(model, operation, salonId, value)
  }
}

/** Narrow a `where` clause to the tenant, preserving whatever was there. */
function scopeWhere(
  model: string,
  operation: string,
  where: unknown,
  salonId: string,
  sharedLibrary: boolean,
): AnyArgs {
  const base = (where ?? {}) as AnyArgs
  assertMatches(model, operation, salonId, base.salonId)

  const tenantFilter = sharedLibrary ? { OR: [{ salonId }, { salonId: null }] } : { salonId }

  // Merge via AND so an existing OR in the caller's filter is not clobbered.
  const existingAnd = base.AND
  const and =
    existingAnd === undefined ? [] : Array.isArray(existingAnd) ? existingAnd : [existingAnd]

  const { salonId: _drop, ...rest } = base

  /*
   * findUnique/update/delete require a unique selector. Models like
   * SalonSettings and Subscription are unique on salonId alone — stripping it
   * leaves an empty where and Prisma rejects the call. Keep salonId when it is
   * the only concrete selector (or when shared-library OR needs the stamp).
   */
  const concreteKeys = Object.keys(rest).filter((key) => key !== 'AND' && key !== 'OR' && key !== 'NOT')
  if (concreteKeys.length === 0) {
    return { salonId, AND: [...and, tenantFilter] }
  }

  return { ...rest, AND: [...and, tenantFilter] }
}

function stampData(model: string, operation: string, data: unknown, salonId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((d) => stampData(model, operation, d, salonId))
  }
  if (data === null || typeof data !== 'object') return data
  const obj = data as AnyArgs
  assertMatches(model, operation, salonId, obj.salonId)
  return { ...obj, salonId }
}

/**
 * Updates must not move a row between tenants, but must not inject `salonId`
 * into relation-style `UpdateInput` either — Prisma rejects the scalar when
 * the payload uses `savedCard: { connect }` / `salon: { connect }`.
 */
function guardUpdateData(model: string, operation: string, data: unknown, salonId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((d) => guardUpdateData(model, operation, d, salonId))
  }
  if (data === null || typeof data !== 'object') return data
  const obj = data as AnyArgs
  assertMatches(model, operation, salonId, obj.salonId)
  const salon = obj.salon
  if (salon && typeof salon === 'object' && salon !== null) {
    const connect = (salon as AnyArgs).connect as AnyArgs | undefined
    if (connect && typeof connect.id === 'string') {
      assertMatches(model, operation, salonId, connect.id)
    }
  }
  return obj
}

/**
 * A Prisma client that can only see one salon.
 *
 * Shared-library models (starter consultation templates, system form
 * templates) additionally expose rows with a NULL salonId on read, but writes
 * are always stamped to the caller's salon so a salon can never edit the
 * shared library.
 */
export function dbFor(salonId: string) {
  return unsafeDb.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (isGlobalModel(model)) return query(args)

          const shared = isSharedLibraryModel(model)
          const next = { ...(args as AnyArgs) }

          if (READ_OPS.has(operation) || WHERE_ONLY_OPS.has(operation)) {
            next.where = scopeWhere(model, operation, next.where, salonId, shared)
          } else if (WHERE_AND_DATA_OPS.has(operation)) {
            next.where = scopeWhere(model, operation, next.where, salonId, shared)
            if (operation === 'upsert') {
              next.create = stampData(model, operation, next.create, salonId)
              // `update` on an upsert must not move a row between tenants.
              if (next.update) next.update = guardUpdateData(model, operation, next.update, salonId)
            } else if (next.data) {
              next.data = guardUpdateData(model, operation, next.data, salonId)
            }
          } else if (CREATE_OPS.has(operation)) {
            next.data = stampData(model, operation, next.data, salonId)
          }

          return query(next)
        },
      },
    },
  })
}

export type TenantDb = ReturnType<typeof dbFor>

/**
 * Interactive transaction client from `dbFor(salonId).$transaction(async (tx) => …)`.
 *
 * The extended client's `tx` is not assignable to `Prisma.TransactionClient`, so
 * helpers that accept a transaction must take this (or a structural subset).
 */
export type TenantTx = TenantDb['$transaction'] extends {
  <R>(
    fn: (client: infer C) => Promise<R>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<R>
}
  ? C
  : never

/** Re-exported so repositories can build typed filters without importing Prisma. */
export { Prisma }
