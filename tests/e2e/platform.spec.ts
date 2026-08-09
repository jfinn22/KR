import { expect, test } from '@playwright/test'

/**
 * End-to-end coverage of the surfaces that exist today.
 *
 * These run against a production build on mock adapters with the seeded demo
 * salon, so they exercise the real stack — Next.js, Prisma, Postgres, the port
 * registry — rather than a harness. They deliberately assert only on shipped
 * behaviour; see docs/STATUS.md for what is not built yet.
 */

test.describe('marketing surface', () => {
  test('the landing page states the product’s actual position', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /works out whether the appointment is right/i,
    )
    await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible()
  })

  test('every call to action on it goes somewhere that exists', async ({ page }) => {
    /*
     * Both CTAs used to point at /signup and /pricing, and neither route
     * existed — the platform's own front door was two 404s, which is the most
     * expensive place in the product to have one.
     */
    await page.goto('/')

    const hrefs = await page.locator('main a[href^="/"]').evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''),
    )
    expect(hrefs.length).toBeGreaterThan(0)

    for (const href of new Set(hrefs)) {
      const response = await page.request.get(href)
      expect(response.status(), `${href} should not be a dead link`).toBeLessThan(400)
    }
  })

  test('pricing is generated from the plans the software enforces', async ({ page }) => {
    await page.goto('/pricing')

    for (const name of ['Starter', 'Pro', 'Salon']) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    // A feature only Salon has, so the table is showing real differences
    // rather than three identical columns.
    await expect(page.getByText('Your own colour and logo throughout')).toBeVisible()
  })

  test('the page has no horizontal overflow on a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto('/')

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(overflows).toBe(false)
  })

  test('sign in is reachable from the landing page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /sign in/i }).first().click()
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('design system', () => {
  test('renders every section of the reference', async ({ page }) => {
    await page.goto('/design-system')

    for (const heading of [
      'Palette',
      'Typography',
      'Buttons',
      'Badges',
      'Risk flags',
      'AI suggestions',
      'Forms',
      'Tables',
    ]) {
      await expect(page.getByRole('heading', { name: heading, exact: false })).toBeVisible()
    }
  })

  // Every risk flag must show a way forward. It is the product's core promise,
  // so it is asserted in the browser and not only in the unit tests.
  test('a risk flag always shows a recommended path', async ({ page }) => {
    await page.goto('/design-system')

    const recommendations = page.getByText('What we recommend')
    await expect(recommendations.first()).toBeVisible()
    expect(await recommendations.count()).toBeGreaterThanOrEqual(2)
  })

  test('AI output is visibly marked as advisory', async ({ page }) => {
    await page.goto('/design-system')
    await expect(page.getByText(/you decide/i).first()).toBeVisible()
    await expect(page.getByText('Advisory').first()).toBeVisible()
  })

  test('body text is black, not blue or gold', async ({ page }) => {
    await page.goto('/design-system')

    const colour = await page.evaluate(() => {
      const paragraph = document.querySelector('main p')
      return paragraph ? getComputedStyle(paragraph).color : ''
    })
    // --ink is rgb(11, 11, 12); --ink-muted is rgb(85, 85, 92).
    expect(colour).toMatch(/rgb\((11|85), (11|85), (12|92)\)/)
  })
})

test.describe('authentication', () => {
  test('rejects a wrong password without revealing whether the account exists', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('owner@aurora.test')
    await page.getByLabel('Password').fill('definitely-wrong')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Scoped to the form: Next.js renders its own role="alert" route announcer.
    await expect(page.locator('form').getByRole('alert')).toContainText(
      /didn't match|did not match/i,
    )
    await expect(page).toHaveURL(/\/login/)

    // The message must not reveal whether the account exists.
    await expect(page.locator('form')).not.toContainText(/no account|not found|unknown user/i)
  })

  test('accepts a seeded account', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('owner@aurora.test')
    await page.getByLabel('Password').fill('salon1234')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Success leaves the login page; failure would come back to it with ?error.
    await expect(page).not.toHaveURL(/\/login\?error/)
  })

  test('the login form is fully keyboard operable', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').focus()
    await page.keyboard.type('owner@aurora.test')
    await page.keyboard.press('Tab')
    await page.keyboard.type('salon1234')

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('name'))
    expect(focused).toBe('password')
  })
})

test.describe('mock adapters', () => {
  // The claim that the whole platform runs with no credentials is worth
  // verifying in the running app rather than trusting.
  test('every port resolves to a working mock', async ({ request }) => {
    const response = await request.get('/api/dev/outbox')
    expect(response.ok()).toBe(true)

    const body = await response.json()
    const ports = body.adapters as { port: string; mode: string; name: string }[]

    expect(ports.map((p) => p.port).sort()).toEqual([
      'ai',
      'calendar',
      'email',
      'esign',
      'payments',
      'sms',
      'storage',
    ])
    for (const port of ports) {
      expect(port.mode, `${port.port} is not in mock mode`).toBe('mock')
      // esign resolves to `esign:local`, which is the credential-free
      // implementation AND the sensible production default — see src/ports/esign.ts.
      expect(port.name).toMatch(/mock|local/)
    }
  })
})

test.describe('background jobs', () => {
  test('the cron endpoint refuses an unauthenticated caller', async ({ request }) => {
    const response = await request.post('/api/cron/hold.expire')
    expect(response.status()).toBe(401)
  })

  test('the cron endpoint rejects an unknown job rather than silently accepting', async ({
    request,
  }) => {
    // Must match playwright.config.ts webServer.env.CRON_SECRET (production-strong).
    const secret = 'e2e-only-cron-secret-32chars-min!!'
    const response = await request.post(`/api/cron/not.a.real.job?secret=${secret}`)
    expect(response.status()).toBe(404)
  })

  test('a valid request enqueues a sweep', async ({ request }) => {
    const secret = 'e2e-only-cron-secret-32chars-min!!'
    const response = await request.post(`/api/cron/hold.expire?secret=${secret}`)
    expect(response.ok()).toBe(true)

    const body = await response.json()
    expect(body.stats).toHaveProperty('pending')
  })
})
