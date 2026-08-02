/**
 * Conditional question logic.
 *
 * A guided consultation is only guided if it stops asking irrelevant questions.
 * "When was the box dye?" must not appear to someone who has never used it.
 *
 * The condition is stored as a small JSON AST on the question, so a salon can
 * author branching in the template editor without anyone deploying code — but
 * it is deliberately NOT a general expression language. It can compare an
 * answer to a value and combine those comparisons. That is enough for real
 * consultation forms and small enough to evaluate safely and predictably.
 */

export type Condition =
  | { '==': [Ref, Literal] }
  | { '!=': [Ref, Literal] }
  | { '>': [Ref, number] }
  | { '<': [Ref, number] }
  | { in: [Ref, Literal[]] }
  | { answered: Ref }
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition }

export interface Ref {
  var: string
}

export type Literal = string | number | boolean | null

export type AnswerMap = Readonly<Record<string, unknown>>

const isRef = (value: unknown): value is Ref =>
  typeof value === 'object' && value !== null && 'var' in value

function resolve(ref: Ref, answers: AnswerMap): unknown {
  return answers[ref.var]
}

/**
 * Loose equality on purpose.
 *
 * A select stores "true" as a string while a checkbox stores a boolean, and a
 * salon author should not have to know which. Comparing by string form makes
 * the obvious intent work.
 */
function looselyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  return String(a).toLowerCase() === String(b).toLowerCase()
}

const isAnswered = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  value !== '' &&
  !(Array.isArray(value) && value.length === 0)

/**
 * Evaluate a condition against the answers so far.
 *
 * Unknown or malformed conditions resolve to VISIBLE. A broken condition
 * hiding a safety question — "have you ever reacted to colour?" — would be far
 * worse than showing one question too many.
 */
export function evaluateCondition(condition: unknown, answers: AnswerMap): boolean {
  if (condition === null || condition === undefined) return true
  if (typeof condition !== 'object') return true

  const node = condition as Record<string, unknown>

  if ('and' in node && Array.isArray(node.and)) {
    return node.and.every((child) => evaluateCondition(child, answers))
  }
  if ('or' in node && Array.isArray(node.or)) {
    return node.or.some((child) => evaluateCondition(child, answers))
  }
  if ('not' in node) {
    return !evaluateCondition(node.not, answers)
  }
  if ('answered' in node && isRef(node.answered)) {
    return isAnswered(resolve(node.answered, answers))
  }

  for (const operator of ['==', '!=', '>', '<', 'in'] as const) {
    if (!(operator in node)) continue
    const operands = node[operator]
    if (!Array.isArray(operands) || operands.length !== 2) return true

    const [left, right] = operands
    if (!isRef(left)) return true
    const value = resolve(left, answers)

    switch (operator) {
      case '==':
        return looselyEqual(value, right)
      case '!=':
        return !looselyEqual(value, right)
      case '>':
        return typeof right === 'number' && Number(value) > right
      case '<':
        return typeof right === 'number' && Number(value) < right
      case 'in':
        return Array.isArray(right) && right.some((option) => looselyEqual(value, option))
    }
  }

  return true
}

export interface QuestionLike {
  key: string
  section: string
  sortOrder: number
  isRequired: boolean
  visibleWhenJson?: unknown
}

/** The questions that should be on screen given what has been answered. */
export function visibleQuestions<T extends QuestionLike>(
  questions: readonly T[],
  answers: AnswerMap,
): T[] {
  return [...questions]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((q) => evaluateCondition(q.visibleWhenJson, answers))
}

/**
 * Group visible questions into the steps the client actually walks through.
 *
 * One section per screen. A consultation presented as a single long form is the
 * single biggest cause of abandonment, and abandonment makes the whole
 * consult-first premise worthless.
 */
export interface ConsultationStep<T> {
  section: string
  index: number
  questions: T[]
}

export function buildSteps<T extends QuestionLike>(
  questions: readonly T[],
  answers: AnswerMap,
): ConsultationStep<T>[] {
  const visible = visibleQuestions(questions, answers)
  const order: string[] = []
  const bySection = new Map<string, T[]>()

  for (const question of visible) {
    if (!bySection.has(question.section)) {
      bySection.set(question.section, [])
      order.push(question.section)
    }
    bySection.get(question.section)!.push(question)
  }

  return order.map((section, index) => ({
    section,
    index,
    questions: bySection.get(section)!,
  }))
}

/** Required questions that are visible but still unanswered. */
export function missingRequired<T extends QuestionLike>(
  questions: readonly T[],
  answers: AnswerMap,
): T[] {
  return visibleQuestions(questions, answers).filter(
    (q) => q.isRequired && !isAnswered(answers[q.key]),
  )
}

/** 0–1, across visible questions only, so branching does not distort it. */
export function completionRatio<T extends QuestionLike>(
  questions: readonly T[],
  answers: AnswerMap,
): number {
  const visible = visibleQuestions(questions, answers)
  if (visible.length === 0) return 1
  const answered = visible.filter((q) => isAnswered(answers[q.key])).length
  return answered / visible.length
}

export { isAnswered }
