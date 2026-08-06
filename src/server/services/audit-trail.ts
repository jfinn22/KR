import { unsafeDb } from '@/server/db/client'

/**
 * Reading back what was done, and who did it.
 *
 * `AuditLog` has had three writers since the platform was built and not one
 * reader — every mutation that goes through `withAuthz` lands a row, including
 * the reason where the policy demanded one, and nothing in the product could
 * ever show any of it. `audit.view` has been granted to owners and managers
 * since the golden matrix was written and gated nothing, because there was
 * nothing to gate.
 *
 * That matters more here than most dead reads. The reason a manager typed when
 * they overrode a blocking flag, or discounted past the cap, is written down
 * precisely so somebody can find it later — and "later" is usually an argument,
 * an insurance question, or a client whose hair came off.
 */

export interface AuditEntry {
  id: string
  at: Date
  actorName: string | null
  actorRole: string | null
  actorType: string
  action: string
  entityType: string
  entityId: string | null
  reason: string | null
}

export interface AuditQuery {
  action?: string | null
  entityType?: string | null
  entityId?: string | null
  /** Only entries carrying a written reason — the ones somebody had to justify. */
  reasonedOnly?: boolean
  days?: number
  take?: number
}

export async function auditTrail(
  salonId: string,
  query: AuditQuery = {},
  now = new Date(),
): Promise<AuditEntry[]> {
  const days = query.days ?? 30
  const take = Math.min(query.take ?? 100, 200)

  const rows = await unsafeDb.auditLog.findMany({
    where: {
      /*
       * The salon's own rows only. `AuditLog.salonId` is nullable because
       * platform-level actions have no tenant, and those are not this salon's
       * to read — a null here would widen the query rather than narrow it.
       */
      salonId,
      createdAt: { gte: new Date(now.getTime() - days * 86_400_000) },
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.reasonedOnly ? { reason: { not: null } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      createdAt: true,
      actorType: true,
      actorRole: true,
      actorUserId: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
    },
  })

  /*
   * Names resolved in one pass rather than per row. `User` is global and has no
   * salon relation, so this cannot be a join through the tenant client.
   */
  const userIds = [...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))]
  const users = userIds.length
    ? await unsafeDb.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? u.email]))

  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actorName: row.actorUserId ? (nameOf.get(row.actorUserId) ?? null) : null,
    actorRole: row.actorRole,
    actorType: row.actorType,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    reason: row.reason,
  }))
}

/** The actions this salon has actually taken, for the filter to offer. */
export async function auditActions(salonId: string, days = 30, now = new Date()) {
  const rows = await unsafeDb.auditLog.groupBy({
    by: ['action'],
    where: { salonId, createdAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    _count: { _all: true },
    orderBy: { action: 'asc' },
  })
  return rows.map((row) => ({ action: row.action, count: row._count._all }))
}
