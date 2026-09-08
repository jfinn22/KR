'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { clientEnv } from '@/env'
import {
  beginCardSetupAction,
  completeCardSetupWithoutBrowserAction,
  removeCardAction,
  syncCardsAction,
} from '@/server/actions/cards'

/**
 * Keeping a card.
 *
 * The card number never touches this application. The browser is handed a
 * client secret, talks to the provider directly, and what comes back is a
 * reference — so the worst thing an attacker gets from this codebase is the
 * knowledge that somebody's Visa ends 4242.
 *
 * Two paths, and which one runs is decided by whether a publishable key
 * exists, not by a flag:
 *
 *   with a key   the provider's own card form, loaded on demand so a page
 *                nobody adds a card on does not pay for the script
 *   without one  a one-tap confirm against the mock adapter, which is what
 *                keeps the whole booking journey runnable in dev and CI
 *
 * The removal button says what it will actually do. "Remove card" on a card
 * holding a deposit is a promise this cannot keep, so the server refuses and
 * the refusal is shown as written rather than as "something went wrong".
 */

export interface SavedCardView {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

export function CardOnFile({
  salonSlug,
  clientProfileId,
  cards,
  purpose,
}: {
  salonSlug: string
  clientProfileId: string
  cards: SavedCardView[]
  /** Why this is being asked for, in the salon's words. */
  purpose?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [setup, setSetup] = React.useState<{ clientSecret: string; setupIntentId: string } | null>(
    null,
  )

  const publishableKey = clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const result = await beginCardSetupAction(salonSlug, { clientProfileId })
      if (!result.ok) throw new Error(result.error)
      setSetup(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start.')
    } finally {
      setBusy(false)
    }
  }

  async function finishWithoutProvider(setupIntentId: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await completeCardSetupWithoutBrowserAction(salonSlug, {
        clientProfileId,
        setupIntentId,
      })
      if (!result.ok) throw new Error(result.error)
      setSetup(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that card.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmed() {
    /*
     * The provider said yes. Ask it what it holds rather than trusting what
     * came back through the browser — "which cards may this salon charge" is
     * not a question the client's own browser gets to answer.
     */
    setBusy(true)
    try {
      await syncCardsAction(salonSlug, { clientProfileId })
      setSetup(null)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(savedCardId: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await removeCardAction(salonSlug, { clientProfileId, savedCardId })
      if (!result.ok) throw new Error(result.error)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that card.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {purpose && <p className="text-muted-foreground text-sm">{purpose}</p>}

      {cards.length > 0 && (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="border-border/60 flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <span className="text-sm">
                <span className="font-medium capitalize">{card.brand}</span> ···· {card.last4}
                <span className="text-muted-foreground ml-2">
                  {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
                </span>
                {card.isDefault && (
                  <span className="text-muted-foreground ml-2 text-xs uppercase tracking-wide">
                    default
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => remove(card.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!setup && (
        <Button type="button" onClick={start} disabled={busy}>
          {cards.length > 0 ? 'Add another card' : 'Add a card'}
        </Button>
      )}

      {setup && publishableKey && (
        <ProviderCardForm
          publishableKey={publishableKey}
          clientSecret={setup.clientSecret}
          onDone={confirmed}
          onCancel={() => setSetup(null)}
          onError={setError}
        />
      )}

      {setup && !publishableKey && (
        <div className="border-border/60 rounded-lg border border-dashed p-4 text-sm">
          <p className="text-muted-foreground">
            This salon has not connected a payment provider yet, so no real card can be taken.
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={busy}
            onClick={() => finishWithoutProvider(setup.setupIntentId)}
          >
            Use a test card
          </Button>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  )
}

/**
 * The provider's own card form.
 *
 * Loaded with a dynamic import so the ~40kB of provider script is fetched when
 * somebody actually adds a card, not on every page that merely could. It also
 * keeps the module out of the server bundle entirely, which matters because
 * this component is rendered inside otherwise-static screens.
 */
function ProviderCardForm({
  publishableKey,
  clientSecret,
  onDone,
  onCancel,
  onError,
}: {
  publishableKey: string
  clientSecret: string
  onDone: () => void | Promise<void>
  onCancel: () => void
  onError: (message: string) => void
}) {
  const [mod, setMod] = React.useState<ProviderModules | null>(null)

  React.useEffect(() => {
    let live = true
    void (async () => {
      const [{ loadStripe }, react] = await Promise.all([
        import('@stripe/stripe-js'),
        import('@stripe/react-stripe-js'),
      ])
      const stripe = await loadStripe(publishableKey)
      if (!live) return
      if (!stripe) {
        onError('The card form could not be loaded. Check your connection and try again.')
        return
      }
      setMod({ stripe, react })
    })()
    return () => {
      live = false
    }
    // Loading the provider script is a one-shot per mount; re-running it on a
    // changed callback identity would tear down a half-filled card form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishableKey])

  if (!mod) return <p className="text-muted-foreground text-sm">Loading the card form…</p>

  const { Elements } = mod.react
  return (
    <Elements stripe={mod.stripe} options={{ clientSecret }}>
      <ConfirmSetup react={mod.react} onDone={onDone} onCancel={onCancel} onError={onError} />
    </Elements>
  )
}

interface ProviderModules {
  stripe: NonNullable<Awaited<ReturnType<typeof import('@stripe/stripe-js').loadStripe>>>
  react: typeof import('@stripe/react-stripe-js')
}

function ConfirmSetup({
  react,
  onDone,
  onCancel,
  onError,
}: {
  react: ProviderModules['react']
  onDone: () => void | Promise<void>
  onCancel: () => void
  onError: (message: string) => void
}) {
  const { PaymentElement, useStripe, useElements } = react
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!stripe || !elements) return
    setBusy(true)
    try {
      /*
       * `redirect: 'if_required'` keeps the client on this page unless their
       * bank actually demands a challenge. Forcing a redirect for every card
       * would throw away whatever they were part-way through — which, at this
       * point in a booking, is the whole consultation.
       */
      const result = await stripe.confirmSetup({ elements, redirect: 'if_required' })
      if (result.error) {
        onError(result.error.message ?? 'That card was not accepted.')
        return
      }
      await onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !stripe}>
          {busy ? 'Saving…' : 'Save this card'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
