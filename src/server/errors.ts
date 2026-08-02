/**
 * Domain error vocabulary.
 *
 * Deliberately in its own module with no imports. Services throw these, and
 * pulling in the whole auth stack — and through it Next.js — just to name an
 * error would make every service untestable outside a request.
 */

export type ActionErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_ACCESS'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'PLAN_UPGRADE_REQUIRED'
  | 'REASON_REQUIRED'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'UNKNOWN'

/** An expected, user-facing failure. Rendered as-is; never a stack trace. */
export class DomainError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionErrorCode; fieldErrors?: Record<string, string[]> }
