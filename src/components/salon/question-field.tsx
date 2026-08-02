'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Input, Label, Select, Textarea } from '@/components/ui/field'
import {
  DEFAULT_FAMILY,
  TONE_FAMILIES,
  familyByKey,
  familyOfShade,
  readShadeAnswer,
  shadeByKey,
  type ToneFamilyKey,
} from '@/domain/hair/tone'

/**
 * One consultation question, rendered for its input type.
 *
 * The single most-used component in the product, and the one where abandonment
 * is won or lost. Principles it holds to:
 *
 *  - Big targets. This is answered one-handed, on a phone, often in bad light.
 *  - Never a placeholder as a label — a placeholder disappears the moment
 *    somebody starts typing, exactly when they need it most.
 *  - Yes/No is two buttons, not a dropdown. Colour is a chart of named shades,
 *    not a number entry. The question type should look like the answer.
 *  - Autosave is a prop, not a save button. Progress is never lost.
 */

export type QuestionInput =
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'BOOLEAN'
  | 'NUMBER'
  | 'TEXT'
  | 'LONG_TEXT'
  | 'DATE'
  | 'SCALE'
  | 'LEVEL_PICKER'
  | 'PHOTO_PROMPT'

export interface QuestionOption {
  value: string
  label: string
  help?: string
}

export interface Question {
  key: string
  prompt: string
  helpText?: string | null
  inputType: QuestionInput
  isRequired: boolean
  optionsJson?: unknown
}

export interface QuestionFieldProps {
  question: Question
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  error?: string
}

export function QuestionField({ question, value, onChange, disabled, error }: QuestionFieldProps) {
  const id = `q-${question.key}`
  const options = parseOptions(question.optionsJson)

  return (
    <fieldset className="border-0 p-0" aria-invalid={error ? true : undefined}>
      <legend className="mb-1 block w-full">
        <span className="font-display text-display-sm text-ink">
          {question.prompt}
          {question.isRequired && <span className="ml-1 text-gold-700">*</span>}
        </span>
      </legend>

      {question.helpText && (
        <p className="mb-4 max-w-prose text-secondary text-ink-muted">{question.helpText}</p>
      )}

      <div className={cn(!question.helpText && 'mt-4')}>
        <Control
          id={id}
          question={question}
          options={options}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>

      {error && (
        <p role="alert" className="mt-2 text-secondary text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function Control({
  id,
  question,
  options,
  value,
  onChange,
  disabled,
}: {
  id: string
  question: Question
  options: QuestionOption[]
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  switch (question.inputType) {
    case 'BOOLEAN':
      return <YesNo id={id} value={value} onChange={onChange} disabled={disabled} />

    case 'SINGLE_SELECT':
      return (
        <ChoiceList
          id={id}
          options={options}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      )

    case 'MULTI_SELECT':
      return (
        <ChoiceList
          id={id}
          options={options}
          value={value}
          onChange={onChange}
          disabled={disabled}
          multiple
        />
      )

    case 'LEVEL_PICKER':
      return <LevelPicker id={id} value={value} onChange={onChange} disabled={disabled} />

    case 'SCALE':
      return (
        <Scale id={id} options={options} value={value} onChange={onChange} disabled={disabled} />
      )

    case 'NUMBER':
      return (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          className="max-w-40"
          value={value === null || value === undefined ? '' : String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )

    case 'DATE':
      return (
        <Input
          id={id}
          type="date"
          className="max-w-56"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        />
      )

    case 'LONG_TEXT':
      return (
        <Textarea
          id={id}
          rows={4}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )

    case 'PHOTO_PROMPT':
      // The capture grid owns photos; here the question is only a reminder.
      return (
        <p className="rounded-lg border border-dashed border-line bg-surface p-4 text-secondary text-ink-muted">
          You will add photos on the next step.
        </p>
      )

    case 'TEXT':
    default:
      return options.length > 0 ? (
        <Select
          id={id}
          className="max-w-sm"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">Choose one…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/**
 * Yes / No as two equal buttons.
 *
 * A dropdown for a binary question costs two taps and hides the options. These
 * are also the questions that matter most — box dye, prior reaction — so they
 * get the clearest possible affordance.
 */
function YesNo({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const current = normalizeBool(value)
  return (
    <div className="flex gap-3" role="radiogroup" aria-labelledby={id}>
      {[
        { label: 'Yes', v: true },
        { label: 'No', v: false },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          aria-checked={current === option.v}
          disabled={disabled}
          onClick={() => onChange(option.v)}
          className={cn(
            'h-12 min-w-28 flex-1 rounded-lg border text-body font-medium transition-colors sm:flex-none',
            current === option.v
              ? 'border-blue-900 bg-blue-900 text-ink-inverse'
              : 'border-line bg-canvas text-ink hover:border-line-strong hover:bg-surface-alt',
            disabled && 'pointer-events-none opacity-45',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Tappable rows. Selected state is a gold left rule, never a tick buried in a corner. */
function ChoiceList({
  id,
  options,
  value,
  onChange,
  disabled,
  multiple,
}: {
  id: string
  options: QuestionOption[]
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  multiple?: boolean
}) {
  const selected = new Set(
    multiple
      ? Array.isArray(value)
        ? value.map(String)
        : []
      : value === null || value === undefined
        ? []
        : [String(value)],
  )

  const toggle = (optionValue: string) => {
    if (!multiple) return onChange(selected.has(optionValue) ? null : optionValue)
    const next = new Set(selected)
    if (next.has(optionValue)) next.delete(optionValue)
    else next.add(optionValue)
    onChange([...next])
  }

  if (options.length === 0) {
    return (
      <p className="text-secondary text-ink-subtle">No options configured for this question.</p>
    )
  }

  return (
    <div
      className="flex flex-col gap-2"
      role={multiple ? 'group' : 'radiogroup'}
      aria-labelledby={id}
    >
      {options.map((option) => {
        const isSelected = selected.has(option.value)
        return (
          <button
            key={option.value}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => toggle(option.value)}
            className={cn(
              'flex min-h-12 items-start gap-3 rounded-lg border border-l-4 px-4 py-3 text-left transition-colors',
              isSelected
                ? 'border-line border-l-gold-500 bg-gold-100/50'
                : 'border-line border-l-line bg-canvas hover:bg-surface-alt',
              disabled && 'pointer-events-none opacity-45',
            )}
          >
            <span className="flex-1">
              <span className="block text-body text-ink">{option.label}</span>
              {option.help && (
                <span className="mt-0.5 block text-secondary text-ink-muted">{option.help}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * The shade picker: pick a colour family, then the exact shade in it.
 *
 * One strip from black to blonde is how a colourist thinks about depth and it
 * is useless to a client who wants copper — "level 6" describes a dark blonde,
 * a caramel brown and a bright copper equally well. So the family comes first,
 * as a dropdown, and choosing one swaps the swatches beneath it for that
 * family's real shades, named the way a client would name them.
 *
 * What is stored is the shade, and every shade carries the depth it sits at, so
 * the client picks "copper" and the engine still gets the number it needs to
 * work out how much lift the service takes.
 */
function LevelPicker({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const answer = readShadeAnswer(value)
  const chosen = shadeByKey(answer?.tone)

  /*
   * The family follows the answer when there is one, so coming back to a
   * half-finished consultation reopens on the family they were looking at
   * rather than resetting them to natural.
   */
  const [familyKey, setFamilyKey] = React.useState<ToneFamilyKey>(
    () => familyOfShade(answer?.tone)?.key ?? DEFAULT_FAMILY,
  )
  const family = familyByKey(familyKey) ?? TONE_FAMILIES[0]!

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-family`}>Colour family</Label>
        <Select
          id={`${id}-family`}
          className="max-w-xs"
          value={family.key}
          disabled={disabled}
          onChange={(e) => setFamilyKey(e.target.value as ToneFamilyKey)}
        >
          {TONE_FAMILIES.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </Select>
        <p className="text-secondary text-ink-muted">{family.help}</p>
      </div>

      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
        role="radiogroup"
        aria-labelledby={id}
      >
        {family.shades.map((shade) => {
          const isSelected = chosen?.key === shade.key
          return (
            <button
              key={shade.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${shade.name}, level ${shade.level}`}
              disabled={disabled}
              onClick={() => onChange({ level: shade.level, tone: shade.key })}
              className={cn(
                'group overflow-hidden rounded-lg border-2 bg-canvas text-left transition-all',
                isSelected
                  ? 'border-gold-500 shadow-raised ring-2 ring-gold-300/50'
                  : 'border-line hover:-translate-y-0.5 hover:border-gold-600 hover:shadow-card',
                disabled && 'pointer-events-none opacity-45',
              )}
            >
              {/*
               * The inset ring is what keeps platinum and icy white from
               * vanishing into a white card — a swatch you cannot see the edge
               * of is not a swatch.
               */}
              <span
                aria-hidden
                className="block h-14 w-full ring-1 ring-inset ring-ink/10"
                style={{ backgroundColor: shade.hex }}
              />
              <span className="block px-2 py-1.5">
                {/* Two lines reserved, so a wrapping name cannot misalign the row. */}
                <span className="block min-h-9 text-secondary font-medium leading-tight text-ink">
                  {shade.name}
                </span>
                <span className="tabular block text-label text-ink-subtle">
                  Level {shade.level}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/*
       * Said back to them in words. A grid of swatches all looks similar on a
       * phone in bad light, and this is the answer the whole quote is built on.
       */}
      <p aria-live="polite" className="text-secondary text-ink-muted">
        {chosen ? (
          <>
            You picked <span className="font-medium text-ink">{chosen.name}</span>, a level{' '}
            {chosen.level}. Add a photo of the look you want and we will match it exactly.
          </>
        ) : (
          'Pick the closest shade — you can add a reference photo next, and we will confirm it in person.'
        )}
      </p>
    </div>
  )
}

/** A 1–5 scale with the ends labelled, because a bare number scale is ambiguous. */
function Scale({
  id,
  options,
  value,
  onChange,
  disabled,
}: {
  id: string
  options: QuestionOption[]
  value: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
}) {
  const current = typeof value === 'number' ? value : Number(value) || null
  const low = options[0]?.label
  const high = options[options.length - 1]?.label

  return (
    <div>
      <div className="flex gap-2" role="radiogroup" aria-labelledby={id}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={String(n)}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={cn(
              'tabular h-12 flex-1 rounded-lg border text-body font-medium transition-colors',
              current === n
                ? 'border-blue-900 bg-blue-900 text-ink-inverse'
                : 'border-line bg-canvas text-ink hover:bg-surface-alt',
              disabled && 'pointer-events-none opacity-45',
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {(low || high) && (
        <div className="mt-2 flex justify-between text-secondary text-ink-muted">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Options come from a JSON column, so they are shaped by whoever built the
 * template. Accept the three forms a salon plausibly produces and ignore the
 * rest rather than crashing a client's consultation over a malformed option.
 */
export function parseOptions(raw: unknown): QuestionOption[] {
  if (!raw) return []

  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && Array.isArray((raw as { options?: unknown }).options)
      ? ((raw as { options: unknown[] }).options as unknown[])
      : []

  return list.flatMap((entry): QuestionOption[] => {
    if (typeof entry === 'string') return [{ value: entry, label: entry }]
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const value = record.value ?? record.key
      if (value === undefined || value === null) return []
      return [
        {
          value: String(value),
          label: String(record.label ?? record.name ?? value),
          ...(typeof record.help === 'string' ? { help: record.help } : {}),
        },
      ]
    }
    return []
  })
}

/** A select posts "true"; a toggle posts true. Both mean yes. */
export function normalizeBool(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1' || value === 'yes') {
    return true
  }
  if (value === false || value === 'false' || value === 0 || value === '0' || value === 'no') {
    return false
  }
  return null
}

export { Label }
