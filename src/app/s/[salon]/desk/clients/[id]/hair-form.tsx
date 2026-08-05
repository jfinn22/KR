'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { updateHairProfileAction } from '@/server/actions/formula'

/**
 * What this client's hair is actually like.
 *
 * `HairProfile` has thirty-odd fields, every one of them read somewhere, and
 * exactly one of them — `priorReactionToColor` — was ever written by the
 * application. The rest have sat at their schema defaults since the day the
 * table was created, which means every screen that reasons from them has been
 * reasoning about a client who washes their hair three times a week, has no
 * grey, and does not swim.
 *
 * Only the fields a prediction actually turns on are here. A form asking for
 * all thirty gets filled in once, badly, by somebody who has a client waiting.
 */
export function HairForm({
  salonSlug,
  clientProfileId,
  initial,
}: {
  salonSlug: string
  clientProfileId: string
  initial: {
    naturalLevel: number | null
    currentLevelRoots: number | null
    greyPercent: number | null
    washesPerWeek: number | null
    heatStylingPerWeek: number | null
    swimsChlorinatedWeekly: boolean
    usesPurpleShampoo: boolean
    hardWater: boolean
    growthCmPerMonth: number | null
  }
}) {
  const router = useRouter()
  const [form, setForm] = React.useState({
    naturalLevel: str(initial.naturalLevel),
    currentLevelRoots: str(initial.currentLevelRoots),
    greyPercent: str(initial.greyPercent),
    washesPerWeek: str(initial.washesPerWeek),
    heatStylingPerWeek: str(initial.heatStylingPerWeek),
    growthCmPerMonth: str(initial.growthCmPerMonth),
  })
  const [swims, setSwims] = React.useState(initial.swimsChlorinatedWeekly)
  const [purple, setPurple] = React.useState(initial.usesPurpleShampoo)
  const [hard, setHard] = React.useState(initial.hardWater)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)

    const result = await updateHairProfileAction(salonSlug, {
      clientProfileId,
      naturalLevel: num(form.naturalLevel),
      currentLevelRoots: num(form.currentLevelRoots),
      greyPercent: num(form.greyPercent),
      washesPerWeek: num(form.washesPerWeek),
      heatStylingPerWeek: num(form.heatStylingPerWeek),
      growthCmPerMonth: num(form.growthCmPerMonth),
      swimsChlorinatedWeekly: swims,
      usesPurpleShampoo: purple,
      hardWater: hard,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    router.refresh()
  }

  const number = (key: keyof typeof form, label: string, help: string) => (
    <Field label={label} help={help}>
      <input
        value={form[key]}
        onChange={(e) => setForm((c) => ({ ...c, [key]: e.target.value.replace(/[^\d.]/g, '') }))}
        inputMode="decimal"
        className="w-24 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
      />
    </Field>
  )

  const toggle = (value: boolean, set: (v: boolean) => void, label: string) => (
    <label className="flex items-center gap-2 text-body text-ink">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  )

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-5">
        {number('naturalLevel', 'Natural level', 'What grows out of their head.')}
        {number('currentLevelRoots', 'Wearing', 'The level at the root now.')}
        {number('greyPercent', 'Grey %', 'Grey at the parting shows first.')}
      </div>

      <div className="flex flex-wrap gap-5">
        {number('washesPerWeek', 'Washes a week', 'The biggest single thing they control.')}
        {number('heatStylingPerWeek', 'Heat a week', 'Irons, tongs, a hot dryer.')}
        {number('growthCmPerMonth', 'Growth cm/month', 'If anyone has measured it. Average is 1.25.')}
      </div>

      <fieldset className="flex flex-wrap gap-6">
        <legend className="label-caps mb-2">And</legend>
        {toggle(swims, setSwims, 'Swims in chlorine weekly')}
        {toggle(purple, setPurple, 'Uses purple shampoo')}
        {toggle(hard, setHard, 'Hard water at home')}
      </fieldset>

      {error && <p className="text-secondary text-danger">{error}</p>}
      {saved && <p className="text-secondary text-success">Saved.</p>}

      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

const str = (value: number | null): string => (value === null ? '' : String(value))
/** Empty means "we still do not know", which is different from zero. */
const num = (value: string): number | null => (value.trim() === '' ? null : Number(value))
