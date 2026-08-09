import { z } from 'zod'

/**
 * Validated environment. Import this instead of touching `process.env`.
 *
 * The defaults here are deliberately complete for development and test: with
 * no `.env` at all, every adapter resolves to its mock and the platform runs
 * end to end. Production refuses those defaults — mock adapters and known
 * secrets must never ship.
 */

const adapterMode = z.enum(['mock', 'real'])

const DEV_AUTH_SECRET = 'dev-only-secret-change-me-in-production'
const DEV_CRON_SECRET = 'dev-only-cron-secret'

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    TEST_DATABASE_URL: z.string().optional(),

    AUTH_SECRET: z.string().min(8).default(DEV_AUTH_SECRET),
    AUTH_TRUST_HOST: z.coerce.boolean().default(true),

    ADAPTER_MODE: adapterMode.default('mock'),
    PAYMENTS_ADAPTER: adapterMode.optional(),
    SMS_ADAPTER: adapterMode.optional(),
    EMAIL_ADAPTER: adapterMode.optional(),
    STORAGE_ADAPTER: adapterMode.optional(),
    AI_ADAPTER: adapterMode.optional(),
    CALENDAR_ADAPTER: adapterMode.optional(),
    ESIGN_ADAPTER: adapterMode.optional(),

    AI_ENABLED: z.coerce.boolean().default(true),
    MOCK_STORAGE_DIR: z.string().default('./.uploads'),

    CRON_SECRET: z.string().default(DEV_CRON_SECRET),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
    WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),

    // Mock fault injection — exercises failure paths in dev and CI.
    AI_MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(0),
    AI_MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Salon <noreply@example.com>'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
    ANTHROPIC_MODEL_HEAVY: z.string().default('claude-opus-4-20250514'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return

    if (!env.AUTH_SECRET || env.AUTH_SECRET === DEV_AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message: 'Production requires a strong AUTH_SECRET (32+ chars, not the dev default).',
      })
    }
    if (!env.CRON_SECRET || env.CRON_SECRET === DEV_CRON_SECRET || env.CRON_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRON_SECRET'],
        message: 'Production requires a strong CRON_SECRET (32+ chars, not the dev default).',
      })
    }
    if (env.ADAPTER_MODE === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADAPTER_MODE'],
        message: 'Production refuses ADAPTER_MODE=mock.',
      })
    }
    const ports = [
      'PAYMENTS_ADAPTER',
      'SMS_ADAPTER',
      'EMAIL_ADAPTER',
      'STORAGE_ADAPTER',
      'AI_ADAPTER',
      'CALENDAR_ADAPTER',
      'ESIGN_ADAPTER',
    ] as const
    for (const port of ports) {
      if (env[port] === 'mock') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [port],
          message: `Production refuses ${port}=mock.`,
        })
      }
    }
    if ((env.AI_ADAPTER ?? env.ADAPTER_MODE) === 'real' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANTHROPIC_API_KEY'],
        message: 'AI_ADAPTER=real requires ANTHROPIC_API_KEY.',
      })
    }
  })

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  /**
   * The provider's publishable key, which is public by design — it can create
   * a payment attempt and nothing else.
   *
   * Optional, and absence is the signal rather than an error: with no key the
   * card step falls back to the mock adapter's flow, so the whole booking
   * journey runs end to end in dev and CI without a Stripe account.
   */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
})

export type ServerEnv = z.infer<typeof serverSchema>
export type PortName = 'payments' | 'sms' | 'email' | 'storage' | 'ai' | 'calendar' | 'esign'

let cached: ServerEnv | null = null

/** Parse and cache server env. Throws a readable error listing every problem. */
export function serverEnv(): ServerEnv {
  if (cached) return cached
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment:\n${issues}`)
  }
  cached = parsed.data
  return cached
}

/** Test helper — drop the cache between cases that mutate process.env. */
export function resetServerEnvCache(): void {
  cached = null
}

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  // Written out in full rather than read dynamically: Next inlines
  // `process.env.NEXT_PUBLIC_*` at build time only when it sees the literal.
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
})

const PORT_OVERRIDE: Record<PortName, keyof ServerEnv> = {
  payments: 'PAYMENTS_ADAPTER',
  sms: 'SMS_ADAPTER',
  email: 'EMAIL_ADAPTER',
  storage: 'STORAGE_ADAPTER',
  ai: 'AI_ADAPTER',
  calendar: 'CALENDAR_ADAPTER',
  esign: 'ESIGN_ADAPTER',
}

/** Which implementation a port should use: its own override, else the global mode. */
export function adapterModeFor(port: PortName): 'mock' | 'real' {
  const env = serverEnv()
  const override = env[PORT_OVERRIDE[port]] as 'mock' | 'real' | undefined
  return override ?? env.ADAPTER_MODE
}
