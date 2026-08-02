import { NextResponse } from 'next/server'
import { unsafeDb } from '@/server/db/client'
import { adapterReport } from '@/ports/registry'

export const dynamic = 'force-dynamic'

/**
 * Everything the mock SMS and email adapters "sent".
 *
 * This is what makes the whole notification flow — confirmation, reminder,
 * follow-up — verifiable end to end with no Twilio or Resend account. Disabled
 * outright in production so it can never leak client messages.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.ADAPTER_MODE !== 'mock') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }

  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 50), 200)

  const messages = await unsafeDb.devOutbox.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    adapters: adapterReport(),
    count: messages.length,
    messages: messages.map((m) => ({
      id: m.id,
      channel: m.channel,
      to: m.toAddress,
      subject: m.subject,
      body: m.body,
      at: m.createdAt,
    })),
  })
}
