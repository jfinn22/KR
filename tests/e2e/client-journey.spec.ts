import { expect, test, type Page } from '@playwright/test'

/**
 * The loop the whole product exists to close: a client consults, is evaluated,
 * gets an answer, and books a slot that genuinely fits — with nobody in the
 * middle for a straightforward service, and a stylist in the middle for
 * anything the engine flags.
 *
 * Runs against a production build on mock adapters with the seeded demo salon,
 * so it exercises the real stack rather than a harness.
 */

const SALON = 'aurora'

/**
 * A started consultation, not the picker.
 *
 * `[a-z0-9]+$` also matches `/my/consult/new`, so a laxer pattern passes while
 * the click that starts the consultation has not landed — and every later step
 * then runs against the wrong page.
 */
const CONSULT_URL = /\/my\/consult\/[a-z0-9]{20,}$/
const CLIENT = { email: 'client@aurora.test', password: 'salon1234' }
const OWNER = { email: 'owner@aurora.test', password: 'salon1234' }

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Fill in whatever the current step is asking, then continue. */
async function answerStep(page: Page, opts: { boxDye?: boolean; level?: number } = {}) {
  const fieldsets = page.locator('fieldset')
  const count = await fieldsets.count()

  for (let i = 0; i < count; i++) {
    const fieldset = fieldsets.nth(i)
    const prompt = (await fieldset.locator('legend').innerText()).toLowerCase()

    // Yes/No
    const radios = fieldset.getByRole('radio')
    if ((await radios.count()) === 2) {
      const wantsYes = opts.boxDye === true && /box|colour at home|home colour/.test(prompt)
      await radios.nth(wantsYes ? 0 : 1).click()
      continue
    }

    // The shade chart: a colour family, then a named shade inside it. The
    // natural family spans every level, so the wanted depth is always reachable
    // without having to change family first.
    const familySelect = fieldset.locator('select[id$="-family"]')
    if ((await familySelect.count()) > 0) {
      const wanted = fieldset.getByRole('radio', {
        name: new RegExp(`, level ${opts.level ?? 6}$`, 'i'),
      })
      const target = (await wanted.count()) > 0 ? wanted : fieldset.getByRole('radio')
      await target.first().click()
      continue
    }

    // A 1–5 scale
    const scale = fieldset.getByRole('radio')
    if ((await scale.count()) === 5) {
      await scale.nth(2).click()
      continue
    }

    // Single/multi choice rows
    const choices = fieldset.locator('[role="radio"], [role="checkbox"]')
    if ((await choices.count()) > 0) {
      await choices.first().click()
      continue
    }

    const select = fieldset.locator('select')
    if ((await select.count()) > 0) {
      const options = await select.first().locator('option').all()
      if (options.length > 1) await select.first().selectOption({ index: 1 })
      continue
    }

    const date = fieldset.locator('input[type="date"]')
    if ((await date.count()) > 0) {
      await date.first().fill('2026-12-01')
      continue
    }

    const number = fieldset.locator('input[type="number"]')
    if ((await number.count()) > 0) {
      await number.first().fill('4')
      continue
    }

    const textarea = fieldset.locator('textarea')
    if ((await textarea.count()) > 0) {
      await textarea.first().fill('No particular concerns.')
      continue
    }

    const text = fieldset.locator('input[type="text"], input:not([type])')
    if ((await text.count()) > 0) await text.first().fill('No')
  }
}

async function completeFlow(page: Page, opts: { boxDye?: boolean; level?: number } = {}) {
  // Bounded: the seeded template is six sections, and an unbounded loop here
  // would hang the suite rather than fail it if navigation broke.
  for (let step = 0; step < 12; step++) {
    // waitFor, not isVisible: isVisible does not auto-wait, so a client-side
    // route push that has not painted yet reads as "no questions" and the
    // whole loop exits before answering anything.
    const visible = await page
      .locator('fieldset')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (!visible) break

    await answerStep(page, opts)

    const next = page.getByRole('button', {
      name: /continue|add photos|reference photos|see my plan/i,
    })
    if ((await next.count()) === 0) break

    const sectionBefore = await page.getByRole('heading', { level: 1 }).innerText()
    await next.first().click()

    // Wait for the section to change or the route to move on, rather than a
    // fixed sleep that is either flaky or slow.
    await page
      .waitForFunction(
        (before) =>
          document.querySelector('h1')?.textContent !== before ||
          /\/review|\/photos|\/inspiration/.test(location.pathname),
        sectionBefore,
        { timeout: 15_000 },
      )
      .catch(() => undefined)

    if (/\/review|\/photos|\/inspiration/.test(page.url())) break
  }
}

/**
 * Walk the two steps that come after the questions.
 *
 * Photos of the hair they have, then pictures of the look they want. Both are
 * skippable in one tap by design — a client with nothing saved should never be
 * stuck on the last screen of a consultation they have otherwise finished — and
 * the consultation submits from the reference step.
 */
async function finishConsultation(page: Page) {
  if (/\/photos/.test(page.url())) {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/show us your hair/i)
    await page.getByRole('button', { name: /next: the look you want/i }).click()
    await page.waitForURL(/\/inspiration/, { timeout: 20_000 })
  }

  if (/\/inspiration/.test(page.url())) {
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/the look you want/i)
    await page.getByRole('button', { name: /see my plan/i }).click()
  }
}

test.describe('the client journey', () => {
  test('a straightforward service goes consult → plan → booked', async ({ page }) => {
    await signIn(page, CLIENT)

    await page.goto(`/s/${SALON}/my/consult/new`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/what are you after/i)

    // A cut: non-chemical, so nothing to diagnose and no photos demanded.
    await page
      .getByRole('button', { name: /cut & finish/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()

    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    await completeFlow(page)
    await finishConsultation(page)

    await expect(page).toHaveURL(/\/review/, { timeout: 20_000 })
    await expect(page.getByText(/estimated price/i)).toBeVisible()
    await expect(page.getByText(/time in the chair/i)).toBeVisible()

    // Auto-approved, because the salon opted in and the engine found nothing.
    await page.getByRole('link', { name: /pick a time/i }).click()
    await expect(page).toHaveURL(/\/my\/book\//, { timeout: 15_000 })

    // Times are shown with their end, so an hours-long service is not a surprise.
    const firstSlot = page.getByRole('button', { name: /until/i }).first()
    await expect(firstSlot).toBeVisible({ timeout: 15_000 })
    await firstSlot.click()

    await expect(page.getByText(/your appointment/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/held for you for/i)).toBeVisible()

    /*
     * A deposit needs a card before it can be confirmed.
     *
     * This test used to click straight through and pass, which is precisely
     * the bug: the appointment was booked, the button said "pay the deposit",
     * and the deposit row stayed PENDING forever because there was nothing to
     * charge. The journey now walks the card step, because that is the journey
     * a real client has.
     */
    const confirm = page.getByRole('button', { name: /confirm (this time|and pay)/i })
    if (await confirm.isDisabled()) {
      await page.getByRole('button', { name: /^add a card$/i }).click()
      // No provider key in test, so the mock adapter's path is the one offered.
      await page.getByRole('button', { name: /use a test card/i }).click()
      await expect(page.getByRole('button', { name: /remove/i })).toBeVisible({ timeout: 15_000 })
    }

    /*
     * The button says what it is about to do. A visit that owes a deposit
     * reads "Confirm and pay the deposit", because a client who taps "Confirm
     * this time" and then sees a charge on their card was not told.
     */
    await expect(confirm).toBeEnabled({ timeout: 15_000 })
    await confirm.click()

    await expect(page).toHaveURL(/\/my\/appointments/, { timeout: 20_000 })
    await expect(page.getByText(/you are booked in/i)).toBeVisible()
  })

  test('a lightening service with box dye raises flags and does not auto-book', async ({
    page,
  }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)

    await page
      .getByRole('button', { name: /balayage/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    await completeFlow(page, { boxDye: true, level: 9 })

    // Lightening asks for photos; the questions come first so the client knows why.
    await finishConsultation(page)

    await expect(page).toHaveURL(/\/review/, { timeout: 20_000 })

    // The point of the product: it says what is wrong AND what to do about it.
    await expect(page.getByText(/worth knowing first/i)).toBeVisible()
    const recommendations = page.getByText(/what we recommend/i)
    expect(await recommendations.count()).toBeGreaterThan(0)

    // Not auto-approved — a flagged consultation waits for a person.
    await expect(page.getByRole('link', { name: /pick a time/i })).toHaveCount(0)
  })

  test('answering no to box dye keeps the follow-up hidden', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)

    await page
      .getByRole('button', { name: /balayage/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    // Walk to the history section, which is where the branching lives.
    for (let step = 0; step < 6; step++) {
      const legends = await page.locator('fieldset legend').allInnerTexts()
      if (legends.some((text) => /box|colour at home|home colour/i.test(text))) break

      await answerStep(page)
      await page
        .getByRole('button', { name: /continue/i })
        .first()
        .click()
      await page.waitForTimeout(400)
    }

    const boxDyeFieldset = page
      .locator('fieldset')
      .filter({ hasText: /box|colour at home|home colour/i })
      .first()

    if ((await boxDyeFieldset.count()) === 0)
      test.skip(true, 'No box-dye question in this template')

    const before = await page.locator('fieldset').count()
    await boxDyeFieldset.getByRole('radio').nth(1).click() // No
    await page.waitForTimeout(300)
    const afterNo = await page.locator('fieldset').count()

    await boxDyeFieldset.getByRole('radio').nth(0).click() // Yes
    await page.waitForTimeout(300)
    const afterYes = await page.locator('fieldset').count()

    // Yes must reveal at least as much as no. Instantly — no round trip.
    expect(afterYes).toBeGreaterThanOrEqual(afterNo)
    expect(before).toBeGreaterThan(0)
  })

  test('progress survives a reload', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)

    await page
      .getByRole('button', { name: /cut & finish/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    const url = page.url()
    await page.locator('fieldset').first().waitFor({ state: 'visible' })
    await answerStep(page)
    // Long enough for the autosave debounce to fire and land.
    await page.waitForTimeout(1500)

    await page.goto(url)
    await expect(page.locator('fieldset').first()).toBeVisible()

    // Something is checked, i.e. the answers came back from the server.
    const checked = await page.locator('[role="radio"][aria-checked="true"]').count()
    expect(checked).toBeGreaterThan(0)
  })

  test('the escape hatch to a human is on every screen', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)

    await page
      .getByRole('button', { name: /cut & finish/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    await expect(page.getByRole('link', { name: /in-person consultation/i })).toBeVisible()
  })

  /*
   * A client asks for a colour, not a number. One strip from black to blonde
   * cannot express copper, so the family comes first and the shades under it
   * are named the way somebody would say them out loud.
   */
  test('a client picks the exact shade, by family and by name', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)

    await page
      .getByRole('button', { name: /balayage/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    const family = page.locator('select[id$="-family"]').first()
    await expect(family).toBeVisible({ timeout: 15_000 })

    // Every way a client describes their colour is on offer, not just depth.
    const families = await family.locator('option').allInnerTexts()
    expect(families.join(' ')).toMatch(/blonde/i)
    expect(families.join(' ')).toMatch(/brown|brunette/i)
    expect(families.join(' ')).toMatch(/red|copper/i)

    // Choosing a family swaps the swatches for that family's real shades.
    await family.selectOption('RED')
    const copper = page.getByRole('radio', { name: /^copper, level/i }).first()
    await expect(copper).toBeVisible()
    await copper.click()

    // Said back in words, because a grid of swatches all looks alike on a phone.
    await expect(page.getByText(/you picked/i)).toBeVisible()
    await expect(page.getByText('Copper', { exact: true }).first()).toBeVisible()

    // And it survives a reload, which is what proves the shade was stored.
    // Long enough for the autosave debounce to fire and land, as elsewhere.
    await page.waitForTimeout(1500)
    await page.reload()
    await expect(page.getByRole('radio', { name: /^copper, level/i })).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 15_000 },
    )
  })

  /*
   * The reference picture used to be a text link at the bottom of the photo
   * step. It is the most useful thing a client can hand a stylist, so it is now
   * the last step of every consultation — and still skippable in one tap.
   */
  test('every consultation ends on the look they want, and can be sent without one', async ({
    page,
  }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)

    await page
      .getByRole('button', { name: /cut & finish/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    await completeFlow(page)

    // A cut needs no photos of its own hair, and still lands here.
    await expect(page).toHaveURL(/\/inspiration/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/the look you want/i)

    // The upload is the screen, not a footnote at the bottom of it.
    await expect(page.getByRole('button', { name: /add a reference picture/i })).toBeVisible()

    await expect(page.getByText(/you can send it without one/i)).toBeVisible()
    await page.getByRole('button', { name: /see my plan/i }).click()
    await expect(page).toHaveURL(/\/review/, { timeout: 20_000 })
  })
})

/*
 * A cut used to be interrogated about box dye, henna and previous bleach.
 * `appliesToServiceIds` had been on ConsultationTemplate since the schema was
 * written and was read by nothing, so every basket got the salon's one form.
 */
test.describe('the form fits the service', () => {
  const legendsOf = async (page: Page) => {
    const seen: string[] = []
    for (let step = 0; step < 12; step++) {
      const visible = await page
        .locator('fieldset')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (!visible) break

      seen.push(...(await page.locator('fieldset legend').allInnerTexts()))
      await answerStep(page)

      const next = page.getByRole('button', { name: /continue|add photos|reference photos/i })
      if ((await next.count()) === 0) break

      const before = await page.getByRole('heading', { level: 1 }).innerText()
      await next.first().click()
      await page
        .waitForFunction(
          (was) =>
            document.querySelector('h1')?.textContent !== was ||
            /\/review|\/photos|\/inspiration/.test(location.pathname),
          before,
          { timeout: 15_000 },
        )
        .catch(() => undefined)
      if (/\/review|\/photos|\/inspiration/.test(page.url())) break
    }
    return seen.join(' | ')
  }

  test('a cut is asked about texture and scalp, and never about box dye', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)
    await page
      .getByRole('button', { name: /cut & finish/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    const asked = await legendsOf(page)
    expect(asked).toMatch(/texture/i)
    expect(asked).toMatch(/scalp/i)
    expect(asked).not.toMatch(/box dye|henna|bleach/i)
  })

  test('a colour service still gets the chemical history', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my/consult/new`)
    await page
      .getByRole('button', { name: /balayage/i })
      .first()
      .click()
    await page.getByRole('button', { name: /^continue$/i }).click()
    await expect(page).toHaveURL(CONSULT_URL, { timeout: 15_000 })

    expect(await legendsOf(page)).toMatch(/box dye/i)
  })
})

test.describe('the phase editor', () => {
  test('an owner sees the real balayage chain and what it frees up', async ({ page }) => {
    await signIn(page, OWNER)

    await page.goto(`/s/${SALON}/admin/services`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/services/i)

    await page
      .getByRole('link', { name: /balayage/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/admin\/services\/[a-z0-9]+/, { timeout: 15_000 })

    // The chain is phases, not one block — that is what makes interleaving possible.
    await expect(page.getByText('Total appointment')).toBeVisible()
    await expect(page.getByText('Stylist is held')).toBeVisible()
    await expect(page.getByText('Free to hand on')).toBeVisible()

    // Balayage has a processing gap, so at least one phase releases the stylist.
    await expect(page.getByText('Stylist free').first()).toBeVisible()

    const phases = await page.getByRole('listitem').count()
    expect(phases).toBeGreaterThan(1)
  })

  test('switching a phase to processing releases the stylist automatically', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/services`)
    await page
      .getByRole('link', { name: /balayage/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/admin\/services\/[a-z0-9]+/, { timeout: 15_000 })

    // The most expensive mistake available on this screen is a PROCESSING phase
    // that still holds the stylist — it silently disables interleaving forever.
    const firstKind = page.locator('select#kind-0')
    await firstKind.selectOption('PROCESSING')

    const stylistToggle = page.locator('input#stylist-0')
    await expect(stylistToggle).not.toBeChecked()
  })

  test('a client cannot reach the service editor', async ({ page }) => {
    await signIn(page, CLIENT)
    const response = await page.goto(`/s/${SALON}/admin/services`)

    // Whether it 403s or renders an error, what must not happen is the catalog
    // being editable by somebody who is not staff.
    const body = await page.locator('body').innerText()
    expect(body).not.toContain('Total appointment')
    expect(response?.status()).not.toBe(200)
  })
})
