import { unsafeDb } from '@/server/db/client'
import { adapterReport } from '@/ports/registry'

/**
 * Reading back what the mock adapters "sent".
 *
 * Lives here rather than in the route handler because route handlers are barred
 * from importing the Prisma client — the boundary is enforced by ESLint, and it
 * is worth keeping even for a development convenience.
 */
export interface OutboxView {
  adapters: { port: string; mode: string; name: string }[]
  count: number
  messages: {
    id: string
    channel: string
    to: string
    subject: string | null
    body: string
    at: Date
  }[]
}

export async function listDevOutbox(limit = 50): Promise<OutboxView> {
  const messages = await unsafeDb.devOutbox.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
  })

  return {
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
  }
}
