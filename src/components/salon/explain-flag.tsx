'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { explainFlagAction } from '@/server/actions/consultation'

/**
 * "Say that again, plainly."
 *
 * `explainFlag` was built with the AI layer and had no caller, so the only
 * wording a client ever saw was the rule author's — written once, in advance,
 * for everybody, and unable to know that this particular person asked for
 * platinum on a level 3 with box dye in the ends.
 *
 * Asked for rather than generated: a client who understood the sentence first
 * time should not have cost the salon a model call, and the button only appears
 * at all where the plan includes summaries.
 *
 * A failure is silence, not an error. The card already said something true and
 * useful; a red box underneath it saying the rewording did not work makes the
 * screen worse than if the button had never existed.
 */
export function ExplainFlag({
  salonSlug,
  consultationId,
  code,
}: {
  salonSlug: string
  consultationId: string
  code: string
}) {
  const [busy, setBusy] = React.useState(false)
  const [plain, setPlain] = React.useState<string | null>(null)
  const [tried, setTried] = React.useState(false)

  if (plain) {
    return (
      <div className="mt-3 rounded-lg border-l-2 border-l-gold-500 bg-gold-100/40 px-4 py-3">
        <p className="text-secondary text-ink">{plain}</p>
      </div>
    )
  }

  if (tried) return null

  return (
    <div className="mt-3">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const result = await explainFlagAction(salonSlug, { consultationId, code })
          setBusy(false)
          setTried(true)
          if (result.ok && result.data.plainEnglish) setPlain(result.data.plainEnglish)
        }}
      >
        {busy ? 'Putting it another way…' : 'Explain this differently'}
      </Button>
    </div>
  )
}
