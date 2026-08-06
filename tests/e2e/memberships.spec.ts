import { expect, test, type Page } from '@playwright/test'

/**
 * Memberships, from the owner setting one up to the desk selling it.
 *
 * The check that matters is not that a plan can be created. It is that the desk
 * refuses to sell one to somebody with no card — a membership with no way to
 * take the second payment fails next month and takes the client's goodwill with
 * it, and refusing at the counter is where somebody can still hand a card over.
 */

const SALON = 'aurora'
const OWNER = { email: 'owner@aurora.test', password: 'salon1234' }

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('memberships', () => {
  test('an owner can see what the salon offers', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/memberships`)

    await expect(page.getByRole('cell', { name: 'The Cut Club' })).toBeVisible()
    // The benefits are listed, because a plan whose contents are a paragraph is
    // a plan the till cannot apply.
    await expect(page.getByText(/A cut a month/).first()).toBeVisible()
  })

  test('an owner can add one, and it appears on offer', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/memberships`)

    await page.getByRole('button', { name: /add a membership/i }).click()
    await page.getByLabel(/what it is called/i).fill('The Blow-dry Club')
    await page.getByLabel('Price', { exact: true }).fill('35')
    await page.getByLabel('Benefit 1').fill('A blow-dry whenever you like')
    await page.getByRole('button', { name: /create it/i }).click()

    await expect(page.getByRole('cell', { name: 'The Blow-dry Club' })).toBeVisible()
  })

  test('the desk will not sell one to somebody with no card', async ({ page }) => {
    /*
     * The whole reason to refuse here rather than at the first renewal: the
     * client is standing at the counter and can hand over a card. Next month
     * they are not, and the membership just fails.
     */
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/desk/clients?q=Ada`)

    const open = page.getByRole('link', { name: 'Open' }).first()
    await open.click()
    await expect(page).toHaveURL(/\/desk\/clients\/[a-z0-9]{20,}/)

    await expect(page.getByText(/They need a card on file first/)).toBeVisible()
    await page.getByRole('button', { name: /start it/i }).click()
    await expect(page.getByText(/card on file/i).first()).toBeVisible()
  })
})
