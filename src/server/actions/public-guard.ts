import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { z } from 'zod'
import { unsafeDb } from '@/server/db/client'
import { auditPublic } from '@/server/audit'
import { DomainError, toActionError } from './guard'
import type { ActionResult } from '@/server/errors'

/**
 * The mutation path for people who do not have an account yet.
 *
 * `withAuthz` cannot serve these. It opens with `requireContext(salonSlug)`,
 * and `resolveContext` returns null unless the visitor already has a
 * Membership, a ClientProfile or platform admin — which a prospective client,
 * by definition, does not. Every one of signup, joining by code, claiming a
 * booking link and re-confirming consent sits outside the only mutation entry
 * point the codebase had.
 *
 * This is deliberately a SIBLING rather than a flag on `withAuthz`. The two
 * have different security models: one asks "may this person do this?", the
 * other asks "is this person hammering us?" — and the answer to the first is a
 * permission matrix while the answer to the second is a counter. Merging them
 * would mean every authorised action carries a rate limiter it does not need,
 * and every public one carries a permission check it cannot pass.
 *
 * What is NOT done here, on purpose: no `anonymous` Principal kind. Adding one
 * would ripple into `can()`'s exhaustive switch, the golden role matrix, and
 * `actorFields` in the audit layer — three places that are correct precisely
 * because they enumerate a closed set of people who have accounts.
 *
 * The result shape is identical to `withAuthz`'s, so a caller cannot tell
 * which guard it is talking to.
 */

/** The tenant, resolved from a slug alone. No principal, because there is none. */
export interface PublicContext {
  salonId: string
  salonSlug: string
  salonName: string
}

export interface PublicGuardOptions<I> {
  /**
   * Names the attempt in audit rows and rate-limit counters, e.g.
   * `client.signUp`. Deliberately NOT an authz `Action` — nothing here is
   * checked against the role matrix, and reusing that type would suggest it is.
   */
  name: string
  schema: z.ZodType<I>
  /** Attempts allowed per fingerprint per window. */
  limit?: { attempts: number; windowMinutes: number }
  /**
   * What to count against, when the caller's address is the wrong thing.
   *
   * The default fingerprint is a hash of the client IP, which is right for
   * guessing attacks — somebody working through join codes comes from one
   * place. It is wrong for a link sent to a few hundred clients at once: they
   * share their mobile carrier's egress address, so they share one bucket, and
   * the eleventh person to tap loses their answer to a limit the first ten
   * used up. Worse, they lose it BEFORE the handler runs, so nothing records
   * that it happened.
   *
   * Where a request already carries something unguessable and per-person — a
   * token in a one-tap link — that is the honest thing to limit. Return it
   * here and the bucket becomes the link rather than the network.
   */
  subject?: (input: I) => string | null
  auditAs?: (input: I, result: unknown) => { entityType: string; entityId?: string | null }
}

const DEFAULT_LIMIT = { attempts: 10, windowMinutes: 15 }

/**
 * A coarse, privacy-preserving handle on the caller.
 *
 * Hashed rather than stored raw: this table exists to count with, and an
 * unauthenticated endpoint that quietly accumulates a log of visitor IP
 * addresses is a liability nobody asked for. Salted with the salon so the same
 * person visiting two salons is not correlatable across them.
 */
async function fingerprintFor(salonId: string, subject?: string | null): Promise<string> {
  if (subject) {
    return createHash('sha256').update(`${salonId}:s:${subject}`).digest('hex').slice(0, 32)
  }
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')?.split(',')[0]?.trim()
  const address = forwarded || headerList.get('x-real-ip') || 'unknown'
  return createHash('sha256').update(`${salonId}:${address}`).digest('hex').slice(0, 32)
}

export function withPublicAction<I, O>(
  opts: PublicGuardOptions<I>,
  handler: (input: I, ctx: PublicContext) => Promise<O>,
) {
  return async (salonSlug: string, rawInput: unknown): Promise<ActionResult<O>> => {
    try {
      /*
       * Resolve the salon directly rather than through `resolveContext`, which
       * needs a principal. `Salon` is registered as a global model for exactly
       * this reason — the registry calls it "resolved by slug before a tenant
       * context exists".
       */
      const salon = await unsafeDb.salon.findUnique({
        where: { slug: salonSlug },
        select: { id: true, slug: true, name: true, status: true },
      })
      if (!salon || salon.status !== 'ACTIVE') {
        throw new DomainError('NOT_FOUND', 'We could not find that salon.')
      }

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

      /*
       * Rate limit BEFORE the handler and record the attempt either way, so a
       * run of failures counts too — otherwise someone guessing join codes gets
       * unlimited tries precisely because they keep getting them wrong.
       */
      const limit = opts.limit ?? DEFAULT_LIMIT
      const fingerprint = await fingerprintFor(salon.id, opts.subject?.(input) ?? null)
      const since = new Date(Date.now() - limit.windowMinutes * 60_000)

      const recent = await unsafeDb.publicActionAttempt.count({
        where: { salonId: salon.id, name: opts.name, fingerprint, createdAt: { gte: since } },
      })
      if (recent >= limit.attempts) {
        return {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'That is a lot of tries in a short time. Please wait a few minutes and try again.',
        }
      }

      await unsafeDb.publicActionAttempt.create({
        data: { salonId: salon.id, name: opts.name, fingerprint },
      })

      const ctx: PublicContext = {
        salonId: salon.id,
        salonSlug: salon.slug,
        salonName: salon.name,
      }

      const data = await handler(input, ctx)

      if (opts.auditAs) {
        const meta = opts.auditAs(input, data)
        await auditPublic(salon.id, {
          action: opts.name,
          entityType: meta.entityType,
          entityId: meta.entityId ?? null,
          after: data,
        })
      }

      return { ok: true, data }
    } catch (err) {
      return { ok: false, ...toActionError(err) }
    }
  }
}
