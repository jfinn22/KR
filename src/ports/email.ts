import {
  AdapterError,
  InMemoryMessageSink,
  mockId,
  mockNow,
  requireEnv,
  type MessageSink,
} from './types'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  reference?: string
}

export interface EmailResult {
  providerMessageId: string
  status: 'QUEUED' | 'SENT'
}

export interface EmailPort {
  readonly name: string
  send(message: EmailMessage): Promise<EmailResult>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function assertEmail(port: string, to: string): void {
  if (!EMAIL.test(to)) {
    throw new AdapterError(port, 'INVALID_RECIPIENT', `"${to}" is not a valid email address.`)
  }
}

/** Crude but dependency-free HTML-to-text for the plain-text alternative. */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<br\s*\/?>/gi, '\n')
      // Block elements get a blank line so the plain-text alternative reads as
      // paragraphs rather than one run-on wall.
      .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
      .replace(/<\/(li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

// ---------------------------------------------------------------------------

export class MockEmailAdapter implements EmailPort {
  readonly name = 'email:mock'

  constructor(readonly sink: MessageSink = new InMemoryMessageSink()) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    assertEmail(this.name, message.to)
    if (message.subject.trim().length === 0) {
      throw new AdapterError(
        this.name,
        'EMPTY_SUBJECT',
        'Refusing to send an email with no subject.',
      )
    }

    await this.sink.deliver({
      channel: 'EMAIL',
      to: message.to,
      subject: message.subject,
      body: message.text ?? htmlToText(message.html),
      meta: { html: message.html, reference: message.reference },
      at: mockNow(),
    })

    return {
      providerMessageId: mockId('email', message.to, message.subject, message.html),
      status: 'QUEUED',
    }
  }
}

export class ResendEmailAdapter implements EmailPort {
  readonly name = 'email:resend'

  constructor(
    private readonly apiKey?: string,
    private readonly from: string = 'Salon <noreply@example.com>',
  ) {}

  async send(message: EmailMessage): Promise<EmailResult> {
    requireEnv('email', { RESEND_API_KEY: this.apiKey })
    assertEmail(this.name, message.to)
    if (message.subject.trim().length === 0) {
      throw new AdapterError(
        this.name,
        'EMPTY_SUBJECT',
        'Refusing to send an email with no subject.',
      )
    }

    const { Resend } = await import('resend')
    const client = new Resend(this.apiKey!)

    const { data, error } = await client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text ?? htmlToText(message.html),
      replyTo: message.replyTo,
    })

    if (error) {
      throw new AdapterError(this.name, error.name ?? 'SEND_FAILED', error.message, true)
    }
    return { providerMessageId: data?.id ?? 'unknown', status: 'QUEUED' }
  }
}
