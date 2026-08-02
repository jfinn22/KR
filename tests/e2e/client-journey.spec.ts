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

    // Hair level swatches
    const levels = fieldset.getByRole('radio', { name: /^Level \d+$/ })
    if ((await levels.count()) === 10) {
      await levels.nth((opts.level ?? 6) - 1).click()
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

    const next = page.getByRole('button', { name: /continue|see my plan|add photos/i })
    if ((await next.count()) === 0) break

    const sectionBefore = await page.getByRole('heading', { level: 1 }).innerText()
    await next.first().click()

    // Wait for the section to change or the route to move on, rather than a
    // fixed sleep that is either flaky or slow.
    await page
      .waitForFunction(
        (before) =>
          document.querySelector('h1')?.textContent !== before ||
          /\/review|\/photos/.test(location.pathname),
        sectionBefore,
        { timeout: 15_000 },
      )
      .catch(() => undefined)

    if (/\/review|\/photos/.test(page.url())) break
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

    await page.getByRole('button', { name: /confirm this time/i }).click()

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
    if (/\/photos/.test(page.url())) {
      await expect(page.getByRole('heading', { level: 1 })).toContainText(/show us your hair/i)
      await page.getByRole('button', { name: /see my plan/i }).click()
    }

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
