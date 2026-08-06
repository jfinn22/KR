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
  /**
   * Book a service that is set up to need a consultation, without one.
   *
   * Separate from `appointment.book` because it is a different decision. A
   * client booking a trim is using the software; somebody putting a colour in
   * the diary that nobody has assessed is taking clinical responsibility for
   * it, and the reason they give is the record of that.
   */
  'appointment.bookWithoutConsultation',
  /**
   * Book straight into the diary, with no consultation and no plan.
   *
   * Separate from `appointment.book`, which CLIENTS hold — and which they hold
   * for exactly one route: consult, get a plan approved, pick a time from it.
   * Booking an arbitrary basket at an arbitrary time is the desk's job, and
   * leaving it on `appointment.book` would have opened that path to every
   * client with no screen to show for it. A capability nobody drew a button
   * for is still a capability.
   */
  'appointment.bookDirect',
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
  /**
   * Add or remove a card on file.
   *
   * A separate action from `payment.take` on purpose. Taking a payment is a
   * one-off the client is standing there for; keeping a card is a standing
   * permission to charge them when they are not — a different thing to be
   * trusted with, and one an assistant should not hold.
   */
  'card.manage',
  /** Charge, release or forfeit a deposit against a card already on file. */
  'deposit.charge',

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
  'settings.manage',
  'service.manage',
  'consultTemplate.manage',
  'ruleset.configure',
  'form.manage',
  'policy.manage',
  'automation.manage',
  'integration.manage',
  /**
   * Import a salon's history from the platform they are leaving, and undo it.
   *
   * One action for both directions on purpose. An import can create thousands
   * of client records, touch consent state and write appointment history, so it
   * is not a front-desk operation — but gating the undo any harder than the
   * import defeats the point of having one. The owner is going to get the first
   * file wrong, and they need to be able to retry without asking anybody.
   */
  'migration.import',

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
