'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { recordAftercareAction, settleRecommendationAction } from '@/server/actions/retention'

/**
 * What to do with it once they leave.
 *
 * Written at the chair while the stylist still remembers why, not typed up
 * later — the reason a product was suggested is the whole difference between
 * aftercare and a sales target, and it is the first thing to evaporate.
 *
 * The advice lands on the client's own timeline rather than on the appointment,
 * because in six weeks nobody opens an appointment from April. They open their
 * hair.
 */
export function AftercareForm({
  salonSlug,
  appointmentId,
  products,
  initialAdvice,
  initialProducts,
}: {
  salonSlug: string
  appointmentId: string
  products: { id: string; name: string; brand: string | null }[]
  initialAdvice: string | null
  initialProducts: { id: string; name: string; reason: string | null; status: string }[]
}) {
  const router = useRouter()
  const [advice, setAdvice] = React.useState(initialAdvice ?? '')
  const [chosen, setChosen] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  async function settle(recommendationId: string, taken: boolean) {
    setBusy(true)
    setError(null)
    const result = await settleRecommendationAction(salonSlug, { recommendationId, taken })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)

    const result = await recordAftercareAction(salonSlug, {
      appointmentId,
      advice,
      products: Object.entries(chosen).map(([retailProductId, reason]) => ({
        retailProductId,
        reason: reason.trim() === '' ? null : reason.trim(),
      })),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setChosen({})
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      {initialProducts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {initialProducts.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center gap-3 text-secondary text-ink-muted">
              <span>
                <span className="text-ink">{product.name}</span>
                {product.reason && ` — ${product.reason}`}
              </span>
              {/*
               * This row used to show a "bought" marker that nothing could ever
               * produce: PURCHASED and DECLINED had no writer, so every
               * recommendation stayed RECOMMENDED and the attachment rate on
               * the retention screen could only ever read zero.
               */}
              {product.status === 'PURCHASED' && <span className="text-success">bought</span>}
              {product.status === 'DECLINED' && <span className="text-ink-subtle">not taken</span>}
              {product.status === 'RECOMMENDED' && (
                <span className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => settle(product.id, true)}
                  >
                    They took it
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => settle(product.id, false)}
                  >
                    They did not
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Field
        label="What they should do at home"
        help="In your words. This goes on their own hair timeline, where they will actually find it."
      >
        <Textarea
          value={advice}
          onChange={(e) => setAdvice(e.target.value)}
          rows={4}
          placeholder="Leave it 48 hours before washing. Cool water on the rinse — heat is what pulls the tone out."
        />
      </Field>

      {products.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="label-caps mb-2">Anything they need for it</legend>
          {products.map((product) => (
            <div key={product.id} className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-56 items-center gap-2 text-body text-ink">
                <input
                  type="checkbox"
                  checked={chosen[product.id] !== undefined}
                  onChange={(e) =>
                    setChosen((current) => {
                      const next = { ...current }
                      if (e.target.checked) next[product.id] = ''
                      else delete next[product.id]
                      return next
                    })
                  }
                />
                {product.brand ? `${product.brand} ${product.name}` : product.name}
              </label>
              {chosen[product.id] !== undefined && (
                <input
                  aria-label={`Why ${product.name}`}
                  value={chosen[product.id]}
                  onChange={(e) =>
                    setChosen((current) => ({ ...current, [product.id]: e.target.value }))
                  }
                  placeholder="Why — the bit that makes it advice"
                  className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
                />
              )}
            </div>
          ))}
        </fieldset>
      )}

      {error && <p className="text-secondary text-danger">{error}</p>}
      {saved && <p className="text-secondary text-success">Saved to their timeline.</p>}

      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save aftercare'}
        </Button>
      </div>
    </div>
  )
}
