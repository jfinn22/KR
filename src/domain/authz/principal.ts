import type { Action } from './actions'

export type StaffRole = 'OWNER' | 'MANAGER' | 'FRONT_DESK' | 'STYLIST' | 'ASSISTANT'

/**
 * Who is acting.
 *
 * A client is deliberately NOT a staff membership with an extra role — it is a
 * distinct variant backed by a per-salon ClientProfile. That makes "client
 * accidentally acquires staff permissions" unrepresentable rather than merely
 * unlikely.
 */
export type Principal =
  | {
      kind: 'staff'
      userId: string
      salonId: string
      membershipId: string
      role: StaffRole
      stylistProfileId: string | null
      locationIds: readonly string[]
      overrides: Readonly<Partial<Record<Action, boolean>>>
    }
  | {
      kind: 'client'
      userId: string
      salonId: string
      clientProfileId: string
    }
  | {
      /** Background jobs and webhooks. Scoped per job, never ambient. */
      kind: 'system'
      jobId: string
      jobType: string
      salonId: string | null
    }
  | {
      kind: 'platform_admin'
      userId: string
      impersonatingSalonId: string | null
    }

/** The row being acted on, reduced to what the policy needs to decide. */
export interface ResourceRef {
  salonId: string
  /** Set when the row belongs to a particular stylist (their client, their chair). */
  ownerStylistId?: string | null
  /** Set when the row belongs to a particular client. */
  clientProfileId?: string | null
  locationId?: string | null
}

export type DenyReason =
  | 'WRONG_TENANT'
  | 'ROLE_NOT_PERMITTED'
  | 'NOT_OWNER'
  | 'REQUIRES_REASON'
  | 'CLIENT_SCOPE_ONLY'
  | 'MEMBERSHIP_INACTIVE'

export type PolicyResult =
  { allowed: true; requiresReason?: boolean } | { allowed: false; reason: DenyReason }

export function isStaff(p: Principal): p is Extract<Principal, { kind: 'staff' }> {
  return p.kind === 'staff'
}

/** The salon this principal is acting within, if any. */
export function principalSalonId(p: Principal): string | null {
  switch (p.kind) {
    case 'staff':
    case 'client':
      return p.salonId
    case 'system':
      return p.salonId
    case 'platform_admin':
      return p.impersonatingSalonId
  }
}
