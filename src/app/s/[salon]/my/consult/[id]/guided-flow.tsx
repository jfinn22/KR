'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buildSteps, completionRatio, missingRequired } from '@/domain/consultation/visibility'
import { QuestionField, type Question } from '@/components/salon/question-field'
import { Button } from '@/components/ui/button'
import { ProgressRail } from '@/components/ui/feedback'
import { saveAnswerAction } from '@/server/actions/consultation'

/**
 * The guided consultation flow.
 *
 * Abandonment is the enemy here — a consultation nobody finishes books nothing,
 * and the whole consult-first premise is worthless if clients quit halfway. So:
 *
 *  - One section per screen. A single scroll of twenty questions reads as
 *    paperwork; four screens of five reads as a conversation.
 *  - Branching is computed locally from the answers in hand, so ticking "yes,
 *    box dye" reveals the follow-up instantly rather than after a round trip.
 *  - Every answer autosaves, debounced. Closing the tab loses nothing.
 *  - An escape hatch is visible on every screen. A client who would rather talk
 *    to a person should be able to, immediately — pushing them through the form
 *    anyway is how you get abandoned consultations and unanswered phones.
 */

const AUTOSAVE_MS = 600

/** A question plus the fields sectioning and branching need. */
export interface FlowQuestion extends Question {
  section: string
  sortOrder: number
  visibleWhenJson?: unknown
}

export interface GuidedFlowProps {
  salonSlug: string
  consultationId: string
  questions: readonly FlowQuestion[]
  initialAnswers: Record<string, unknown>
  serviceNames: readonly string[]
  hasPhotoStep: boolean
}

export function GuidedFlow({
  salonSlug,
  consultationId,
  questions,
  initialAnswers,
  serviceNames,
  hasPhotoStep,
}: GuidedFlowProps) {
  const router = useRouter()

  const [answers, setAnswers] = React.useState<Record<string, unknown>>(initialAnswers)
  const [stepIndex, setStepIndex] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showErrors, setShowErrors] = React.useState(false)

  const steps = React.useMemo(() => buildSteps(questions, answers), [questions, answers])
  const progress = React.useMemo(() => completionRatio(questions, answers), [questions, answers])
  const missing = React.useMemo(
    () => new Set(missingRequired(questions, answers).map((q) => q.key)),
    [questions, answers],
  )

  // Branching can remove the step you were standing on. Clamp rather than
  // crash, and never leave someone on a blank screen.
  const safeIndex = Math.min(stepIndex, Math.max(0, steps.length - 1))
  const step = steps[safeIndex]

  const pending = React.useRef(new Map<string, unknown>())
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = React.useCallback(async () => {
    if (pending.current.size === 0) return
    const batch = [...pending.current.entries()]
    pending.current.clear()
    setSaving(true)

    try {
      for (const [questionKey, value] of batch) {
        const result = await saveAnswerAction(salonSlug, {
          consultationId,
          questionKey,
          value,
        })
        if (!result.ok) setError(result.error)
      }
    } finally {
      setSaving(false)
    }
  }, [salonSlug, consultationId])

  const onAnswer = React.useCallback(
    (key: string, value: unknown) => {
      setAnswers((current) => ({ ...current, [key]: value }))
      setError(null)
      pending.current.set(key, value)

      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    [flush],
  )

  // A client who closes the tab mid-question keeps their progress.
  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const stepMissing = step ? step.questions.filter((q) => missing.has(q.key)).map((q) => q.key) : []
  const isLastStep = safeIndex >= steps.length - 1

  async function goNext() {
    if (stepMissing.length > 0) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    await flush()

    if (!isLastStep) {
      setStepIndex(safeIndex + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setSubmitting(true)
    // Photos come after the questions, so the client sees why they are needed.
    // Every consultation then ends on the reference pictures, chemical or not —
    // a picture of the finish somebody wants is the single most useful thing
    // they can give a stylist, and a cut benefits from it as much as a colour.
    router.push(
      hasPhotoStep
        ? `/s/${salonSlug}/my/consult/${consultationId}/photos`
        : `/s/${salonSlug}/my/consult/${consultationId}/inspiration`,
    )
  }

  if (!step) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-body text-ink-muted">
          This consultation has no questions configured. Please contact the salon.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="label-caps">{serviceNames.join(' + ')}</p>
          <p className="tabular text-label text-ink-subtle">
            Step {safeIndex + 1} of {steps.length + (hasPhotoStep ? 2 : 1)}
          </p>
        </div>

        <ProgressRail value={progress * 100} />

        <h1 className="font-display text-display-lg text-ink">{step.section}</h1>
      </header>

      <div className="flex flex-col gap-10">
        {step.questions.map((question) => (
          <QuestionField
            key={question.key}
            question={question as Question}
            value={answers[question.key]}
            onChange={(value) => onAnswer(question.key, value)}
            disabled={submitting}
            error={
              showErrors && stepMissing.includes(question.key)
                ? 'We need this one to give you an accurate answer.'
                : undefined
            }
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-5 border-t border-line pt-6">
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            disabled={safeIndex === 0 || submitting}
            onClick={() => setStepIndex(safeIndex - 1)}
          >
            Back
          </Button>

          <div className="flex items-center gap-4">
            <span aria-live="polite" className="text-label text-ink-subtle">
              {saving ? 'Saving…' : 'Saved'}
            </span>
            <Button onClick={goNext} disabled={submitting}>
              {submitting
                ? 'Working…'
                : isLastStep
                  ? hasPhotoStep
                    ? 'Add photos'
                    : 'Add your reference photos'
                  : 'Continue'}
            </Button>
          </div>
        </div>

        {/*
         * Always visible, never buried. Someone who wants a person should get
         * one on the spot — a form they abandon out of frustration is worse for
         * the salon than a phone call.
         */}
        <p className="text-secondary text-ink-muted">
          Would rather talk it through?{' '}
          <Link
            href={`/s/${salonSlug}/my/consult/${consultationId}/review?inPerson=1`}
            className="text-blue-500 underline-offset-4 hover:underline"
          >
            Book an in-person consultation instead
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
