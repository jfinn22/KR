import { z } from 'zod'
import type { Action } from '@/domain/authz/actions'
import type { ResourceRef } from '@/domain/authz/principal'
import {
  ForbiddenError,
  NoAccessError,
  UnauthenticatedError,
  authorize,
  needsReason,
  requireContext,
  type TenantContext,
} from '@/server/auth/context'
import { FeatureNotInPlanError, requireFeature, type Feature } from '@/domain/authz/plan-features'
import { audit } from '@/server/audit'

/**
 * The single wrapper every mutation goes through.
 *
 * Resolve context -> validate input -> check plan tier -> check permission ->
 * demand a reason where the policy requires one -> run -> audit.
 *
 * Because it is the only path, "did we remember to authorize this?" stops
 * being a question anyone has to ask per endpoint.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionErrorCode; fieldErrors?: Record<string, string[]> }

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

/** Thrown by services for expected, user-facing failures. */
export class DomainError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export interface GuardOptions<I> {
  action: Action
  schema: z.ZodType<I>
  /** Plan feature required, if any. */
  feature?: Feature
  /** Derive the row being acted on so ownership rules can apply. */
  resource?: (input: I, ctx: TenantContext) => ResourceRef | Promise<ResourceRef>
  /** Audit metadata. Omit to skip the audit row (reads, idempotent no-ops). */
  auditAs?: (input: I, result: unknown) => { entityType: string; entityId?: string | null }
}

/**
 * Wrap a server action body. The returned function takes the salon slug plus
 * raw input and never throws — callers get a discriminated result they can
 * render directly.
 */
export function withAuthz<I, O>(
  opts: GuardOptions<I>,
  handler: (input: I, ctx: TenantContext) => Promise<O>,
) {
  return async (salonSlug: string, rawInput: unknown): Promise<ActionResult<O>> => {
    try {
      const ctx = await requireContext(salonSlug)

      const parsed = opts.schema.safeParse(rawInput)
      if (!parsed.success) {
        return {
          ok: false,
          code: 'INVALID_INPUT',
          error: 'Please check the highlighted fields.',
          fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
        }
      }
      const input = parsed.data

      if (opts.feature) requireFeature(ctx.plan, opts.feature)

      const resource = opts.resource ? await opts.resource(input, ctx) : { salonId: ctx.salonId }
      authorize(ctx, opts.action, resource)

      // Where the policy demands a reason, the input must actually carry one.
      if (needsReason(ctx, opts.action, resource)) {
        const reason = (input as { reason?: unknown }).reason
        if (typeof reason !== 'string' || reason.trim().length < 8) {
          return {
            ok: false,
            code: 'REASON_REQUIRED',
            error: 'This action needs a short written reason — it goes on the record.',
          }
        }
      }

      const data = await handler(input, ctx)

      if (opts.auditAs) {
        const meta = opts.auditAs(input, data)
        await audit(ctx, {
          action: opts.action,
          entityType: meta.entityType,
          entityId: meta.entityId ?? null,
          reason: (input as { reason?: string }).reason ?? null,
          after: data,
        })
      }

      return { ok: true, data }
    } catch (err) {
      return { ok: false, ...toActionError(err) }
    }
  }
}

export function toActionError(err: unknown): { code: ActionErrorCode; error: string } {
  if (err instanceof UnauthenticatedError) {
    return { code: 'UNAUTHENTICATED', error: 'Please sign in to continue.' }
  }
  if (err instanceof NoAccessError) {
    return { code: 'NO_ACCESS', error: 'You do not have access to this salon.' }
  }
  if (err instanceof ForbiddenError) {
    return { code: 'FORBIDDEN', error: 'You do not have permission to do that.' }
  }
  if (err instanceof FeatureNotInPlanError) {
    return {
      code: 'PLAN_UPGRADE_REQUIRED',
      error: err.requiredPlan
        ? `That feature is available from the ${err.requiredPlan} plan.`
        : 'That feature is not available on your plan.',
    }
  }
  if (err instanceof DomainError) return { code: err.code, error: err.message }

  console.error('[action] unhandled error', err)
  return { code: 'UNKNOWN', error: 'Something went wrong. Please try again.' }
}
