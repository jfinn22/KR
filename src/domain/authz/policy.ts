import { ACTIONS, type Action } from './actions'
import type { DenyReason, Principal, PolicyResult, ResourceRef, StaffRole } from './principal'

/**
 * Authorization policy. A pure function of (principal, action, resource) —
 * no database, no session, no I/O — so the entire matrix is exhaustively
 * testable and cheap to reason about.
 */

/**
 * How strongly a role holds an action.
 *
 *  - `false`             denied
 *  - `ALL`               permitted on any row in the salon
 *  - `OWN`               only on rows the principal owns (their clients, chair)
 *  - `ALL_WITH_REASON`   permitted, but a written reason is required and audited
 *  - `OWN_WITH_REASON`   own rows only, and a reason is required
 */
type Grant = false | 'ALL' | 'OWN' | 'ALL_WITH_REASON' | 'OWN_WITH_REASON'

const N = false
const A = 'ALL' as const
const O = 'OWN' as const
const AR = 'ALL_WITH_REASON' as const
const OR = 'OWN_WITH_REASON' as const

type RoleRow = Record<StaffRole, Grant>

/** [OWNER, MANAGER, FRONT_DESK, STYLIST, ASSISTANT] */
const row = (
  owner: Grant,
  manager: Grant,
  frontDesk: Grant,
  stylist: Grant,
  assistant: Grant,
): RoleRow => ({
  OWNER: owner,
  MANAGER: manager,
  FRONT_DESK: frontDesk,
  STYLIST: stylist,
  ASSISTANT: assistant,
})

/**
 * The staff permission matrix.
 *
 * Two deliberate choices worth calling out:
 *
 * 1. A stylist can override a CAUTION or HIGH flag on their own consultation,
 *    with a reason. Only a manager or owner can override a BLOCKER. If the
 *    software blocks a booking a stylist would have taken and gives them no
 *    way through, they stop using the software — so there is always a path,
 *    and it is always recorded.
 *
 * 2. Front desk can move anyone's appointments but cannot approve a
 *    consultation. Clinical judgement stays with the person who does the hair.
 */
const MATRIX: Record<Action, RoleRow> = {
  // Consultation
  'consultation.create': row(A, A, A, A, A),
  'consultation.submit': row(A, A, A, A, A),
  'consultation.view': row(A, A, A, O, O),
  'consultation.viewAny': row(A, A, A, N, N),
  'consultation.review': row(A, A, N, O, N),
  'consultation.reassign': row(A, A, A, N, N),
  'flag.acknowledge': row(A, A, A, O, N),
  'flag.override': row(AR, AR, N, OR, N),
  'flag.overrideBlocker': row(AR, AR, N, N, N),

  // Service plans
  'plan.view': row(A, A, A, O, O),
  'plan.edit': row(A, A, N, O, N),
  'plan.approve': row(A, A, N, O, N),
  'requirement.waive': row(AR, AR, N, N, N),

  // Booking
  'appointment.viewOwn': row(A, A, A, A, A),
  'appointment.viewAny': row(A, A, A, N, N),
  'appointment.book': row(A, A, A, A, A),
  'appointment.bookForAnyStylist': row(A, A, A, N, N),
  'appointment.reschedule': row(A, A, A, O, N),
  'appointment.cancelOwn': row(A, A, A, A, A),
  'appointment.cancelAny': row(A, A, A, O, N),
  'appointment.forceSlot': row(AR, AR, AR, OR, N),
  'appointment.checkIn': row(A, A, A, A, A),
  'appointment.markNoShow': row(A, A, A, O, N),
  'hold.create': row(A, A, A, A, A),
  'hold.release': row(A, A, A, O, N),
  'waitlist.manage': row(A, A, A, O, N),

  // Clients & hair record
  'client.create': row(A, A, A, A, A),
  'client.viewOwn': row(A, A, A, A, A),
  'client.viewAny': row(A, A, A, O, O),
  'client.edit': row(A, A, A, O, N),
  'client.merge': row(A, A, A, N, N),
  'client.export': row(A, N, N, N, N),
  'client.erase': row(AR, N, N, N, N),
  'formula.view': row(A, A, A, A, A),
  'formula.write': row(A, A, N, O, O),
  'hairAssessment.write': row(A, A, N, O, N),

  // Commerce
  'payment.take': row(A, A, A, A, N),
  'payment.refund': row(A, A, N, N, N),
  'discount.applyWithinCap': row(A, A, A, A, N),
  'discount.applyOverCap': row(AR, AR, N, N, N),
  'fee.waive': row(A, A, AR, N, N),
  'deposit.view': row(A, A, A, O, N),
  // A stylist may take a card for their own client — the conversation about a
  // deposit happens in the chair, not at the desk. An assistant may not: a
  // standing permission to charge somebody is not a junior's to collect.
  'card.manage': row(A, A, A, O, N),
  // Forfeiting a deposit takes money from someone who is not in the room, so
  // it carries a written reason at every level that holds it.
  'deposit.charge': row(AR, AR, AR, N, N),

  // Communication
  'message.send': row(A, A, A, O, N),
  'message.viewAny': row(A, A, A, N, N),
  'aiSuggestion.accept': row(A, A, A, O, N),

  // Schedule
  'schedule.editOwn': row(A, A, A, A, A),
  'schedule.editAny': row(A, A, A, N, N),
  'timeOff.request': row(A, A, A, A, A),
  'timeOff.approve': row(A, A, N, N, N),

  // Catalog & configuration
  /*
   * How the salon itself is configured — interleaving, branding, and the
   * settings the later phases add. Manager-and-above, like every other
   * `.manage`: front desk moves the day around, it does not change the rules
   * the day is scheduled by.
   */
  'settings.manage': row(A, A, N, N, N),
  'service.manage': row(A, A, N, N, N),
  'consultTemplate.manage': row(A, A, N, N, N),
  'ruleset.configure': row(AR, AR, N, N, N),
  'form.manage': row(A, A, N, N, N),
  'policy.manage': row(A, A, N, N, N),
  'automation.manage': row(A, A, N, N, N),
  'integration.manage': row(A, A, N, N, N),

  // Team & business
  'team.invite': row(A, A, N, N, N),
  'team.changeRole': row(A, A, N, N, N),
  'location.manage': row(A, A, N, N, N),
  'report.viewOwn': row(A, A, A, A, N),
  'report.viewSalon': row(A, A, N, N, N),
  'billing.manage': row(A, N, N, N, N),
  'audit.view': row(A, A, N, N, N),
}

/**
 * What a client may do, always and only against their own records. Kept as a
 * separate allowlist rather than a sixth column: a client is not a weak
 * staff member, and conflating the two is how privilege bugs happen.
 */
const CLIENT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'consultation.create',
  'consultation.submit',
  'consultation.view',
  'plan.view',
  'appointment.viewOwn',
  'appointment.book',
  'appointment.cancelOwn',
  'appointment.checkIn',
  'hold.create',
  'client.viewOwn',
  'formula.view',
  'message.send',
  'deposit.view',
  // A client keeps their own cards. Nobody else's — `CLIENT_SCOPED_ACTIONS`
  // is checked against their own `clientProfileId`.
  'card.manage',
])

/** Actions a background job may perform on behalf of the system. */
const SYSTEM_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'consultation.view',
  'consultation.viewAny',
  'plan.view',
  'appointment.viewAny',
  'appointment.markNoShow',
  'hold.release',
  'waitlist.manage',
  'client.viewAny',
  'message.send',
  'report.viewSalon',
])

const deny = (reason: DenyReason): PolicyResult => ({ allowed: false, reason })

/**
 * Decide whether `principal` may perform `action` on `resource`.
 *
 * Tenant match is checked first and unconditionally — no role, not even owner,
 * reaches across salons.
 */
export function can(principal: Principal, action: Action, resource: ResourceRef): PolicyResult {
  switch (principal.kind) {
    case 'platform_admin': {
      // Impersonation is time-boxed and audited at the session layer; here it
      // only ever grants access to the salon actually being impersonated.
      if (principal.impersonatingSalonId !== resource.salonId) return deny('WRONG_TENANT')
      return { allowed: true, requiresReason: true }
    }

    case 'system': {
      if (principal.salonId !== null && principal.salonId !== resource.salonId) {
        return deny('WRONG_TENANT')
      }
      if (!SYSTEM_ACTIONS.has(action)) return deny('ROLE_NOT_PERMITTED')
      return { allowed: true }
    }

    case 'client': {
      if (principal.salonId !== resource.salonId) return deny('WRONG_TENANT')
      if (!CLIENT_ACTIONS.has(action)) return deny('ROLE_NOT_PERMITTED')
      // A client may only ever touch their own rows. An unowned resource
      // (no clientProfileId) is not theirs to act on.
      if (resource.clientProfileId == null) return deny('CLIENT_SCOPE_ONLY')
      if (resource.clientProfileId !== principal.clientProfileId) return deny('NOT_OWNER')
      return { allowed: true }
    }

    case 'staff': {
      if (principal.salonId !== resource.salonId) return deny('WRONG_TENANT')

      // A per-membership override can revoke or grant a single action without
      // moving someone between roles.
      const override = principal.overrides[action]
      if (override === false) return deny('ROLE_NOT_PERMITTED')

      const grant = MATRIX[action][principal.role]
      if (grant === false) {
        return override === true
          ? { allowed: true, requiresReason: true }
          : deny('ROLE_NOT_PERMITTED')
      }

      const ownOnly = grant === 'OWN' || grant === 'OWN_WITH_REASON'
      const requiresReason = grant === 'ALL_WITH_REASON' || grant === 'OWN_WITH_REASON'

      if (ownOnly && !ownsResource(principal, resource)) return deny('NOT_OWNER')

      return requiresReason ? { allowed: true, requiresReason: true } : { allowed: true }
    }
  }
}

function ownsResource(
  principal: Extract<Principal, { kind: 'staff' }>,
  resource: ResourceRef,
): boolean {
  // Rows with no owner at all (a salon-level setting) are not "own" rows.
  if (resource.ownerStylistId == null) return false
  return (
    principal.stylistProfileId != null && resource.ownerStylistId === principal.stylistProfileId
  )
}

/** Convenience for call sites that only need a boolean. */
export function allows(principal: Principal, action: Action, resource: ResourceRef): boolean {
  return can(principal, action, resource).allowed
}

/** Every action a role holds in any form. Used to render navigation. */
export function actionsForRole(role: StaffRole): Action[] {
  return ACTIONS.filter((a) => MATRIX[a][role] !== false)
}

export { MATRIX as PERMISSION_MATRIX, CLIENT_ACTIONS, SYSTEM_ACTIONS }
