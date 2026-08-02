import { expect, test, type Page } from '@playwright/test'

/**
 * The owner's dashboard and the integration surfaces.
 *
 * The dashboard is led by quote accuracy because that is the claim the product
 * makes and the one no other salon software can answer, so most of what is
 * asserted here is that the number is present, honest, and refuses to appear
 * when there is not enough data behind it.
 */

const SALON = 'aurora'
const OWNER = { email: 'owner@aurora.test', password: 'salon1234' }
const CLIENT = { email: 'client@aurora.test', password: 'salon1234' }

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('the owner dashboard', () => {
  test('leads with whether the quotes were true', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/insights`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/how the salon is doing/i)

    // The claim, and the reason it is measured the way it is.
    await expect(page.getByRole('heading', { name: /were the quotes true/i })).toBeVisible()
    await expect(page.getByText(/chair time, not booked time/i)).toBeVisible()

    for (const label of ['Estimates that held', 'Typical miss', 'Consistent bias', 'Price held']) {
      await expect(page.locator('p.label-caps', { hasText: label }).first()).toBeVisible()
    }
  })

  test('breaks accuracy down by stylist, because pace is personal', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/insights?days=90`)

    await expect(page.locator('p.label-caps', { hasText: 'By stylist' })).toBeVisible()

    // The seed gives stylists deliberately divergent pace, so at least one
    // shows a real bias figure rather than a dash.
    const biases = await page.getByText(/^[+-]\d+m$/).count()
    expect(biases).toBeGreaterThan(0)
  })

  test('names where consultations stop rather than only a conversion rate', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/insights`)

    await expect(page.getByRole('heading', { name: /where consultations stop/i })).toBeVisible()
    await expect(page.getByText(/started/i).first()).toBeVisible()
  })

  test('shows takings against the period before, never a bare number', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/insights?days=30`)

    await expect(page.getByRole('heading', { name: /^takings$/i })).toBeVisible()
    await expect(page.getByText(/vs the period before/i)).toBeVisible()
  })

  test('explains what interleaving is worth in the salon’s own numbers', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/insights`)

    await expect(page.getByRole('heading', { name: /chair time/i })).toBeVisible()
    await expect(page.getByText(/days each stylist actually worked/i)).toBeVisible()
    await expect(page.getByText(/freed/).first()).toBeVisible()
  })

  test('the range switcher changes the window', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/insights`)

    await page.getByRole('link', { name: '7 days' }).click()
    await expect(page).toHaveURL(/days=7/)
    await expect(page.getByText('Last 7 days.')).toBeVisible()
  })

  test('a client cannot read the salon’s numbers', async ({ page }) => {
    await signIn(page, CLIENT)
    const response = await page.goto(`/s/${SALON}/insights`)
    expect(response?.status()).not.toBe(200)
  })
})

test.describe('integrations', () => {
  test('leads with the calendar feed, which cannot break anything', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/integrations`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/integrations/i)
    await expect(page.getByText(/nothing here can stop a booking/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /calendar feeds/i })).toBeVisible()
  })

  /*
   * The link is shown once because only its hash is stored. A credential you
   * can re-read from a settings page forever is one nobody ever rotates.
   */
  test('a feed link is shown exactly once, at the moment it is created', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/integrations`)

    await page
      .getByRole('button', { name: /create a link|replace the link/i })
      .first()
      .click()

    await expect(page.getByText(/copy this now/i)).toBeVisible({ timeout: 15_000 })
    const url = await page.locator('code').first().innerText()
    expect(url).toContain('/api/calendar/')
    expect(url).toContain('token=')

    // Reloading does not show it again.
    await page.reload()
    await expect(page.getByText(/copy this now/i)).toHaveCount(0)
  })

  test('the feed serves a real calendar and refuses a wrong token', async ({ page, request }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/integrations`)

    await page
      .getByRole('button', { name: /create a link|replace the link/i })
      .first()
      .click()
    await expect(page.getByText(/copy this now/i)).toBeVisible({ timeout: 15_000 })

    const url = await page.locator('code').first().innerText()
    const path = new URL(url).pathname + new URL(url).search

    const good = await request.get(path)
    expect(good.ok()).toBe(true)
    expect(good.headers()['content-type']).toContain('text/calendar')
    expect(await good.text()).toContain('BEGIN:VCALENDAR')

    const bad = await request.get(`${new URL(url).pathname}?token=nope`)
    expect(bad.status()).toBe(404)
  })

  test('an unsigned feed request is refused', async ({ request }) => {
    const response = await request.get('/api/calendar/anything.ics')
    expect(response.status()).toBe(404)
  })

  test('the mock banner is honest about what is running', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/integrations`)

    await expect(page.getByRole('heading', { name: /running on mocks/i })).toBeVisible()
    await expect(page.getByText(/no accounts and no keys/i)).toBeVisible()
  })

  test('a client cannot manage integrations', async ({ page }) => {
    await signIn(page, CLIENT)
    const response = await page.goto(`/s/${SALON}/admin/integrations`)
    expect(response?.status()).not.toBe(200)
  })
})
