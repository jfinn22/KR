'use client'

import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AiSuggestion } from '@/components/ui/feedback'
import { judgeSuggestionAction, summariseAction } from '@/server/actions/review'

/**
 * The AI summary.
 *
 * Behind a button rather than generated on load: a stylist who reads the
 * answers themselves should not have been charged for a summary they never
 * opened, and the queue would otherwise produce one for every consultation
 * nobody looks at.
 *
 * Wrapped in `AiSuggestion`, which carries the dashed border and the explicit
 * attribution, so it can never be mistaken for something the engine decided.
 * Accepting or rejecting is recorded — that record is both the audit trail and
 * the only honest measure of whether the summaries are any good.
 */
export function AiSummaryCard({
  salonSlug,
  consultationId,
}: {
  salonSlug: string
  consultationId: string
}) {
  const [summary, setSummary] = React.useState<{
    headline: string
    summary: string
    watchFor: string[]
  } | null>(null)
  const [suggestionId, setSuggestionId] = React.useState<string | null>(null)
  const [judged, setJudged] = React.useState<'accepted' | 'rejected' | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setMessage(null)

    const result = await summariseAction(salonSlug, { consultationId })
    if (!result.ok) {
      setMessage(result.error)
      setBusy(false)
      return
    }

    if (!result.data.summary) {
      // Off, unavailable, or refused. The screen already works without it.
      setMessage('No summary available — AI is off for this salon, or the model did not answer.')
      setBusy(false)
      return
    }

    setSummary(result.data.summary)
    setSuggestionId(result.data.suggestionId)
    setBusy(false)
  }

  async function judge(accept: boolean) {
    if (!suggestionId) return
    setBusy(true)

    const result = await judgeSuggestionAction(salonSlug, { suggestionId, accept })
    if (!result.ok) {
      setMessage(result.error)
      setBusy(false)
      return
    }

    setJudged(accept ? 'accepted' : 'rejected')
    setBusy(false)
  }

  if (!summary) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="gold" size="sm" onClick={generate} disabled={busy}>
          {busy ? 'Reading…' : 'Summarise this for me'}
        </Button>
        {message && <span className="text-secondary text-ink-muted">{message}</span>}
      </div>
    )
  }

  return (
    <AiSuggestion
      title="Summary"
      actions={
        judged ? (
          <Badge tone={judged === 'accepted' ? 'success' : 'neutral'}>
            {judged === 'accepted' ? 'Kept' : 'Discarded'}
          </Badge>
        ) : (
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => judge(true)}>
              Useful
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => judge(false)}>
              Not useful
            </Button>
          </>
        )
      }
    >
      <p className="font-medium text-ink">{summary.headline}</p>
      <p className="mt-2">{summary.summary}</p>

      {summary.watchFor.length > 0 && (
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5">
          {summary.watchFor.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}

      {message && (
        <p role="alert" className="mt-3 text-danger">
          {message}
        </p>
      )}
    </AiSuggestion>
  )
}
