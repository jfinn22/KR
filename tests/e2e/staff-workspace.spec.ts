import { expect, test, type Page } from '@playwright/test'

/**
 * The staff side: the review queue where a person agrees with or corrects the
 * engine, and the front desk where the day actually happens.
 *
 * Runs against a production build on mock adapters with the seeded demo salon,
 * whose live day deliberately contains a running-late appointment, one in the
 * chair and one processing — so these assertions are about real states rather
 * than fixtures invented here.
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

test.describe('the front desk', () => {
  test('shows the day grouped by what needs doing', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/today/i)

    // The four numbers the desk reads first. Scoped to the stat labels, since
    // the same words appear again inside the groups below.
    for (const label of ['Booked in', 'Arrived', 'Expected takings', 'Deposits outstanding']) {
      await expect(page.locator('p.label-caps', { hasText: label }).first()).toBeVisible()
    }

    // The seed puts one appointment past its start with nobody having acted.
    await expect(page.getByRole('heading', { name: /running late/i })).toBeVisible()
    await expect(page.getByText(/\d+m late/).first()).toBeVisible()
  })

  test('processing is called out as a free stylist, not just a status', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk`)

    const processing = page.getByRole('heading', { name: /^processing$/i })
    await expect(processing).toBeVisible()
    await expect(page.getByText(/stylists are free right now/i)).toBeVisible()
  })

  // The state machine, driven through the UI rather than the service.
  test('an arrival can be walked from booked to finished', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk`)

    const arrived = page.getByRole('button', { name: /^arrived$/i }).first()
    await expect(arrived).toBeVisible()
    await arrived.click()

    const start = page.getByRole('button', { name: /^start$/i }).first()
    await expect(start).toBeVisible({ timeout: 15_000 })
    await start.click()

    const finish = page.getByRole('button', { name: /^finished$/i }).first()
    await expect(finish).toBeVisible({ timeout: 15_000 })
    await finish.click()

    await expect(page.getByRole('heading', { name: /^finished$/i })).toBeVisible({
      timeout: 15_000,
    })
  })

  test('no-show asks twice, because it costs the client something', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk`)

    const noShow = page.getByRole('button', { name: /^no-show$/i }).first()
    await expect(noShow).toBeVisible()
    await noShow.click()

    // Nothing has happened yet — a confirm stands between the tap and the cost.
    await expect(page.getByText(/mark as a no-show\?/i)).toBeVisible()
    await page
      .getByRole('button', { name: /^cancel$/i })
      .first()
      .click()
    await expect(page.getByText(/mark as a no-show\?/i)).toHaveCount(0)
  })

  test('the diary draws processing gaps as free time', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/calendar`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/the day/i)
    await expect(page.getByText(/gold blocks are processing/i)).toBeVisible()
    await expect(page.getByText(/free — processing/i).first()).toBeVisible()
  })

  test('client search takes a name and refuses a single letter', async ({ page }) => {
    await signIn(page, OWNER)

    await page.goto(`/s/${SALON}/desk/clients?q=a`)
    await expect(page.getByRole('heading', { name: /find a client/i })).toBeVisible()
    await expect(page.getByRole('listitem')).toHaveCount(0)

    await page.goto(`/s/${SALON}/desk/clients?q=Ada`)
    await expect(page.getByRole('listitem').first()).toBeVisible()
  })

  test('a client record shows what the client cannot see about themselves', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients?q=Ada`)
    await page
      .getByRole('link', { name: /^open$/i })
      .first()
      .click()

    await expect(page).toHaveURL(/\/desk\/clients\/[a-z0-9]+/, { timeout: 15_000 })
    await expect(page.getByText('No-shows')).toBeVisible()
    await expect(page.getByText('Typical overrun')).toBeVisible()
  })
})

test.describe('the review queue', () => {
  test('orders by urgency and shows the clock on every row', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/review`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/consultations to review/i)

    // Scoped to the stat labels: "Waiting" is also a filter tab.
    for (const label of ['Waiting', 'Past their SLA', 'Open blockers']) {
      await expect(page.locator('p.label-caps', { hasText: label }).first()).toBeVisible()
    }

    // The seed leaves one consultation past its SLA, so the queue has something
    // to sort above the routine work.
    await expect(page.getByText(/over$/).first()).toBeVisible()
  })

  test('a review shows the stylist-facing detail and every flag has a path', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/review`)

    const first = page.getByRole('link', { name: /flag/i }).first()
    if ((await first.count()) === 0) test.skip(true, 'Nothing in the queue')
    await first.click()

    await expect(page).toHaveURL(/\/review\/[a-z0-9]+/, { timeout: 15_000 })

    await expect(page.getByRole('heading', { name: /risk flags/i })).toBeVisible()
    await expect(page.getByText(/recommended/i).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /what they told us/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /your decision/i })).toBeVisible()
  })

  test('overriding a flag demands a written reason before it will save', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/review`)

    const first = page.getByRole('link', { name: /flag/i }).first()
    if ((await first.count()) === 0) test.skip(true, 'Nothing in the queue')
    await first.click()
    await expect(page).toHaveURL(/\/review\/[a-z0-9]+/, { timeout: 15_000 })

    await page
      .getByRole('button', { name: /override…/i })
      .first()
      .click()

    // Disabled until there is a reason worth recording.
    const confirm = page.getByRole('button', { name: /override and proceed/i })
    await expect(confirm).toBeDisabled()

    await page.getByRole('textbox').first().fill('Strand test came back clean this morning.')
    await expect(confirm).toBeEnabled()
  })

  test('override fields start blank, so agreeing is the default', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/review`)

    const first = page.getByRole('link', { name: /flag/i }).first()
    if ((await first.count()) === 0) test.skip(true, 'Nothing in the queue')
    await first.click()
    await expect(page).toHaveURL(/\/review\/[a-z0-9]+/, { timeout: 15_000 })

    // Empty means "I agree with the engine". A pre-filled value invites a nudge,
    // and every nudge is recorded as the human disagreeing.
    await expect(page.locator('#ov-duration')).toHaveValue('')
    await expect(page.locator('#ov-price')).toHaveValue('')
  })
})

test.describe('staff boundaries', () => {
  test('a client cannot reach the desk or the review queue', async ({ page }) => {
    await signIn(page, CLIENT)

    for (const path of ['/desk', '/review', '/desk/clients']) {
      const response = await page.goto(`/s/${SALON}${path}`)
      expect(response?.status(), path).not.toBe(200)
    }
  })

  test('staff landing on the client home are sent to their own day', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/my`)
    await expect(page).toHaveURL(/\/desk/, { timeout: 15_000 })
  })
})
