'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/field'
import { saveFormulaAction } from '@/server/actions/formula'

/**
 * What went on the hair.
 *
 * `Formula` has been read by the handoff card, the client timeline and the
 * backbar costing since the beginning, and nothing in the product ever created
 * one — the seed did, which is why all three screens have always looked
 * finished. This is the missing half.
 *
 * Products are optional per line and matter more than they look: a line tied to
 * the salon's own stock is a line the costing can price, and a line without one
 * is a name in a record. The stylist should not have to care about that
 * distinction, so it is a dropdown that defaults to nothing.
 */
const PURPOSES = [
  { value: 'GLOBAL_COLOR', label: 'All-over colour' },
  { value: 'ROOT_TOUCH_UP', label: 'Roots' },
  { value: 'LIGHTENER', label: 'Lightener' },
  { value: 'TONER', label: 'Toner' },
  { value: 'GLOSS', label: 'Gloss' },
  { value: 'LOWLIGHT', label: 'Lowlights' },
  { value: 'TREATMENT', label: 'Treatment' },
  { value: 'PERM', label: 'Perm' },
  { value: 'RELAXER', label: 'Relaxer' },
  { value: 'SMOOTHING', label: 'Smoothing' },
]

interface Line {
  productName: string
  shadeCode: string
  parts: string
  retailProductId: string
}

const EMPTY: Line = { productName: '', shadeCode: '', parts: '', retailProductId: '' }

export function FormulaForm({
  salonSlug,
  appointmentId,
  products,
  initial,
}: {
  salonSlug: string
  appointmentId: string
  products: { id: string; name: string; brand: string | null }[]
  initial: {
    purpose: string
    developerVolume: number | null
    ratio: string | null
    processingTimeMin: number | null
    applicationNotes: string | null
    components: { productName: string; shadeCode: string | null; parts: number | null; retailProductId: string | null }[]
  } | null
}) {
  const router = useRouter()
  const [purpose, setPurpose] = React.useState(initial?.purpose ?? 'GLOBAL_COLOR')
  const [developer, setDeveloper] = React.useState(String(initial?.developerVolume ?? ''))
  const [ratio, setRatio] = React.useState(initial?.ratio ?? '')
  const [processing, setProcessing] = React.useState(String(initial?.processingTimeMin ?? ''))
  const [notes, setNotes] = React.useState(initial?.applicationNotes ?? '')
  const [lines, setLines] = React.useState<Line[]>(
    initial && initial.components.length > 0
      ? initial.components.map((c) => ({
          productName: c.productName,
          shadeCode: c.shadeCode ?? '',
          parts: c.parts === null ? '' : String(c.parts),
          retailProductId: c.retailProductId ?? '',
        }))
      : [{ ...EMPTY }, { ...EMPTY }],
  )
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  function setLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  async function save() {
    const filled = lines.filter((line) => line.productName.trim() !== '')
    if (filled.length === 0) {
      setError('A formula needs at least one thing in it.')
      return
    }

    setBusy(true)
    setError(null)
    setSaved(false)

    const result = await saveFormulaAction(salonSlug, {
      appointmentId,
      purpose,
      developerVolume: developer.trim() === '' ? null : Number(developer),
      ratio: ratio.trim() === '' ? null : ratio.trim(),
      processingTimeMin: processing.trim() === '' ? null : Number(processing),
      applicationNotes: notes.trim() === '' ? null : notes.trim(),
      components: filled.map((line) => ({
        productName: line.productName.trim(),
        brand: null,
        shadeCode: line.shadeCode.trim() === '' ? null : line.shadeCode.trim(),
        parts: line.parts.trim() === '' ? null : Number(line.parts),
        grams: null,
        retailProductId: line.retailProductId === '' ? null : line.retailProductId,
      })),
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-5">
        <Field label="What it was">
          <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="max-w-56">
            {PURPOSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Developer" help="Volume.">
          <input
            value={developer}
            onChange={(e) => setDeveloper(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Ratio" help="1:1.5, and so on.">
          <input
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Processing" help="Minutes.">
          <input
            value={processing}
            onChange={(e) => setProcessing(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="label-caps mb-2">What went in it</legend>
        {lines.map((line, index) => (
          <div key={index} className="flex flex-wrap items-center gap-3">
            <input
              aria-label={`Product ${index + 1}`}
              value={line.productName}
              onChange={(e) => setLine(index, { productName: e.target.value })}
              placeholder="Shade or product"
              className="min-w-48 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
            <input
              aria-label={`Parts ${index + 1}`}
              value={line.parts}
              onChange={(e) => setLine(index, { parts: e.target.value.replace(/[^\d.]/g, '') })}
              placeholder="Parts"
              inputMode="decimal"
              className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
            <Select
              aria-label={`Stock for ${index + 1}`}
              value={line.retailProductId}
              onChange={(e) => setLine(index, { retailProductId: e.target.value })}
              className="max-w-56"
            >
              <option value="">Not costed</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.brand ? `${product.brand} ${product.name}` : product.name}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <div>
          <Button variant="ghost" size="sm" onClick={() => setLines((c) => [...c, { ...EMPTY }])}>
            Another line
          </Button>
        </div>
      </fieldset>

      <Field label="How it went on" help="Sectioning, placement, anything the next person needs.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Field>

      {error && <p className="text-secondary text-danger">{error}</p>}
      {saved && <p className="text-secondary text-success">Saved to their record.</p>}

      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save the formula'}
        </Button>
      </div>
    </div>
  )
}
