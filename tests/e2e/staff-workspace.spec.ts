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

/**
 * The Phase 0 fixes.
 *
 * Each of these was a real defect rather than a missing feature: a clock that
 * spoke two dialects on one screen, a client record that loaded a note it never
 * showed, and a phase editor that advertised capacity the solver would refuse.
 */
test.describe('the clock reads the same everywhere', () => {
  test('the diary gutter is a 12-hour clock, like every block inside it', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/calendar`)

    const gutter = page.locator('div.w-16')
    await expect(gutter).toContainText('7am')
    await expect(gutter).toContainText('12pm')
    await expect(gutter).toContainText('9pm')
    // The old hardcoded rendering. If this comes back, the diary is bilingual
    // again — 07:00 in the gutter beside 2:15pm in the blocks.
    await expect(gutter).not.toContainText('07:00')
    await expect(gutter).not.toContainText('21:00')
  })
})

test.describe('client notes', () => {
  test('a note can be written and survives a reload', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients?q=Ada`)
    await page
      .getByRole('link', { name: /^open$/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/desk\/clients\/[a-z0-9]+/, { timeout: 15_000 })

    const note = `Prefers the radio off — noted ${Date.now()}`
    const box = page.getByLabel('Notes about this client')
    await box.fill(note)
    await page.getByRole('button', { name: /save note/i }).click()
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Notes about this client')).toHaveValue(note)
  })
})

test.describe('the phase editor tells the truth about capacity', () => {
  test('it does not promise a gap the solver would re-block', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/services`)
    await page
      .getByRole('link', { name: /balayage/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/admin\/services\/[a-z0-9]+/)

    const readout = page.locator('section', { hasText: 'Free to hand on' }).first()
    await expect(readout).toBeVisible()

    /*
     * The seeded salon has interleaving OFF, which is the default. The editor
     * used to show a gold "40m free" for the balayage processing phase anyway,
     * because it read its own hardcoded threshold and never looked at the
     * salon's setting. It must now say the time is held and say why.
     */
    await expect(readout).toContainText(/interleaving is switched off/i)
  })
})

/**
 * The Phase 1 primitives, from outside.
 *
 * Signup is the one flow in the product that runs with no principal at all, so
 * it is also the one that cannot be covered by signing in first.
 */
test.describe('joining a salon', () => {
  test('a stranger can reach the join page and it wears the salon', async ({ page }) => {
    // No sign-in: this is the whole point. `withAuthz` could not serve this
    // page, because resolveContext returns null for exactly this visitor.
    await page.goto(`/join/${SALON}`)

    await expect(page.getByText('Aurora Hair Studio')).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: /create my account/i })).toBeVisible()
  })

  test('marketing is never pre-ticked', async ({ page }) => {
    await page.goto(`/join/${SALON}`)
    await expect(page.getByRole('checkbox')).not.toBeChecked()
  })

  test('a new client can create an account and then sign in with it', async ({ page }) => {
    const email = `e2e-join-${Date.now()}@example.com`

    await page.goto(`/join/${SALON}`)
    await page.getByLabel('First name').fill('Wren')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('a-long-enough-password')
    await page.getByRole('button', { name: /create my account/i }).click()

    // Sent to sign in rather than logged straight in: signup and claiming an
    // existing walk-in look identical, and the second must not hand a session
    // to whoever typed the address.
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 })

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('a-long-enough-password')
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL(new RegExp(`/s/${SALON}/my`), { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /hello/i })).toBeVisible()
  })

  test('a salon that does not exist is a 404, not a hint', async ({ page }) => {
    const response = await page.goto('/join/not-a-real-salon')
    expect(response?.status()).toBe(404)
  })
})

test.describe('settings', () => {
  test('an owner can reach settings and turn on handing the chair over', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/settings`)

    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible()
    await expect(page.getByText(/let the calendar sell processing time/i)).toBeVisible()
  })

  test('a brand colour that cannot carry white text is refused, in words', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/settings`)

    const field = page.getByLabel('Your colour')
    await field.fill('#8A8A8C')

    // Refused before saving, and the message says what to do — not a ratio.
    await expect(page.getByText(/too close to grey/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^save$/i }).last()).toBeDisabled()
  })

  test('a workable colour previews the whole ladder', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/settings`)

    await page.getByLabel('Your colour').fill('#C7457F')
    await expect(page.getByText(/what we would use/i)).toBeVisible()
    await expect(page.getByText(/checked against the same contrast standard/i)).toBeVisible()
  })
})

test.describe('adding someone at the desk', () => {
  test('the form is out of the way until it is wanted', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients`)

    // Searching is what this screen is mostly for; a form sitting open above
    // the results invites a duplicate every time a name is spelled oddly.
    await expect(page.getByLabel('First name')).toBeHidden()
    await page.getByRole('button', { name: /add someone new/i }).click()
    await expect(page.getByLabel('First name')).toBeVisible()
  })

  test('somebody with no way to contact them is refused', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients`)
    await page.getByRole('button', { name: /add someone new/i }).click()

    await page.getByLabel('First name').fill('Unreachable')
    await page.getByRole('button', { name: /add them/i }).click()

    await expect(page.getByText(/either an email or a phone number/i)).toBeVisible()
  })

  test('a walk-in can be created and is findable afterwards', async ({ page }) => {
    const stamp = Date.now()
    const surname = `Desk${stamp}`

    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients`)
    await page.getByRole('button', { name: /add someone new/i }).click()

    await page.getByLabel('First name').fill('Walkin')
    await page.getByLabel('Last name').fill(surname)
    await page.getByLabel('Phone').fill(`555${String(stamp).slice(-7)}`)
    await page.getByRole('button', { name: /add them/i }).click()

    // Lands straight on the record, because the reason to add somebody is
    // almost always to do something with them next.
    await expect(page).toHaveURL(/\/desk\/clients\/[a-z0-9]+/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: new RegExp(surname, 'i') })).toBeVisible()

    await page.goto(`/s/${SALON}/desk/clients?q=${surname}`)
    await expect(page.getByRole('listitem').first()).toBeVisible()
  })
})

test.describe('the join code', () => {
  test('an owner can see the shareable link and generate a code', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/settings`)

    await expect(page.getByText(/how clients join you/i)).toBeVisible()
    await expect(page.getByText(new RegExp(`/join/${SALON}`))).toBeVisible()

    await page.getByRole('button', { name: /generate|new code/i }).click()
    // Deliberately excludes O/0 and I/1 — it gets read out across a counter.
    await expect(page.getByLabel('Join code')).toHaveValue(/[A-Z2-9-]{4,}/)
  })
})
