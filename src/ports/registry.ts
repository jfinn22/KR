import { adapterModeFor, serverEnv } from '@/env'
import { InMemoryMessageSink, type MessageSink } from './types'
import { MockSmsAdapter, TwilioSmsAdapter, type SmsPort } from './sms'
import { MockEmailAdapter, ResendEmailAdapter, type EmailPort } from './email'
import { MockPaymentsAdapter, StripePaymentsAdapter, type PaymentsPort } from './payments'
import { MockStorageAdapter, S3StorageAdapter, type StoragePort } from './storage'
import { AnthropicAiAdapter, DisabledAiAdapter, MockAiAdapter, type AiPort } from './ai'
import { GoogleCalendarAdapter, MockCalendarAdapter, type CalendarPort } from './calendar'
import { LocalEsignAdapter, RemoteEsignAdapter, type EsignPort } from './esign'

/**
 * The composition root.
 *
 * The only place that decides which implementation of a port is live. Nothing
 * else in the application imports a concrete adapter — services take a port.
 *
 * Adapters are memoised: a Stripe client or an S3 client is expensive to build
 * and safe to share, and the mock adapters hold in-memory state (a payment
 * ledger, a calendar) that must survive across calls within a process.
 */

let sink: MessageSink | null = null
const cache = new Map<string, unknown>()

/**
 * Install the sink the mock sms/email adapters deliver into.
 *
 * The app calls this once at startup with a DevOutbox-backed sink. Tests leave
 * it unset and get an in-memory one, which is what lets the port contract suite
 * run in the unit tier with no database.
 */
export function setMessageSink(next: MessageSink): void {
  sink = next
  cache.delete('sms')
  cache.delete('email')
}

export function messageSink(): MessageSink {
  if (!sink) sink = new InMemoryMessageSink()
  return sink
}

function memo<T>(key: string, build: () => T): T {
  const hit = cache.get(key)
  if (hit) return hit as T
  const built = build()
  cache.set(key, built)
  return built
}

export function smsPort(): SmsPort {
  return memo('sms', () => {
    const env = serverEnv()
    return adapterModeFor('sms') === 'real'
      ? new TwilioSmsAdapter(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_FROM_NUMBER)
      : new MockSmsAdapter(messageSink())
  })
}

export function emailPort(): EmailPort {
  return memo('email', () => {
    const env = serverEnv()
    return adapterModeFor('email') === 'real'
      ? new ResendEmailAdapter(env.RESEND_API_KEY, env.EMAIL_FROM)
      : new MockEmailAdapter(messageSink())
  })
}

export function paymentsPort(): PaymentsPort {
  return memo('payments', () => {
    const env = serverEnv()
    return adapterModeFor('payments') === 'real'
      ? new StripePaymentsAdapter(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET)
      : new MockPaymentsAdapter()
  })
}

export function storagePort(): StoragePort {
  return memo('storage', () => {
    const env = serverEnv()
    return adapterModeFor('storage') === 'real'
      ? new S3StorageAdapter(
          env.S3_BUCKET,
          env.S3_REGION,
          env.S3_ACCESS_KEY_ID,
          env.S3_SECRET_ACCESS_KEY,
          env.S3_ENDPOINT,
        )
      : new MockStorageAdapter(env.MOCK_STORAGE_DIR)
  })
}

export function aiPort(): AiPort {
  return memo('ai', () => {
    const env = serverEnv()
    // The global kill switch wins over the adapter mode. With AI off the whole
    // product still works on templates, which is a hard product requirement.
    if (!env.AI_ENABLED) return new DisabledAiAdapter()

    return adapterModeFor('ai') === 'real'
      ? new AnthropicAiAdapter(
          env.ANTHROPIC_API_KEY,
          env.ANTHROPIC_MODEL,
          env.ANTHROPIC_MODEL_HEAVY,
        )
      : new MockAiAdapter({
          latencyMs: env.AI_MOCK_LATENCY_MS,
          failureRate: env.AI_MOCK_FAILURE_RATE,
        })
  })
}

export function calendarPort(): CalendarPort {
  return memo('calendar', () => {
    const env = serverEnv()
    return adapterModeFor('calendar') === 'real'
      ? new GoogleCalendarAdapter(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
      : new MockCalendarAdapter()
  })
}

export function esignPort(): EsignPort {
  return memo('esign', () => {
    return adapterModeFor('esign') === 'real' ? new RemoteEsignAdapter() : new LocalEsignAdapter()
  })
}

/** What each port resolved to — surfaced on the admin integrations screen. */
export function adapterReport(): { port: string; mode: string; name: string }[] {
  return [
    { port: 'payments', mode: adapterModeFor('payments'), name: paymentsPort().name },
    { port: 'sms', mode: adapterModeFor('sms'), name: smsPort().name },
    { port: 'email', mode: adapterModeFor('email'), name: emailPort().name },
    { port: 'storage', mode: adapterModeFor('storage'), name: storagePort().name },
    { port: 'ai', mode: adapterModeFor('ai'), name: aiPort().name },
    { port: 'calendar', mode: adapterModeFor('calendar'), name: calendarPort().name },
    { port: 'esign', mode: adapterModeFor('esign'), name: esignPort().name },
  ]
}
