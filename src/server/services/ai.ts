import { z } from 'zod'
import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { aiPort } from '@/ports/registry'
import type { AiRequest, AiTask } from '@/ports/ai'
import type { EvaluationResult } from '@/domain/consultation/types'
import { redactForAi } from '@/domain/ai/redaction'

/**
 * Where the model is actually called.
 *
 * Four rules, and they are the whole design:
 *
 *  1. Advisory only. Nothing here can create or suppress a risk flag, change a
 *     price, or approve a plan. `src/domain/**` is barred by ESLint from
 *     importing `@/ports/*`, so the deterministic path is out of reach
 *     structurally rather than by discipline.
 *  2. Redacted before it leaves. Names, emails and phone numbers never go to a
 *     third-party model. The port asserts this too, as a second line.
 *  3. Every call is recorded — prompt version, input hash, tokens, cost — so a
 *     salon can see what was spent and a suggestion can be traced back to
 *     exactly the input that produced it.
 *  4. Nothing is used until a person accepts it. A suggestion is DRAFT until a
 *     named human says otherwise, and the accepted copy is stored separately
 *     from what the model said.
 *
 * A failure is never fatal. If the model is down, disabled, or over budget,
 * the caller gets null and the product carries on — everything AI does here is
 * an improvement on a screen that already works without it.
 */

const PROMPT_VERSION = '2026-01-01'

const TASK_TO_KIND: Record<AiTask, string> = {
  'consultation.summary': 'CONSULTATION_SUMMARY',
  'photo.analysis': 'PHOTO_ANALYSIS',
  'inspiration.attributes': 'INSPIRATION_ATTRIBUTES',
  'risk.explain': 'RISK_EXPLAIN',
  'plan.narrative': 'PLAN_NARRATIVE',
  'message.draft': 'MESSAGE_DRAFT',
  'formula.suggest': 'FORMULA_SUGGEST',
  'intake.normalize': 'INTAKE_NORMALIZE',
}

/**
 * Run a task and record it, whatever happens.
 *
 * Failures are stored too. A salon asking "why is there no summary on this
 * consultation?" deserves "the model timed out at 14:02", not silence.
 */
async function run<T>(input: {
  salonId: string
  task: AiTask
  refType: string
  refId: string
  payload: unknown
  schema: z.ZodType<T>
  images?: AiRequest<T>['images']
  effort?: 'low' | 'medium' | 'high'
}): Promise<{ value: T | null; suggestionId: string | null }> {
  const settings = await unsafeDb.salonSettings.findUnique({
    where: { salonId: input.salonId },
    select: { aiEnabled: true, aiPhotoAnalysisEnabled: true },
  })

  if (!settings?.aiEnabled) return { value: null, suggestionId: null }
  if (input.images?.length && !settings.aiPhotoAnalysisEnabled) {
    // Sending client photographs to a third party is a separate decision from
    // using AI at all, and a salon has to make it explicitly.
    return { value: null, suggestionId: null }
  }

  const result = await aiPort().complete({
    task: input.task,
    promptVersion: PROMPT_VERSION,
    input: input.payload,
    schema: input.schema,
    images: input.images,
    effort: input.effort,
  })

  const suggestion = await unsafeDb.aiSuggestion.create({
    data: {
      salonId: input.salonId,
      kind: TASK_TO_KIND[input.task] as never,
      refType: input.refType,
      refId: input.refId,
      model: result.model,
      promptVersion: result.promptVersion,
      inputHash: result.inputHash,
      parsedJson: (result.value ?? undefined) as never,
      status: result.ok ? 'DRAFT' : 'FAILED',
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costMicros: result.costMicros,
      latencyMs: result.latencyMs,
      errorCode: result.error?.code ?? null,
    },
    select: { id: true },
  })

  await recordUsage(input.salonId, result)

  return { value: result.ok ? result.value : null, suggestionId: suggestion.id }
}

/**
 * Running totals, so a salon sees the spend before the invoice does.
 *
 * Counted per calendar month, keyed on the first of the month — the column is
 * a DATE, and a month is the unit an owner and a provider both bill in.
 * BigInt because token counts across a busy year comfortably exceed what an
 * Int can hold, and a silently wrapped cost figure is worse than none.
 */
async function recordUsage(
  salonId: string,
  result: { tokensIn: number; tokensOut: number; costMicros: number },
): Promise<void> {
  const period = monthStart()

  await unsafeDb.aiUsageCounter.upsert({
    where: { salonId_period: { salonId, period } },
    create: {
      salonId,
      period,
      callCount: 1,
      tokensIn: BigInt(result.tokensIn),
      tokensOut: BigInt(result.tokensOut),
      costMicros: BigInt(result.costMicros),
    },
    update: {
      callCount: { increment: 1 },
      tokensIn: { increment: BigInt(result.tokensIn) },
      tokensOut: { increment: BigInt(result.tokensOut) },
      costMicros: { increment: BigInt(result.costMicros) },
    },
  })
}

function monthStart(at = new Date()): Date {
  return new Date(`${at.toISOString().slice(0, 7)}-01T00:00:00Z`)
}

// --- Call sites --------------------------------------------------------------

const SummarySchema = z.object({
  headline: z.string().max(120),
  summary: z.string().max(900),
  watchFor: z.array(z.string().max(160)).max(5),
})

export type ConsultationSummary = z.infer<typeof SummarySchema>

/**
 * A stylist-facing summary of a consultation.
 *
 * Saves the reader from reconstructing the picture out of twelve answers. It
 * describes what the engine already decided — it never adds a conclusion of
 * its own, which is why the flags are an input rather than something the model
 * is asked to find.
 */
export async function summariseConsultation(input: {
  salonId: string
  consultationId: string
  evaluation: EvaluationResult
  answers: Record<string, unknown>
  serviceNames: readonly string[]
}): Promise<{ value: ConsultationSummary | null; suggestionId: string | null }> {
  return run({
    salonId: input.salonId,
    task: 'consultation.summary',
    refType: 'Consultation',
    refId: input.consultationId,
    schema: SummarySchema,
    payload: redactForAi({
      services: input.serviceNames,
      answers: input.answers,
      flags: input.evaluation.flags.map((flag) => ({
        code: flag.code,
        severity: flag.severity,
        title: flag.title,
      })),
      complexity: input.evaluation.complexity.band,
      sessions: input.evaluation.plan.sessionCount,
      estimatedMin: input.evaluation.duration.totalMin,
    }),
  })
}

const AttributesSchema = z.object({
  attributes: z
    .array(
      z.object({
        key: z.enum([
          'TARGET_LEVEL',
          'TARGET_TONE',
          'TECHNIQUE',
          'ROOT_SHADOW',
          'CONTRAST',
          'DIMENSION',
          'BRIGHTNESS',
          'CURLS',
        ]),
        value: z.string().max(80),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8),
})

/**
 * Read a reference photo.
 *
 * Suggests what the picture shows — tone, brightness, technique — so a client
 * who uploaded something without tagging it still gives the stylist something
 * to work from. Written as suggestions with a confidence, and stored with
 * `source: 'AI'` so they never overwrite what the client said themselves.
 */
export async function readInspiration(input: {
  salonId: string
  inspirationPhotoId: string
  imageBase64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
}): Promise<{ suggestionId: string | null; applied: number }> {
  const result = await run({
    salonId: input.salonId,
    task: 'inspiration.attributes',
    refType: 'InspirationPhoto',
    refId: input.inspirationPhotoId,
    schema: AttributesSchema,
    payload: { instruction: 'Describe the hair in this reference photograph.' },
    images: [{ data: input.imageBase64, mediaType: input.mediaType, label: 'inspiration' }],
  })

  if (!result.value) return { suggestionId: result.suggestionId, applied: 0 }

  const photo = await unsafeDb.inspirationPhoto.findFirst({
    where: { id: input.inspirationPhotoId, salonId: input.salonId },
    select: { id: true },
  })
  if (!photo) return { suggestionId: result.suggestionId, applied: 0 }

  await unsafeDb.$transaction(async (tx) => {
    // Replace only this source's rows. The client's own tags are the brief;
    // the model's reading sits alongside them and never on top.
    await tx.inspirationAttribute.deleteMany({
      where: { inspirationPhotoId: photo.id, source: 'AI' },
    })
    await tx.inspirationAttribute.createMany({
      data: result.value!.attributes.map((attribute) => ({
        salonId: input.salonId,
        inspirationPhotoId: photo.id,
        key: attribute.key,
        value: attribute.value,
        confidence: attribute.confidence,
        source: 'AI' as const,
      })),
    })
  })

  return { suggestionId: result.suggestionId, applied: result.value.attributes.length }
}

const ExplainSchema = z.object({
  plainEnglish: z.string().max(600),
})

/**
 * Restate a flag in the client's words.
 *
 * Explains a flag that has ALREADY fired — the deterministic engine decided it
 * exists and what to do about it; this only changes the wording. If the model
 * is unavailable the stored `clientExplanation` is used, which is why every
 * rule is required to carry one.
 */
export async function explainFlag(input: {
  salonId: string
  consultationId: string
  code: string
  detail: string
  recommendedPath: string
}): Promise<string | null> {
  const result = await run({
    salonId: input.salonId,
    task: 'risk.explain',
    refType: 'RiskFlag',
    refId: `${input.consultationId}:${input.code}`,
    schema: ExplainSchema,
    payload: {
      code: input.code,
      technicalDetail: input.detail,
      recommendedPath: input.recommendedPath,
      instruction: 'Rewrite for a client with no hairdressing knowledge. Do not add advice.',
    },
    effort: 'low',
  })

  return result.value?.plainEnglish ?? null
}

const MessageSchema = z.object({
  body: z.string().max(600),
})

/**
 * Draft a message.
 *
 * Drafted, never sent. The suggestion is returned to a human who edits and
 * sends it, and the send is a separate, permissioned action — an AI that can
 * message clients unsupervised is an AI that will eventually message the wrong
 * one.
 */
export async function draftMessage(input: {
  salonId: string
  threadId: string
  purpose: 'FOLLOW_UP' | 'NEEDS_INFO' | 'DECLINE' | 'REBOOK'
  context: Record<string, unknown>
}): Promise<{ body: string | null; suggestionId: string | null }> {
  const result = await run({
    salonId: input.salonId,
    task: 'message.draft',
    refType: 'MessageThread',
    refId: input.threadId,
    schema: MessageSchema,
    payload: redactForAi({ purpose: input.purpose, ...input.context }),
    effort: 'low',
  })

  return { body: result.value?.body ?? null, suggestionId: result.suggestionId }
}

const FormulaSchema = z.object({
  rationale: z.string().max(400),
  developerVolume: z.number().int().min(5).max(40).nullable(),
  processingTimeMin: z.number().int().min(5).max(120).nullable(),
  cautions: z.array(z.string().max(160)).max(4),
})

export type FormulaSuggestion = z.infer<typeof FormulaSchema>

/**
 * Suggest a starting point for a formula.
 *
 * The most advisory thing in the product and the most clearly labelled. It
 * proposes; a colourist decides, and nothing is written to the client's record
 * until they accept it. A formula applied without a human in the loop is a
 * chemical burn waiting for a defendant.
 */
export async function suggestFormula(input: {
  salonId: string
  clientProfileId: string
  currentLevel: number | null
  targetLevel: number | null
  history: readonly { kind: string; monthsAgo: number | null }[]
  porosity: string | null
}): Promise<{ value: FormulaSuggestion | null; suggestionId: string | null }> {
  return run({
    salonId: input.salonId,
    task: 'formula.suggest',
    refType: 'ClientProfile',
    refId: input.clientProfileId,
    schema: FormulaSchema,
    payload: {
      currentLevel: input.currentLevel,
      targetLevel: input.targetLevel,
      chemicalHistory: input.history,
      porosity: input.porosity,
      instruction: 'Suggest a starting point only. A colourist will decide.',
    },
    effort: 'high',
  })
}

// --- Accepting -----------------------------------------------------------------

/**
 * A person takes responsibility for a suggestion.
 *
 * The edited copy is stored separately from what the model said, so a salon can
 * see the difference — which is both the audit trail and the only honest signal
 * of how good the suggestions actually are.
 */
export async function acceptSuggestion(input: {
  salonId: string
  suggestionId: string
  userId: string
  edited?: unknown
}): Promise<void> {
  const suggestion = await unsafeDb.aiSuggestion.findFirst({
    where: { id: input.suggestionId, salonId: input.salonId },
    select: { id: true, status: true },
  })
  if (!suggestion) throw new DomainError('NOT_FOUND', 'That suggestion no longer exists.')
  if (suggestion.status === 'ACCEPTED') return

  await unsafeDb.aiSuggestion.update({
    where: { id: suggestion.id },
    data: {
      status: 'ACCEPTED',
      editedJson: (input.edited ?? undefined) as never,
      reviewedByUserId: input.userId,
      reviewedAt: new Date(),
    },
  })
}

export async function rejectSuggestion(input: {
  salonId: string
  suggestionId: string
  userId: string
}): Promise<void> {
  await unsafeDb.aiSuggestion.updateMany({
    where: { id: input.suggestionId, salonId: input.salonId, status: 'DRAFT' },
    data: { status: 'REJECTED', reviewedByUserId: input.userId, reviewedAt: new Date() },
  })
}

/** What the model cost this month, and how often its output was kept. */
export async function aiUsage(salonId: string, at = new Date()) {
  const period = monthStart(at)

  const [counter, byStatus] = await Promise.all([
    unsafeDb.aiUsageCounter.findUnique({ where: { salonId_period: { salonId, period } } }),
    unsafeDb.aiSuggestion.groupBy({
      by: ['status'],
      where: { salonId, createdAt: { gte: period } },
      _count: true,
    }),
  ])

  const counts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]))
  const accepted = counts.ACCEPTED ?? 0
  const rejected = counts.REJECTED ?? 0
  const decided = accepted + rejected

  return {
    period: period.toISOString().slice(0, 7),
    callCount: counter?.callCount ?? 0,
    tokens: Number((counter?.tokensIn ?? 0n) + (counter?.tokensOut ?? 0n)),
    costMicros: Number(counter?.costMicros ?? 0n),
    accepted,
    rejected,
    // Null rather than zero when nothing has been judged: "0% useful" and
    // "nobody has looked yet" are very different things to show an owner.
    acceptanceRate: decided > 0 ? accepted / decided : null,
  }
}
