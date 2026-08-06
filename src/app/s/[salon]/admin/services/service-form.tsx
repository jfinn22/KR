'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/field'
import { saveServiceAction } from '@/server/actions/catalog'

/**
 * What a service IS, as opposed to what it is made of.
 *
 * `saveServiceAction` has existed since the catalog shipped — an eighteen-field
 * schema covering price, the chemical flags, patch tests, skills, buffers and
 * whether it can be booked online — and nothing ever called it. The phase
 * editor next door could change how a service is built, so a salon could
 * restructure a colour into stages and still not rename it, reprice it, or take
 * it off the online booking page. A salon's price list changes constantly; this
 * one was read-only.
 *
 * The chemical boxes are deliberately three separate questions rather than one.
 * They drive different rules — a patch test, the staged-lift ceiling, the
 * extension checks — and a salon that thinks "colour" is one flag ends up with
 * a bleach service the engine treats as a trim.
 */
export interface ServiceFormValues {
  id: string | null
  name: string
  slug: string
  categoryId: string
  description: string
  basePriceCents: number
  baseComplexity: number
  isChemical: boolean
  isLightening: boolean
  containsDye: boolean
  isExtensionInstall: boolean
  requiresConsultation: boolean
  requiresPatchTest: boolean
  bufferBeforeMin: number | null
  bufferAfterMin: number | null
  isBookableOnline: boolean
  isActive: boolean
}

const BLANK: ServiceFormValues = {
  id: null,
  name: '',
  slug: '',
  categoryId: '',
  description: '',
  basePriceCents: 0,
  baseComplexity: 10,
  isChemical: false,
  isLightening: false,
  containsDye: false,
  isExtensionInstall: false,
  requiresConsultation: false,
  requiresPatchTest: false,
  bufferBeforeMin: null,
  bufferAfterMin: null,
  isBookableOnline: true,
  isActive: true,
}

/** Lower case, hyphenated, no trailing junk — the shape the action demands. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function ServiceForm({
  salonSlug,
  categories,
  service,
}: {
  salonSlug: string
  categories: { id: string; name: string }[]
  service: ServiceFormValues | null
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [values, setValues] = React.useState<ServiceFormValues>(
    service ?? { ...BLANK, categoryId: categories[0]?.id ?? '' },
  )
  const [price, setPrice] = React.useState(
    service ? String(service.basePriceCents / 100) : '',
  )
  /*
   * Only auto-derived for a NEW service. Changing an existing slug breaks any
   * link a salon has already put on Instagram, so it becomes theirs to edit
   * deliberately once it exists.
   */
  const [slugTouched, setSlugTouched] = React.useState(service !== null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  function set(patch: Partial<ServiceFormValues>) {
    setValues((current) => ({ ...current, ...patch }))
  }

  async function save() {
    setBusy(true)
    setError(null)

    const result = await saveServiceAction(salonSlug, {
      serviceId: values.id,
      name: values.name.trim(),
      slug: (slugTouched ? values.slug : slugify(values.name)).trim(),
      categoryId: values.categoryId,
      description: values.description.trim() === '' ? null : values.description.trim(),
      basePriceCents: Math.round(Number(price || 0) * 100),
      baseComplexity: values.baseComplexity,
      isChemical: values.isChemical,
      isLightening: values.isLightening,
      containsDye: values.containsDye,
      isExtensionInstall: values.isExtensionInstall,
      requiresConsultation: values.requiresConsultation,
      requiresPatchTest: values.requiresPatchTest,
      requiredSkillCode: null,
      requiredSkillLevel: null,
      bufferBeforeMin: values.bufferBeforeMin,
      bufferAfterMin: values.bufferAfterMin,
      isBookableOnline: values.isBookableOnline,
      isActive: values.isActive,
    })
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
    setOpen(false)
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {service ? 'Change what this service is' : 'Add a service'}
        </Button>
      </div>
    )
  }

  const check = (
    label: string,
    key: keyof ServiceFormValues,
    help?: string,
  ) => (
    <label className="flex max-w-md items-start gap-2 text-body text-ink">
      <input
        type="checkbox"
        className="mt-1"
        checked={values[key] as boolean}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<ServiceFormValues>)}
      />
      <span>
        {label}
        {help && <span className="block text-secondary text-ink-muted">{help}</span>}
      </span>
    </label>
  )

  return (
    <div className="flex max-w-2xl flex-col gap-5 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-wrap gap-5">
        <Field label="What it is called">
          <input
            value={values.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Full head of highlights"
            className="w-64 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Price">
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            className="w-28 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Category">
          <Select
            value={values.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
            className="w-48"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Web address"
        help="What appears in the link. Changing it on a live service breaks any link already shared."
      >
        <input
          value={slugTouched ? values.slug : slugify(values.name)}
          onChange={(e) => {
            setSlugTouched(true)
            set({ slug: e.target.value })
          }}
          className="w-64 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
        />
      </Field>

      <Field label="How you describe it" help="What a client reads before choosing it.">
        <Textarea
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={2}
        />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="label-caps mb-2">What is in it</legend>
        {/*
         * Three questions rather than one, because they drive different rules.
         * `isChemical` is forced true by the action if either of the others is
         * ticked — the flags disagreeing is how a bleach ends up scheduled and
         * consented like a trim.
         */}
        {check('It lightens hair', 'isLightening', 'Bleach, high lift, balayage.')}
        {check('It deposits colour', 'containsDye', 'Tint, gloss, toner.')}
        {check('It is otherwise chemical', 'isChemical', 'Perms, relaxers, keratin.')}
        {check('It installs extensions', 'isExtensionInstall')}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="label-caps mb-2">Before it can be booked</legend>
        {check(
          'Somebody has to approve a consultation first',
          'requiresConsultation',
          'The desk can still override this with a written reason.',
        )}
        {check('It needs a current patch test', 'requiresPatchTest')}
        {check('Clients can book it themselves online', 'isBookableOnline')}
        {check('It is on offer', 'isActive', 'Turn this off to retire a service without losing its history.')}
      </fieldset>

      <div className="flex flex-wrap gap-5">
        <Field label="Gap before" help="Minutes. Empty for none.">
          <input
            value={values.bufferBeforeMin ?? ''}
            onChange={(e) =>
              set({
                bufferBeforeMin: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')),
              })
            }
            className="w-20 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Gap after">
          <input
            value={values.bufferAfterMin ?? ''}
            onChange={(e) =>
              set({
                bufferAfterMin: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')),
              })
            }
            className="w-20 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
        <Field label="Difficulty" help="0–100. Feeds the estimate.">
          <input
            value={values.baseComplexity}
            onChange={(e) => set({ baseComplexity: Number(e.target.value.replace(/\D/g, '') || 0) })}
            className="w-20 rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
          />
        </Field>
      </div>

      {error && <p className="text-secondary text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={busy || values.name.trim() === '' || values.categoryId === ''}
        >
          {busy ? 'Saving…' : service ? 'Save' : 'Create it'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
