import { unsafeDb } from '@/server/db/client'
import { setMessageSink } from '@/ports/registry'
import type { DeliveredMessage, MessageSink } from '@/ports/types'

/**
 * The database-backed sink for the mock sms and email adapters.
 *
 * Everything the mocks "send" lands in `DevOutbox`, browsable at
 * `/api/dev/outbox`. That is what makes the full notification flow —
 * confirmation, reminder, follow-up — verifiable end to end without a Twilio or
 * Resend account.
 *
 * This lives in `src/server` rather than `src/ports` deliberately: it is the
 * one piece of adapter wiring that needs a database, and keeping it out of the
 * ports layer is what lets the port contract suite run in the DB-free unit tier.
 */
class DevOutboxSink implements MessageSink {
  async deliver(message: DeliveredMessage): Promise<void> {
    await unsafeDb.devOutbox.create({
      data: {
        channel: message.channel,
        toAddress: message.to,
        subject: message.subject ?? null,
        body: message.body,
        metaJson: (message.meta ?? undefined) as never,
      },
    })
  }
}

let installed = false

/** Call once at startup. Idempotent. */
export function installOutboxSink(): void {
  if (installed) return
  setMessageSink(new DevOutboxSink())
  installed = true
}
