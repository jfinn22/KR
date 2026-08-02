import { notFound, redirect } from 'next/navigation'
import {
  ForbiddenError,
  NoAccessError,
  UnauthenticatedError,
  authorize,
  requireContext,
  type TenantContext,
} from './context'
import type { Action } from '@/domain/authz/actions'
import type { ResourceRef } from '@/domain/authz/principal'

/**
 * Resolving tenant context inside a page.
 *
 * Pages cannot simply call `requireContext` and let it throw. A layout and its
 * pages render in parallel, so a page throwing `UnauthenticatedError` wins the
 * race against the layout's redirect and the visitor gets a server error page
 * instead of a sign-in form — which is what happened before this existed.
 *
 * Every route segment that needs a tenant goes through here.
 */
export async function pageContext(salonSlug: string, returnTo?: string): Promise<TenantContext> {
  try {
    return await requireContext(salonSlug)
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect(`/login?next=${encodeURIComponent(returnTo ?? `/s/${salonSlug}/my`)}`)
    }
    if (err instanceof NoAccessError) notFound()
    throw err
  }
}

/**
 * Context plus a permission check, for a page that is not for everyone.
 *
 * A failed check renders as not-found rather than a forbidden page, on purpose:
 * confirming that `/s/aurora/admin/services` exists but is off-limits tells a
 * client more about the salon's internals than refusing to acknowledge it does.
 * The action layer still answers FORBIDDEN properly, because there the caller
 * already knows the thing exists.
 */
export async function pageContextFor(
  salonSlug: string,
  action: Action,
  resource?: ResourceRef,
): Promise<TenantContext> {
  const ctx = await pageContext(salonSlug)
  try {
    authorize(ctx, action, resource)
  } catch (err) {
    if (err instanceof ForbiddenError) notFound()
    throw err
  }
  return ctx
}
