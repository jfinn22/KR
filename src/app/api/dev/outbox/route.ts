import { NextResponse } from 'next/server'
import { listDevOutbox } from '@/server/services/dev-outbox'

export const dynamic = 'force-dynamic'

/**
 * Everything the mock SMS and email adapters "sent".
 *
 * This is what makes the whole notification flow — confirmation, reminder,
 * follow-up — verifiable end to end with no Twilio or Resend account. Refuses
 * to serve in production or outside mock mode so it can never leak real client
 * messages.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.ADAPTER_MODE !== 'mock') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 50)
  return NextResponse.json(await listDevOutbox(limit))
}
