import { expect, test, type Page } from '@playwright/test'

/**
 * A salon's history, brought across and taken back out again.
 *
 * The check that matters is not that a good file imports. It is that an owner
 * can see what the file will do before it does it, and can reverse it
 * afterwards — because the first CSV is always wrong, and an owner who cannot
 * undo will never press the button at all.
 */

const SALON = 'aurora'
const OWNER = { email: 'owner@aurora.test', password: 'salon1234' }

/*
 * Deliberately awkward, in the ways real exports are awkward: a comma inside a
 * quoted name, a surname-first name, one stylist the salon has and one it does
 * not, a service name that matches by spelling and one that does not, and a
 * phone number written the way a British front desk writes it.
 */
const FILE = [
  'Client,Mobile,Email,Date,Time,Service,Team member,Price,Status,Loyalty Points',
  '"Sandoval, Marisol",(212) 555-0132,marisol.sandoval@example.test,03/04/2024,14:30,Full balayage,Rowan Ellis,$285.00,Completed,140',
  '"Sandoval, Marisol",(212) 555-0132,marisol.sandoval@example.test,13/04/2024,09:00,Olaplex top-up,Rowan Ellis,$45.00,Completed,20',
  'Theo Brannigan,(212) 555-0177,theo.brannigan@example.test,14/04/2024,11:00,Full balayage,Persephone Vance,$285.00,Cancelled,0',
].join('\n')

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Upload the file and land on its review screen. */
async function upload(page: Page, contents: string, filename = 'aurora-history.csv') {
  await page.goto(`/s/${SALON}/admin/imports`)
  await page.getByLabel(/where is it coming from/i).selectOption('FRESHA')
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: 'text/csv',
    buffer: Buffer.from(contents, 'utf8'),
  })
  await page.getByRole('button', { name: /read this file/i }).click()
  await expect(page).toHaveURL(/\/admin\/imports\/[a-z0-9]{20,}$/)
}

test.describe('bringing a salon across', () => {
  test('shows what it made of the file before anything is saved', async ({ page }) => {
    await signIn(page, OWNER)
    await upload(page, FILE)

    // Three rows, and the two people on them.
    await expect(page.getByText('Rows').first()).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Marisol Sandoval' }).first()).toBeVisible()

    /*
     * 13/04 has no thirteenth month, so the file proves itself day-first and
     * the third of April stays the third of April.
     */
    await expect(page.getByRole('cell', { name: '2024-04-03' })).toBeVisible()

    /*
     * A national number, rendered as something the SMS port would accept. The
     * dialling code is guessed from the salon's own timezone rather than left
     * blank — an owner whose every phone number reads "could not read" on first
     * sight concludes the platform is broken, not that it has one question.
     */
    await expect(page.getByRole('cell', { name: '+12125550132' }).first()).toBeVisible()

    // A column nobody recognised is named rather than silently dropped.
    await expect(page.getByText(/Loyalty Points → not imported/)).toBeVisible()
  })

  test('asks one question per name, not one per row', async ({ page }) => {
    await signIn(page, OWNER)
    await upload(page, FILE)

    // "Full balayage" is on two rows and asked about once.
    const balayage = page.getByLabel('What Full balayage maps to')
    await expect(balayage).toHaveCount(1)
    await expect(page.getByText('Full balayage').first()).toBeVisible()

    // A name that matches ours outright is already chosen.
    await expect(balayage).not.toHaveValue('')

    // One the salon does not have is left to the owner.
    await expect(page.getByLabel('What Olaplex top-up maps to')).toHaveValue('')
  })

  test('will not attribute an appointment to a stylist it cannot name', async ({ page }) => {
    await signIn(page, OWNER)
    await upload(page, FILE)

    // Rowan is ours; Persephone is not, and the row that names her is called out
    // before the owner presses anything.
    await expect(page.getByLabel('What Rowan Ellis maps to')).not.toHaveValue('')
    await expect(page.getByLabel('What Persephone Vance maps to')).toHaveValue('')
    await expect(page.getByText(/1 appointment will not be imported/)).toBeVisible()
  })

  test('imports, then undoes cleanly', async ({ page }) => {
    await signIn(page, OWNER)
    await upload(page, FILE)

    await page.getByRole('button', { name: /import this file/i }).click()

    // What it did, in its own words.
    await expect(page.getByText('Clients created')).toBeVisible()
    await expect(page.getByRole('heading', { name: /what it did/i })).toBeVisible()

    // The people are really there.
    const importUrl = page.url()
    await page.goto(`/s/${SALON}/desk/clients?q=Sandoval`)
    await expect(page.getByText('Marisol Sandoval', { exact: true })).toBeVisible()

    await page.goto(importUrl)
    await page.getByRole('button', { name: /undo this import/i }).click()
    await expect(page.getByText(/has been undone/i)).toBeVisible()

    // And really gone. Matched on the exact name rather than the page text,
    // because the empty state echoes the search term back at you.
    await page.goto(`/s/${SALON}/desk/clients?q=Sandoval`)
    await expect(page.getByText('Marisol Sandoval', { exact: true })).toHaveCount(0)
  })

  test('refuses a file whose dates could be either way round', async ({ page }) => {
    /*
     * Every date here is a coin flip. Getting it wrong moves a salon's whole
     * history by up to eleven months, which is the one thing this screen must
     * ask about rather than decide.
     */
    await signIn(page, OWNER)
    await upload(
      page,
      [
        'Client,Mobile,Date,Service,Team member',
        'Marisol Sandoval,+12125550132,03/04/2024,Full balayage,Rowan Ellis',
        'Theo Brannigan,+12125550177,05/06/2024,Full balayage,Rowan Ellis',
      ].join('\n'),
      'ambiguous.csv',
    )

    await expect(page.getByText(/day-first or month-first/)).toBeVisible()
  })
})
