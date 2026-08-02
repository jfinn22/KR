import { unsafeDb } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/context'

/**
 * Audit trail.
 *
 * Written with the unscoped client on purpose: an audit row must be recorded
 * even when the action it describes was a cross-tenant attempt that the
 * scoped client would have refused to write.
 */
export interface AuditEntry {
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  reason?: string | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

function actorFields(ctx: TenantContext) {
  const p = ctx.principal
  switch (p.kind) {
    case 'staff':
      return { actorType: 'USER' as const, actorUserId: p.userId, actorRole: p.role }
    case 'client':
      return { actorType: 'USER' as const, actorUserId: p.userId, actorRole: 'CLIENT' }
    case 'system':
      return { actorType: 'JOB' as const, actorUserId: null, actorRole: p.jobType }
    case 'platform_admin':
      return { actorType: 'PLATFORM_ADMIN' as const, actorUserId: p.userId, actorRole: 'PLATFORM' }
  }
}

export async function audit(ctx: TenantContext, entry: AuditEntry): Promise<void> {
  const actor = actorFields(ctx)
  await unsafeDb.auditLog.create({
    data: {
      salonId: ctx.salonId,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      actorRole: actor.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      beforeJson: (entry.before ?? undefined) as never,
      afterJson: (entry.after ?? undefined) as never,
      reason: entry.reason ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
    },
  })
}

/**
 * Record an override — a stylist proceeding past a risk flag, a manager
 * waiving a patch-test requirement, a discount above the cap.
 *
 * These are the rows that matter most: they are how a salon later answers
 * "who decided this was safe, and why?".
 */
export async function auditOverride(
  ctx: TenantContext,
  params: {
    action: string
    entityType: string
    entityId: string
    reason: string
    detail?: unknown
  },
): Promise<void> {
  await audit(ctx, {
    action: `override.${params.action}`,
    entityType: params.entityType,
    entityId: params.entityId,
    reason: params.reason,
    after: params.detail,
  })
}
