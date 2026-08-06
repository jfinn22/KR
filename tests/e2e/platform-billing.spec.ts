import { expect, test, type Page } from '@playwright/test'

/**
 * What the salon pays this platform.
 *
 * Every salon in the database has been `TRIALING` forever, because nothing has
 * ever written the provider columns `Subscription` has carried since the first
 * migration. The check that matters here is the one an owner meets first: a
 * tier the salon has outgrown is shown with the numbers rather than hidden, so
 * they learn Starter allows one stylist before they pick it.
 */

const SALON = 'aurora'
const OWNER = { email: 'owner@aurora.test', password: 'salon1234' }
const STYLIST = { email: 'rowan@aurora.test', password: 'salon1234' }

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('the salon’s own plan', () => {
  test('an owner sees what they are on and what it allows', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/billing`)

    await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible()
    // The limits, not just the price — an owner's real question is whether the
    // tier still fits the business they have now.
    await expect(page.getByText(/allowed/).first()).toBeVisible()
    await expect(page.getByText(/Nothing has been charged yet/)).toBeVisible()
  })

  test('a tier the salon has outgrown says so, with the numbers', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/billing`)

    // Aurora seeds five stylists across two locations, so both cheaper tiers
    // are out of reach — and each says by how much rather than just refusing.
    await expect(page.getByText(/You are over this one by 4 stylists and 1 location\./)).toBeVisible()
    await expect(page.getByText(/You are over this one by 1 location\./)).toBeVisible()
  })

  test('a trial can be turned into a subscription, and then reads as live', async ({ page }) => {
    await signIn(page, OWNER)
    await page.goto(`/s/${SALON}/admin/billing`)

    await page.getByRole('button', { name: /start paying/i }).click()
    await expect(page.getByText(/first payment goes out/i)).toBeVisible()

    await page.reload()
    // "Move tier" replaces "Start paying" once the provider actually has one.
    await expect(page.getByRole('heading', { name: 'Move tier' })).toBeVisible()
  })

  test('a stylist cannot reach it at all', async ({ page }) => {
    // `billing.manage` is owner-only. A stylist who can be trusted with a
    // client's colour history is not the person who commits the business to a
    // monthly bill.
    await signIn(page, STYLIST)
    const response = await page.goto(`/s/${SALON}/admin/billing`)
    expect(response?.status()).toBe(404)
  })
})
