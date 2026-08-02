import { describe, expect, it } from 'vitest'
import { ACTIONS, type Action } from '@/domain/authz/actions'
import { can, allows, actionsForRole, PERMISSION_MATRIX } from '@/domain/authz/policy'
import type { Principal, ResourceRef, StaffRole } from '@/domain/authz/principal'

const SALON = 'salon_a'
const OTHER = 'salon_b'
const STYLIST = 'stylist_1'
const OTHER_STYLIST = 'stylist_2'
const CLIENT = 'client_1'

const ROLES: StaffRole[] = ['OWNER', 'MANAGER', 'FRONT_DESK', 'STYLIST', 'ASSISTANT']

function staff(role: StaffRole, overrides: Partial<Record<Action, boolean>> = {}): Principal {
  return {
    kind: 'staff',
    userId: 'u1',
    salonId: SALON,
    membershipId: 'm1',
    role,
    stylistProfileId: STYLIST,
    locationIds: ['loc1'],
    overrides,
  }
}

const client: Principal = {
  kind: 'client',
  userId: 'u2',
  salonId: SALON,
  clientProfileId: CLIENT,
}

/** A row owned by the acting stylist and by CLIENT. */
const ownRow: ResourceRef = {
  salonId: SALON,
  ownerStylistId: STYLIST,
  clientProfileId: CLIENT,
}

/** A row belonging to a different stylist and a different client. */
const otherRow: ResourceRef = {
  salonId: SALON,
  ownerStylistId: OTHER_STYLIST,
  clientProfileId: 'client_2',
}

describe('matrix completeness', () => {
  it('every action has a decision for every role', () => {
    for (const action of ACTIONS) {
      expect(PERMISSION_MATRIX[action], `missing matrix row for ${action}`).toBeDefined()
      for (const role of ROLES) {
        expect(
          PERMISSION_MATRIX[action][role],
          `${action} has no decision for ${role}`,
        ).toBeDefined()
      }
    }
  })

  it('owner holds every action in some form', () => {
    expect(actionsForRole('OWNER').length).toBe(ACTIONS.length - countDeniedFor('OWNER'))
  })

  function countDeniedFor(role: StaffRole) {
    return ACTIONS.filter((a) => PERMISSION_MATRIX[a][role] === false).length
  }
})

describe('tenant boundary', () => {
  it.each(ROLES)('%s cannot reach another salon, for any action', (role) => {
    const foreign: ResourceRef = { ...ownRow, salonId: OTHER }
    for (const action of ACTIONS) {
      const result = can(staff(role), action, foreign)
      expect(result.allowed, `${role} was allowed ${action} cross-tenant`).toBe(false)
      if (!result.allowed) expect(result.reason).toBe('WRONG_TENANT')
    }
  })

  it('a client cannot reach another salon', () => {
    for (const action of ACTIONS) {
      expect(can(client, action, { ...ownRow, salonId: OTHER }).allowed).toBe(false)
    }
  })

  it('a platform admin only reaches the salon it is impersonating', () => {
    const admin: Principal = {
      kind: 'platform_admin',
      userId: 'root',
      impersonatingSalonId: SALON,
    }
    expect(can(admin, 'report.viewSalon', ownRow).allowed).toBe(true)
    expect(can(admin, 'report.viewSalon', { salonId: OTHER }).allowed).toBe(false)
  })

  it('a platform admin with no impersonation target reaches nothing', () => {
    const admin: Principal = { kind: 'platform_admin', userId: 'root', impersonatingSalonId: null }
    expect(can(admin, 'report.viewSalon', ownRow).allowed).toBe(false)
  })
})

describe('client scope', () => {
  it('can act on their own records', () => {
    expect(allows(client, 'consultation.submit', ownRow)).toBe(true)
    expect(allows(client, 'appointment.book', ownRow)).toBe(true)
    expect(allows(client, 'plan.view', ownRow)).toBe(true)
  })

  it('cannot act on another client’s records', () => {
    expect(can(client, 'consultation.view', otherRow)).toEqual({
      allowed: false,
      reason: 'NOT_OWNER',
    })
  })

  it('cannot act on unowned salon-level rows', () => {
    expect(can(client, 'consultation.view', { salonId: SALON })).toEqual({
      allowed: false,
      reason: 'CLIENT_SCOPE_ONLY',
    })
  })

  it.each([
    'consultation.review',
    'plan.approve',
    'flag.override',
    'payment.refund',
    'report.viewSalon',
    'team.invite',
    'billing.manage',
    'service.manage',
    'client.viewAny',
  ] as Action[])('is denied the staff action %s', (action) => {
    expect(can(client, action, ownRow)).toEqual({ allowed: false, reason: 'ROLE_NOT_PERMITTED' })
  })
})

describe('stylist ownership', () => {
  it('may review and approve their own consultation', () => {
    expect(allows(staff('STYLIST'), 'consultation.review', ownRow)).toBe(true)
    expect(allows(staff('STYLIST'), 'plan.approve', ownRow)).toBe(true)
  })

  it('may not review another stylist’s consultation', () => {
    expect(can(staff('STYLIST'), 'consultation.review', otherRow)).toEqual({
      allowed: false,
      reason: 'NOT_OWNER',
    })
  })

  it('may not book for another stylist, but front desk may', () => {
    expect(allows(staff('STYLIST'), 'appointment.bookForAnyStylist', otherRow)).toBe(false)
    expect(allows(staff('FRONT_DESK'), 'appointment.bookForAnyStylist', otherRow)).toBe(true)
  })

  it('treats a row with no owner as not-own', () => {
    expect(can(staff('STYLIST'), 'consultation.review', { salonId: SALON })).toEqual({
      allowed: false,
      reason: 'NOT_OWNER',
    })
  })
})

describe('risk flag overrides', () => {
  // The product rule: there is always a way through, and it is always recorded.
  it('a stylist may override a non-blocking flag on their own consultation, with a reason', () => {
    expect(can(staff('STYLIST'), 'flag.override', ownRow)).toEqual({
      allowed: true,
      requiresReason: true,
    })
  })

  it('a stylist may NOT override a blocker', () => {
    expect(allows(staff('STYLIST'), 'flag.overrideBlocker', ownRow)).toBe(false)
  })

  it('a manager may override a blocker, with a reason', () => {
    expect(can(staff('MANAGER'), 'flag.overrideBlocker', ownRow)).toEqual({
      allowed: true,
      requiresReason: true,
    })
  })

  it('front desk may not override any flag — clinical judgement is not theirs', () => {
    expect(allows(staff('FRONT_DESK'), 'flag.override', ownRow)).toBe(false)
    expect(allows(staff('FRONT_DESK'), 'flag.overrideBlocker', ownRow)).toBe(false)
  })

  it('waiving a patch-test requirement is manager-and-above, with a reason', () => {
    expect(allows(staff('STYLIST'), 'requirement.waive', ownRow)).toBe(false)
    expect(allows(staff('FRONT_DESK'), 'requirement.waive', ownRow)).toBe(false)
    expect(can(staff('MANAGER'), 'requirement.waive', ownRow).allowed).toBe(true)
  })
})

describe('separation of duties', () => {
  it('front desk cannot approve consultations', () => {
    expect(allows(staff('FRONT_DESK'), 'consultation.review', ownRow)).toBe(false)
    expect(allows(staff('FRONT_DESK'), 'plan.approve', ownRow)).toBe(false)
  })

  it('only the owner manages billing', () => {
    expect(allows(staff('OWNER'), 'billing.manage', ownRow)).toBe(true)
    for (const role of ['MANAGER', 'FRONT_DESK', 'STYLIST', 'ASSISTANT'] as StaffRole[]) {
      expect(allows(staff(role), 'billing.manage', ownRow), role).toBe(false)
    }
  })

  it('only the owner can export or erase client data', () => {
    expect(allows(staff('OWNER'), 'client.export', ownRow)).toBe(true)
    expect(allows(staff('MANAGER'), 'client.export', ownRow)).toBe(false)
    expect(allows(staff('MANAGER'), 'client.erase', ownRow)).toBe(false)
  })

  it('refunds are manager-and-above; taking payment is not', () => {
    expect(allows(staff('FRONT_DESK'), 'payment.take', ownRow)).toBe(true)
    expect(allows(staff('FRONT_DESK'), 'payment.refund', ownRow)).toBe(false)
    expect(allows(staff('MANAGER'), 'payment.refund', ownRow)).toBe(true)
  })

  it('over-cap discounts need a manager and a reason', () => {
    expect(allows(staff('STYLIST'), 'discount.applyWithinCap', ownRow)).toBe(true)
    expect(allows(staff('STYLIST'), 'discount.applyOverCap', ownRow)).toBe(false)
    expect(can(staff('OWNER'), 'discount.applyOverCap', ownRow)).toEqual({
      allowed: true,
      requiresReason: true,
    })
  })

  it('assistants cannot take payment or manage the schedule', () => {
    expect(allows(staff('ASSISTANT'), 'payment.take', ownRow)).toBe(false)
    expect(allows(staff('ASSISTANT'), 'schedule.editAny', ownRow)).toBe(false)
  })
})

describe('membership overrides', () => {
  it('an override can revoke an action the role would otherwise hold', () => {
    const p = staff('MANAGER', { 'payment.refund': false })
    expect(can(p, 'payment.refund', ownRow)).toEqual({
      allowed: false,
      reason: 'ROLE_NOT_PERMITTED',
    })
  })

  it('an override can grant an action the role lacks, and it requires a reason', () => {
    const p = staff('FRONT_DESK', { 'payment.refund': true })
    expect(can(p, 'payment.refund', ownRow)).toEqual({ allowed: true, requiresReason: true })
  })

  it('an override never crosses the tenant boundary', () => {
    const p = staff('ASSISTANT', { 'billing.manage': true })
    expect(can(p, 'billing.manage', { salonId: OTHER }).allowed).toBe(false)
  })
})

describe('system principal', () => {
  const job: Principal = { kind: 'system', jobId: 'j1', jobType: 'waitlist.match', salonId: SALON }

  it('may do the small set of things automation needs', () => {
    expect(allows(job, 'waitlist.manage', ownRow)).toBe(true)
    expect(allows(job, 'message.send', ownRow)).toBe(true)
    expect(allows(job, 'hold.release', ownRow)).toBe(true)
  })

  it('may not approve, refund, or change configuration', () => {
    expect(allows(job, 'plan.approve', ownRow)).toBe(false)
    expect(allows(job, 'payment.refund', ownRow)).toBe(false)
    expect(allows(job, 'service.manage', ownRow)).toBe(false)
  })

  it('a salon-scoped job cannot touch a different salon', () => {
    expect(allows(job, 'message.send', { ...ownRow, salonId: OTHER })).toBe(false)
  })
})
