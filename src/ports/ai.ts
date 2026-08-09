import { createHash } from 'node:crypto'
import { z } from 'zod'
import { AdapterError, requireEnv } from './types'

/**
 * The AI port.
 *
 * Everything the model produces is advisory. It summarises, describes, explains
 * a flag that has ALREADY fired, and drafts messages a human still has to send.
 * It cannot create or suppress a risk flag, and `src/domain/**` is forbidden by
 * ESLint from importing `@/ports/*` at all — so the deterministic path is out of
 * the model's reach structurally, not by convention.
 */

export type AiTask =
  | 'consultation.summary'
  | 'photo.analysis'
  | 'inspiration.attributes'
  | 'risk.explain'
  | 'formula.suggest'
  | 'intake.normalize'

export interface AiImage {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  label: string
}

export interface AiRequest<T> {
  task: AiTask
  promptVersion: string
  /** Already redacted. The port asserts this rather than trusting it. */
  input: unknown
  schema: z.ZodType<T>
  images?: readonly AiImage[]
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
}

export interface AiResult<T> {
  ok: boolean
  value: T | null
  model: string
  promptVersion: string
  inputHash: string
  tokensIn: number
  tokensOut: number
  costMicros: number
  latencyMs: number
  error?: {
    code: 'SCHEMA_INVALID' | 'REFUSED' | 'RATE_LIMITED' | 'DISABLED' | 'TRANSPORT' | 'BUDGET'
    message: string
  }
}

export interface AiPort {
  readonly name: string
  complete<T>(request: AiRequest<T>): Promise<AiResult<T>>
}

export function inputHashOf(request: AiRequest<unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify({ t: request.task, v: request.promptVersion, i: request.input }))
    .digest('hex')
}

/**
 * Refuses to transmit anything that looks like direct identifiers.
 *
 * Defence in depth: the service layer redacts before calling, and this catches
 * the case where someone forgets. A leak of client PII to a third-party model
 * is not a bug we want to find out about from a client.
 */
const PII_PATTERNS: readonly [string, RegExp][] = [
  ['an email address', /[\w.+-]+@[\w-]+\.[\w.]{2,}/],
  ['a phone number', /\+?\d[\d\s().-]{8,}\d/],
]

export function assertRedacted(port: string, input: unknown): void {
  const serialized = JSON.stringify(input ?? {})
  for (const [label, pattern] of PII_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new AdapterError(
        port,
        'PII_DETECTED',
        `Refusing to send what looks like ${label} to the model. ` +
          `Redact before calling the AI port.`,
      )
    }
  }
}

/** Deterministic pseudo-random in [0,1) derived from a hash and a salt. */
function seeded(hash: string, salt: string): number {
  const digest = createHash('sha256').update(`${hash}:${salt}`).digest()
  return digest.readUInt32BE(0) / 0xffffffff
}

function pick<T>(hash: string, salt: string, options: readonly T[]): T {
  return options[Math.floor(seeded(hash, salt) * options.length)] ?? options[0]!
}

/**
 * Deterministic stand-in output per task.
 *
 * Generated in code rather than read from JSON fixtures so it can never drift
 * out of sync with the zod schema it has to satisfy — a fixture file that stops
 * matching its schema fails at runtime; this cannot.
 */
function mockPayload(task: AiTask, hash: string): unknown {
  switch (task) {
    case 'consultation.summary':
      return {
        headline: pick(hash, 'h', [
          'Colour correction with box-dye history',
          'Maintenance blonde, straightforward',
          'First-time client wanting a big change',
        ]),
        summary:
          'Reports home colour on the mid-lengths and ends. Goal is several levels lighter ' +
          'than the current base. Photos show visible banding from mid-shaft down. Client has ' +
          'indicated they are open to more than one visit.',
        watchFor: [
          'Patch test status should be confirmed before any oxidative colour.',
          'Banding on the lengths may need a corrective approach.',
        ],
      }

    case 'photo.analysis':
      return {
        observations: [
          {
            attribute: 'banding',
            present: seeded(hash, 'b') > 0.5,
            note: 'Visible demarcation mid-shaft.',
          },
          {
            attribute: 'regrowth',
            present: true,
            note: `Approximately ${Math.round(2 + seeded(hash, 'r') * 5)}cm.`,
          },
          {
            attribute: 'breakage',
            present: seeded(hash, 'k') > 0.75,
            note: 'Some short broken pieces at the crown.',
          },
        ],
        estimatedLevelRoots: 3 + Math.floor(seeded(hash, 'lr') * 5),
        estimatedLevelEnds: 4 + Math.floor(seeded(hash, 'le') * 5),
        confidence: Number((0.4 + seeded(hash, 'pc') * 0.4).toFixed(2)),
        cautions: ['Lighting may be affecting apparent tone. Confirm in person.'],
      }

    case 'inspiration.attributes':
      return {
        attributes: [
          {
            key: 'TARGET_LEVEL',
            value: String(7 + Math.floor(seeded(hash, 'tl') * 3)),
            confidence: 0.7,
          },
          {
            key: 'TARGET_TONE',
            value: pick(hash, 'tt', ['cool', 'neutral', 'warm']),
            confidence: 0.6,
          },
          {
            key: 'TECHNIQUE',
            value: pick(hash, 'tq', ['BALAYAGE', 'FOILS', 'ROOT_SHADOW']),
            confidence: 0.65,
          },
        ],
      }

    case 'risk.explain':
      return {
        plainEnglish:
          'Home colour builds up on the ends over time, so it lifts unevenly. Taking it lighter ' +
          'gradually protects the condition of your hair and gives a much cleaner result than ' +
          'forcing it in one appointment.',
      }

    case 'formula.suggest':
      return {
        rationale:
          'A mid-lift base with a cool toner keeps warmth under control without forcing the ends.',
        developerVolume: pick(hash, 'dv', [10, 20, 30]),
        processingTimeMin: 20 + Math.floor(seeded(hash, 'pt') * 25),
        cautions: ['Strand test before full application.'],
      }

    case 'intake.normalize':
      return {
        candidates: [
          {
            factKey: 'hair.naturalLevel',
            value: 5 + Math.floor(seeded(hash, 'n') * 3),
            confidence: 0.6,
          },
          {
            factKey: 'goal.targetLevel',
            value: 8 + Math.floor(seeded(hash, 'g') * 2),
            confidence: 0.55,
          },
        ],
      }
  }
}

// ---------------------------------------------------------------------------

export class MockAiAdapter implements AiPort {
  readonly name = 'ai:mock'

  constructor(private readonly opts: { latencyMs?: number; failureRate?: number } = {}) {}

  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    assertRedacted(this.name, request.input)
    const inputHash = inputHashOf(request)
    const started = Date.now()

    if (this.opts.latencyMs) {
      await new Promise((r) => setTimeout(r, this.opts.latencyMs))
    }

    // Deterministic fault injection so the failure paths are exercised in
    // normal development rather than only theorised about.
    if (this.opts.failureRate && seeded(inputHash, 'fail') < this.opts.failureRate) {
      return {
        ok: false,
        value: null,
        model: this.name,
        promptVersion: request.promptVersion,
        inputHash,
        tokensIn: 0,
        tokensOut: 0,
        costMicros: 0,
        latencyMs: Date.now() - started,
        error: { code: 'TRANSPORT', message: 'Injected mock failure.' },
      }
    }

    const parsed = request.schema.safeParse(mockPayload(request.task, inputHash))
    if (!parsed.success) {
      return {
        ok: false,
        value: null,
        model: this.name,
        promptVersion: request.promptVersion,
        inputHash,
        tokensIn: 0,
        tokensOut: 0,
        costMicros: 0,
        latencyMs: Date.now() - started,
        error: { code: 'SCHEMA_INVALID', message: parsed.error.message },
      }
    }

    const size = JSON.stringify(request.input).length
    return {
      ok: true,
      value: parsed.data,
      model: this.name,
      promptVersion: request.promptVersion,
      inputHash,
      tokensIn: Math.ceil(size / 4),
      tokensOut: 180,
      costMicros: 0,
      latencyMs: Date.now() - started,
    }
  }
}

/** Returns DISABLED for everything. Used when AI_ENABLED=false. */
export class DisabledAiAdapter implements AiPort {
  readonly name = 'ai:disabled'

  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    return {
      ok: false,
      value: null,
      model: this.name,
      promptVersion: request.promptVersion,
      inputHash: inputHashOf(request),
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
      latencyMs: 0,
      error: { code: 'DISABLED', message: 'The AI layer is switched off.' },
    }
  }
}

export class AnthropicAiAdapter implements AiPort {
  readonly name = 'ai:anthropic'

  constructor(
    private readonly apiKey?: string,
    private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
    private readonly heavyModel = process.env.ANTHROPIC_MODEL_HEAVY ?? 'claude-opus-4-20250514',
  ) {}

  /** Photo work and formula suggestion get the stronger model. */
  private modelFor(task: AiTask): string {
    return task === 'photo.analysis' || task === 'formula.suggest' ? this.heavyModel : this.model
  }

  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    requireEnv('ai', { ANTHROPIC_API_KEY: this.apiKey })
    assertRedacted(this.name, request.input)

    const inputHash = inputHashOf(request)
    const started = Date.now()
    const model = this.modelFor(request.task)

    const fail = (
      code: NonNullable<AiResult<T>['error']>['code'],
      message: string,
    ): AiResult<T> => ({
      ok: false,
      value: null,
      model,
      promptVersion: request.promptVersion,
      inputHash,
      tokensIn: 0,
      tokensOut: 0,
      costMicros: 0,
      latencyMs: Date.now() - started,
      error: { code, message },
    })

    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: this.apiKey })

      const content: unknown[] = [
        ...(request.images ?? []).map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
        })),
        {
          type: 'text' as const,
          text:
            `${JSON.stringify(request.input)}\n\n` +
            `Respond with JSON only, matching the requested shape. No prose outside the JSON.`,
        },
      ]

      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens ?? 2048,
        system: SYSTEM_PROMPTS[request.task],
        messages: [{ role: 'user', content: content as never }],
      })

      if ((response as { stop_reason?: string }).stop_reason === 'refusal') {
        return fail('REFUSED', 'The model declined to answer.')
      }

      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('')

      const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
      const parsed = request.schema.safeParse(JSON.parse(json))
      if (!parsed.success) return fail('SCHEMA_INVALID', parsed.error.message)

      return {
        ok: true,
        value: parsed.data,
        model,
        promptVersion: request.promptVersion,
        inputHash,
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
        costMicros: Math.round(response.usage.input_tokens * 3 + response.usage.output_tokens * 15),
        latencyMs: Date.now() - started,
      }
    } catch (err) {
      const status = (err as { status?: number }).status
      if (status === 429) return fail('RATE_LIMITED', 'Rate limited.')
      return fail('TRANSPORT', (err as Error).message)
    }
  }
}

/**
 * One stable system prompt per task. Changing a prompt means a NEW
 * promptVersion at the call site, never an edit in place — the version is
 * stored on every AiSuggestion so an output can be traced to what produced it.
 */
const SYSTEM_PROMPTS: Record<AiTask, string> = {
  'consultation.summary':
    'You brief a senior hair stylist. Return a short headline, a prose summary, and up to five ' +
    'watchFor notes. State only what the data supports. Never give a verdict on whether the service is safe.',
  'photo.analysis':
    'You describe what is visible in a photograph of hair. Report observations only — banding, ' +
    'regrowth, breakage, apparent level and tone. You must NOT assess risk or recommend a service.',
  'inspiration.attributes':
    'Extract the attributes a client is drawn to in a reference photo: target level, tone, ' +
    'technique, contrast, dimension. Give a confidence for each.',
  'risk.explain':
    'Explain, warmly and in plain language, a concern a stylist has already identified. ' +
    'Two or three sentences. Do not add new concerns and do not contradict the stylist.',
  'formula.suggest':
    'Suggest a starting colour formula given the history and target. Always include cautions. ' +
    'The stylist decides; this is a starting point only.',
  'intake.normalize':
    'Turn a client’s free text into candidate structured facts with confidences. ' +
    'The client will confirm each one, so prefer under-claiming to guessing.',
}
