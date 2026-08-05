import { NextResponse } from 'next/server'
import { handlePaymentWebhook } from '@/server/services/payment-webhooks'

export const dynamic = 'force-dynamic'
/** Node, not edge: signature verification needs the raw body and node:crypto. */
export const runtime = 'nodejs'

/**
 * The provider's callback.
 *
 * Transport only. Everything that decides anything lives in
 * `payment-webhooks.ts`, so the rules can be tested without standing up an
 * HTTP server — and so this file has exactly one job it can get wrong.
 *
 * That job is the raw body. `request.text()` before anything else, because the
 * signature is over the exact bytes sent: parsing to JSON and re-serialising
 * changes key order and whitespace, and verification then fails in a way that
 * looks indistinguishable from an attack.
 *
 * Provider-neutral in the path, because the configured adapter is what parses
 * the payload. A salon on a different processor posts to the same URL.
 */
export async function POST(request: Request) {
  const raw = await request.text()
  const signature =
    request.headers.get('stripe-signature') ?? request.headers.get('x-webhook-signature') ?? ''

  const outcome = await handlePaymentWebhook(raw, signature)
  return NextResponse.json(outcome.body, { status: outcome.status })
}
