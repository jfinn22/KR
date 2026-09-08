import { cache } from 'react'
import { auth } from './config'
import { unsafeDb } from '@/server/db/client'
import { dbFor, type TenantDb } from '@/server/db/tenant-client'
import type { Action } from '@/domain/authz/actions'
import type { Principal, ResourceRef, StaffRole } from '@/domain/authz/principal'
import { can } from '@/domain/authz/policy'
import type { PlanCode } from '@/domain/authz/plan-features'

/**
 * The one place a request's identity, tenant and permissions are established.
 *
 * Everything downstream takes a TenantContext rather than reaching for the
 * session itself, which is what keeps the "which salon is this?" question from
 * being answered in fifty different places.
 */
export interface TenantContext {
  readonly salonId: string
  readonly salonSlug: string
  readonly salonName: string
  readonly timezone: string
  readonly currency: string
  readonly principal: Principal
  readonly plan: PlanCode
  readonly db: TenantDb
  readonly now: Date
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'UnauthenticatedError'
  }
}

export class NoAccessError extends Error {
  constructor(readonly salonSlug: string) {
    super(`No access to salon ${salonSlug}`)
    this.name = 'NoAccessError'
  }
}

export class ForbiddenError extends Error {
  constructor(
    readonly action: Action,
    readonly reason: string,
  ) {
    super(`Not permitted: ${action} (${reason})`)
    this.name = 'ForbiddenError'
  }
}

/** Cached per render pass so a page with ten server components does one lookup. */
export const currentUserId = cache(async (): Promise<string | null> => {
  const session = await auth()
  return session?.user?.id ?? null
})

/**
 * Resolve the acting principal for a salon.
 *
 * Staff membership is checked first, then client profile. A user who is both
 * (a stylist who is also a client of the salon they work at — common) acts as
 * staff, because that is the context they are in when using the staff routes.
 */
export const resolveContext = cache(async (salonSlug: string): Promise<TenantContext | null> => {
  const userId = await currentUserId()
  if (!userId) return null

  const salon = await unsafeDb.salon.findUnique({
    where: { slug: salonSlug },
    select: {
      id: true,
      slug: true,
      name: true,
      defaultTimezone: true,
      currency: true,
      subscription: { select: { planCode: true } },
    },
  })
  if (!salon) return null

  const plan: PlanCode = (salon.subscription?.planCode as PlanCode | undefined) ?? 'STARTER'

  const [user, membership, clientProfile] = await Promise.all([
    unsafeDb.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } }),
    unsafeDb.membership.findUnique({
      where: { salonId_userId: { salonId: salon.id, userId } },
      select: {
        id: true,
        role: true,
        status: true,
        permissionOverridesJson: true,
        stylistProfile: { select: { id: true, defaultLocationId: true } },
      },
    }),
    unsafeDb.clientProfile.findFirst({
      where: { salonId: salon.id, userId, status: 'ACTIVE' },
      select: { id: true },
    }),
  ])

  let principal: Principal | null = null

  if (membership && membership.status === 'ACTIVE') {
    principal = {
      kind: 'staff',
      userId,
      salonId: salon.id,
      membershipId: membership.id,
      role: membership.role as StaffRole,
      stylistProfileId: membership.stylistProfile?.id ?? null,
      locationIds: membership.stylistProfile?.defaultLocationId
        ? [membership.stylistProfile.defaultLocationId]
        : [],
      overrides: (membership.permissionOverridesJson as Record<Action, boolean> | null) ?? {},
    }
  } else if (clientProfile) {
    principal = {
      kind: 'client',
      userId,
      salonId: salon.id,
      clientProfileId: clientProfile.id,
    }
  } else if (user?.isPlatformAdmin) {
    principal = { kind: 'platform_admin', userId, impersonatingSalonId: salon.id }
  }

  if (!principal) return null

  return {
    salonId: salon.id,
    salonSlug: salon.slug,
    salonName: salon.name,
    timezone: salon.defaultTimezone,
    currency: salon.currency,
    principal,
    plan,
    db: dbFor(salon.id),
    now: new Date(),
  }
})

/** Resolve a context or throw. Use in server components and actions. */
export async function requireContext(salonSlug: string): Promise<TenantContext> {
  const userId = await currentUserId()
  if (!userId) throw new UnauthenticatedError()
  const ctx = await resolveContext(salonSlug)
  if (!ctx) throw new NoAccessError(salonSlug)
  return ctx
}

/** Throw unless the principal may perform `action` on `resource`. */
export function authorize(ctx: TenantContext, action: Action, resource?: ResourceRef): void {
  const target: ResourceRef = resource ?? { salonId: ctx.salonId }
  const result = can(ctx.principal, action, target)
  if (!result.allowed) throw new ForbiddenError(action, result.reason)
}

/** Whether the action is permitted — for conditionally rendering UI. */
export function permitted(ctx: TenantContext, action: Action, resource?: ResourceRef): boolean {
  return can(ctx.principal, action, resource ?? { salonId: ctx.salonId }).allowed
}

/** Whether the action needs a written, audited reason. */
export function needsReason(ctx: TenantContext, action: Action, resource?: ResourceRef): boolean {
  const r = can(ctx.principal, action, resource ?? { salonId: ctx.salonId })
  return r.allowed === true && r.requiresReason === true
}
