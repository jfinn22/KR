/**
 * Every permission-checked capability in the platform.
 *
 * Pure data. `tests/unit/authz/policy.test.ts` iterates the full
 * Action x Role product against a golden matrix, so adding an action here
 * without deciding who may perform it fails the build.
 */
export const ACTIONS = [
  // --- Consultation -------------------------------------------------------
  'consultation.create',
  'consultation.submit',
  'consultation.view',
  'consultation.viewAny',
  'consultation.review',
  'consultation.reassign',
  'flag.acknowledge',
  'flag.override',
  'flag.overrideBlocker',

  // --- Service plans ------------------------------------------------------
  'plan.view',
  'plan.edit',
  'plan.approve',
  'requirement.waive',

  // --- Booking ------------------------------------------------------------
  'appointment.viewOwn',
  'appointment.viewAny',
  'appointment.book',
  'appointment.bookForAnyStylist',
  'appointment.reschedule',
  'appointment.cancelOwn',
  'appointment.cancelAny',
  'appointment.forceSlot',
  'appointment.checkIn',
  'appointment.markNoShow',
  'hold.create',
  'hold.release',
  'waitlist.manage',

  // --- Clients & hair record ---------------------------------------------
  'client.create',
  'client.viewOwn',
  'client.viewAny',
  'client.edit',
  'client.merge',
  'client.export',
  'client.erase',
  'formula.view',
  'formula.write',
  'hairAssessment.write',

  // --- Commerce -----------------------------------------------------------
  'payment.take',
  'payment.refund',
  'discount.applyWithinCap',
  'discount.applyOverCap',
  'fee.waive',
  'deposit.view',

  // --- Communication ------------------------------------------------------
  'message.send',
  'message.viewAny',
  'aiSuggestion.accept',

  // --- Schedule -----------------------------------------------------------
  'schedule.editOwn',
  'schedule.editAny',
  'timeOff.request',
  'timeOff.approve',

  // --- Catalog & configuration -------------------------------------------
  'service.manage',
  'consultTemplate.manage',
  'ruleset.configure',
  'form.manage',
  'policy.manage',
  'automation.manage',
  'integration.manage',

  // --- Team & business ----------------------------------------------------
  'team.invite',
  'team.changeRole',
  'location.manage',
  'report.viewOwn',
  'report.viewSalon',
  'billing.manage',
  'audit.view',
] as const

export type Action = (typeof ACTIONS)[number]

export const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS)

export function isAction(value: string): value is Action {
  return ACTION_SET.has(value)
}
