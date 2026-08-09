/**
 * Which Prisma models are tenant-scoped and which are global.
 *
 * This is the spine of tenant isolation. `tests/integration/tenant-isolation
 * .test.ts` walks the Prisma DMMF and asserts every model in the schema
 * appears in exactly one of these two lists — so adding a model without
 * consciously deciding its tenancy fails CI rather than shipping a leak.
 */

/** Not owned by any salon. Reading one of these across tenants is expected. */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([
  // Identity is global; per-salon roles live on Membership / ClientProfile.
  'User',
  'Account',
  'Session',
  'VerificationToken',
  // Platform catalogues.
  'Plan',
  'RulesetVersion',
  // Cross-tenant infrastructure. The worker reads these as the admin client
  // and sets app.salon_id per job.
  'Job',
  'Outbox',
  'IdempotencyKey',
  'SuppressionEntry',
  'DevOutbox',
  // The tenant root itself: resolved by slug before a tenant context exists
  // (login, branded booking page), so it is scoped in the application layer.
  'Salon',
])

/**
 * Models where `salonId` is nullable because a NULL row is shared platform
 * content — the starter consultation templates and system form templates every
 * salon inherits. Reads must see both their own rows and the NULL ones.
 */
export const SHARED_LIBRARY_MODELS: ReadonlySet<string> = new Set([
  'ConsultationTemplate',
  'ConsultationQuestion',
  'FormTemplate',
  'MessageTemplate',
])

/**
 * Models where `salonId` is nullable for platform-owned rows that tenants must
 * never see. Reads inject `{ salonId }` only (no OR-null widen). Platform rows
 * are written with `unsafeDb`; `dbFor` stamps the caller's salon on create.
 */
export const PLATFORM_NULLABLE_MODELS: ReadonlySet<string> = new Set(['AuditLog'])

export function isGlobalModel(model: string): boolean {
  return GLOBAL_MODELS.has(model)
}

export function isSharedLibraryModel(model: string): boolean {
  return SHARED_LIBRARY_MODELS.has(model)
}

export function isPlatformNullableModel(model: string): boolean {
  return PLATFORM_NULLABLE_MODELS.has(model)
}

