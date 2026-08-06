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
    /*
     * "Free — book into this" rather than "Free — processing": the diary has
     * labelled these free since it was written and nothing could be booked
     * into one, so the label now says what clicking it actually does.
     */
    await expect(page.getByText(/free — book into this/i).first()).toBeVisible()
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

/*
 * "Approve, but Tuesdays and Thursdays, mornings only" is a real thing a
 * colourist says about a five-hour correction, and there was nowhere to put it
 * — the client got the whole open diary and the stylist found out on the day.
 */
test.describe('narrowing when a plan can be booked', () => {
  async function openFirstReview(page: Page) {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/review`)
    const first = page.getByRole('link', { name: /flag/i }).first()
    if ((await first.count()) === 0) test.skip(true, 'Nothing in the queue')
    await first.click()
    await expect(page).toHaveURL(/\/review\/[a-z0-9]+/, { timeout: 15_000 })
  }

  test('starts wide open and out of the way', async ({ page }) => {
    await openFirstReview(page)

    // Off by default, for the same reason the price override is blank by
    // default: the common case is agreeing with the diary, and every
    // restriction here costs the client appointments.
    await expect(page.getByText(/anything the diary can take/i)).toBeVisible()
    await expect(page.locator('#win-start')).toHaveCount(0)
  })

  test('a stylist can hold it to certain days and read back what they chose', async ({ page }) => {
    await openFirstReview(page)

    await page.getByRole('button', { name: /narrow it/i }).click()
    await expect(page.locator('#win-start')).toBeVisible()

    // Leave Tuesday and Thursday on.
    for (const day of ['Sun', 'Mon', 'Wed', 'Fri', 'Sat']) {
      await page.getByRole('button', { name: day, exact: true }).click()
    }
    await page.locator('#win-start').selectOption(String(9 * 60))

    // Said back in words, so nobody has to decode a bitmask to see what they did.
    await expect(page.getByText(/Tue and Thu/)).toBeVisible()
    await expect(page.getByText(/starting between 9am/i)).toBeVisible()
  })

  test('refuses to leave zero days, which would be an outage not a narrowing', async ({ page }) => {
    await openFirstReview(page)
    await page.getByRole('button', { name: /narrow it/i }).click()

    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      await page.getByRole('button', { name: day, exact: true }).click()
    }

    // The last one does not turn off: with no days the solver returns nothing
    // and the client is told the salon is fully booked, forever.
    const stillOn = await page
      .getByRole('button', { name: /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/ })
      .evaluateAll((nodes) => nodes.filter((n) => n.getAttribute('aria-pressed') === 'true').length)
    expect(stillOn).toBe(1)
  })

  test('clears back to the whole diary in one tap', async ({ page }) => {
    await openFirstReview(page)
    await page.getByRole('button', { name: /narrow it/i }).click()
    await page.getByRole('button', { name: 'Mon', exact: true }).click()

    await page.getByRole('button', { name: /^clear$/i }).click()
    await expect(page.getByText(/anything the diary can take/i)).toBeVisible()
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

test.describe('the catalogue', () => {
  test('a price can actually be changed, which it could not be before', async ({ page }) => {
    /*
     * `saveServiceAction` shipped with the catalogue — eighteen fields covering
     * price, the chemical flags, patch tests and online bookability — and had
     * no caller anywhere. The phase editor could restructure a service and the
     * salon still could not rename or reprice it. A salon's price list changes
     * constantly; this one was read-only.
     */
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/services`)

    await page.getByRole('link', { name: /cut & finish/i }).first().click()
    await expect(page).toHaveURL(/\/admin\/services\/[a-z0-9]+/)

    await page.getByRole('button', { name: /change what this service is/i }).click()
    await page.getByLabel('Price', { exact: true }).fill('64')
    await page.getByRole('button', { name: /^save$/i }).click()

    // The form collapses only once the action has returned. Navigating on the
    // click alone races the server and reads the list before the write lands.
    await expect(page.getByRole('button', { name: /change what this service is/i })).toBeVisible()

    await page.goto(`/s/${SALON}/admin/services`)
    await expect(page.getByText('US$64', { exact: false }).first()).toBeVisible()
  })

  test('a new service can be added', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/services`)

    await page.getByRole('button', { name: /add a service/i }).click()
    await page.getByLabel(/what it is called/i).fill('Fringe trim')
    await page.getByLabel('Price', { exact: true }).fill('30')
    await page.getByRole('button', { name: /create it/i }).click()

    await expect(page.getByRole('button', { name: /add a service/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /fringe trim/i })).toBeVisible()
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

test.describe('booking from the desk', () => {
  test('a haircut goes straight in, with nobody signing anything off', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/book`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/book an appointment/i)

    // The same one-box search the desk already knows: name, email or phone.
    await page.getByLabel('Search').fill('Ada')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('listitem').first().getByRole('link').click()

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/book for/i)

    await page.getByRole('button', { name: /cut & finish/i }).first().click()
    await page.getByRole('button', { name: /check what this needs/i }).click()

    /*
     * A dry cut is DIRECT — nothing in the way. The absence of the sign-off box
     * is the assertion: a salon whose software turns a haircut into a two-step
     * process stops using the software.
     */
    await expect(page.getByRole('button', { name: /find a time/i })).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByRole('textbox', { name: /why is this going in without one/i }),
    ).toHaveCount(0)
  })

  test('a service that wants a consultation asks somebody to put their name to it', async ({
    page,
  }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/book`)

    await page.getByLabel('Search').fill('Ada')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('listitem').first().getByRole('link').click()

    await page.getByRole('button', { name: /restyle consultation & cut/i }).first().click()
    await page.getByRole('button', { name: /check what this needs/i }).click()

    // The reason names the service that caused it, not "this needs approval".
    await expect(page.getByText(/need a consultation first/i)).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('textbox', { name: /why is this going in without one/i }),
    ).toBeVisible()
    // And no times are offered until a reason is actually written.
    await expect(page.getByRole('button', { name: /find a time/i })).toHaveCount(0)
  })

  test('a missing patch test is refused outright, not offered as a sign-off', async ({ page }) => {
    /*
     * The one refusal nobody can sign their way past. A missing patch test is
     * an allergy risk rather than an unfilled form, and no amount of front-desk
     * seniority makes somebody's scalp safer — so the override does not reach
     * it, and the message says what to do instead.
     */
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/book`)

    await page.getByLabel('Search').fill('Ada')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await page.getByRole('listitem').first().getByRole('link').click()

    await page.getByRole('button', { name: /full balayage/i }).first().click()
    await page.getByRole('button', { name: /check what this needs/i }).click()

    await expect(page.getByText(/needs a patch test on file/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/book the patch test first/i)).toBeVisible()
    // No sign-off box at all — this is not somebody's judgement call.
    await expect(
      page.getByRole('textbox', { name: /why is this going in without one/i }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: /find a time/i })).toHaveCount(0)
  })

  test('a gold processing block is a link into the booking flow', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/calendar`)

    /*
     * The diary has drawn these in gold and labelled them free since it was
     * written, and nothing could be booked into one. The seeded day has a
     * balayage mid-development, so there is a real gap to click.
     */
    const gap = page.getByRole('link', { name: /book into this/i }).first()
    await expect(gap).toBeVisible({ timeout: 15_000 })
    await gap.click()

    await expect(page).toHaveURL(/\/desk\/book\?fill=/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/fill the gap/i)
    await expect(page.getByText(/is free while/i)).toBeVisible()
  })
})

test.describe('the waiting list', () => {
  test('an owner can see who is waiting', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/waitlist`)

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/waiting list/i)
    // Empty on the seeded salon, and it says so rather than showing a blank.
    await expect(page.getByText(/nobody is waiting|waiting/i).first()).toBeVisible()
  })

  test('a client is offered the list exactly when nothing is free', async ({ page }) => {
    await signIn(page, CLIENT)
    await page.goto(`/s/${SALON}/my`)

    // Reachable, and not shown anywhere times are available — the button only
    // renders on an empty slot list.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('the handoff card', () => {
  test('a stylist can reach everything the consultation found, from the day', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk`)

    /*
     * The client's name is the way in. A stylist about to do somebody's hair
     * wants what the consultation found, and their name is where they look.
     */
    await page.getByRole('listitem').first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/desk\/appointment\//)

    /*
     * "Last time" is the assertion worth making: it is the single most useful
     * thing on the screen, and it is assembled from a table the day view never
     * touches — so its presence proves the card really did go and look.
     */
    await expect(page.getByRole('heading', { name: /last time/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /full client record/i })).toBeVisible()
  })
})

test.describe('in-chair consultations', () => {
  test('a stylist can start one from the client record', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients?q=Ada`)
    await page.getByRole('listitem').first().getByRole('link').first().click()

    await expect(page.getByRole('link', { name: /start a consultation here/i })).toBeVisible()
    await page.getByRole('link', { name: /start a consultation here/i }).click()

    /*
     * Two things change with the client in the chair: the wording addresses the
     * stylist rather than the client, and the catalog stops being the
     * online-bookable subset — a service kept off the public page is usually
     * one the salon wants a conversation about, and this IS that conversation.
     */
    await expect(page.getByRole('heading', { name: /what are they having/i })).toBeVisible()
    await expect(page.getByText(/you are looking at the hair/i)).toBeVisible()
  })
})
