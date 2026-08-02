import {
  AdapterError,
  InMemoryMessageSink,
  mockId,
  mockNow,
  requireEnv,
  type MessageSink,
} from './types'

export interface SmsMessage {
  to: string
  body: string
  /** Correlates the provider's delivery webhook back to our Message row. */
  reference?: string
}

export interface SmsResult {
  providerMessageId: string
  segments: number
  status: 'QUEUED' | 'SENT'
}

export interface SmsPort {
  readonly name: string
  send(message: SmsMessage): Promise<SmsResult>
}

/** GSM-7 messages split at 160 characters, 153 when concatenated. */
export function countSegments(body: string): number {
  const length = [...body].length
  if (length === 0) return 1
  if (length <= 160) return 1
  return Math.ceil(length / 153)
}

const E164 = /^\+[1-9]\d{6,14}$/

export function assertPhone(port: string, to: string): void {
  if (!E164.test(to)) {
    throw new AdapterError(port, 'INVALID_RECIPIENT', `"${to}" is not an E.164 phone number.`)
  }
}

// ---------------------------------------------------------------------------

export class MockSmsAdapter implements SmsPort {
  readonly name = 'sms:mock'

  constructor(readonly sink: MessageSink = new InMemoryMessageSink()) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    assertPhone(this.name, message.to)
    if (message.body.trim().length === 0) {
      throw new AdapterError(this.name, 'EMPTY_BODY', 'Refusing to send an empty message.')
    }

    await this.sink.deliver({
      channel: 'SMS',
      to: message.to,
      body: message.body,
      meta: { reference: message.reference },
      at: mockNow(),
    })

    return {
      providerMessageId: mockId('sms', message.to, message.body, message.reference),
      segments: countSegments(message.body),
      status: 'QUEUED',
    }
  }
}

export class TwilioSmsAdapter implements SmsPort {
  readonly name = 'sms:twilio'

  constructor(
    private readonly accountSid?: string,
    private readonly authToken?: string,
    private readonly from?: string,
  ) {}

  async send(message: SmsMessage): Promise<SmsResult> {
    requireEnv('sms', {
      TWILIO_ACCOUNT_SID: this.accountSid,
      TWILIO_AUTH_TOKEN: this.authToken,
      TWILIO_FROM_NUMBER: this.from,
    })
    assertPhone(this.name, message.to)
    if (message.body.trim().length === 0) {
      throw new AdapterError(this.name, 'EMPTY_BODY', 'Refusing to send an empty message.')
    }

    // Imported lazily so an install without the optional dependency still builds.
    const { default: twilio } = await import('twilio')
    const client = twilio(this.accountSid!, this.authToken!)

    try {
      const sent = await client.messages.create({
        to: message.to,
        from: this.from!,
        body: message.body,
      })
      return {
        providerMessageId: sent.sid,
        segments: Number(sent.numSegments ?? countSegments(message.body)),
        status: 'QUEUED',
      }
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0
      throw new AdapterError(
        this.name,
        String((err as { code?: string }).code ?? 'SEND_FAILED'),
        (err as Error).message,
        status === 429 || status >= 500,
      )
    }
  }
}
