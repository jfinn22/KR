import { chromium, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

/**
 * Capture the platform's real screens against the seeded demo salon.
 *
 * Not a test — a way to look at the product without running it. Everything
 * here drives the same production build the e2e suite does, so what is
 * captured is what a salon would actually see.
 */

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3100'
const OUT = process.env.SHOT_OUT ?? 'screenshots'
const SALON = 'aurora'

async function signIn(page: Page, email: string) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('salon1234')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 })
}

async function shot(page: Page, name: string, path: string, fullPage = true) {
  // networkidle never settles here, so wait on the DOM plus a beat for fonts.
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('load').catch(() => undefined)
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage })
  console.log(`  ${name}.png`)
}

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
  })

  // --- Marketing and the design system, signed out ---------------------------
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const anonPage = await anon.newPage()
  console.log('\n▸ Signed out')
  await shot(anonPage, '01-landing', '/')
  await shot(anonPage, '02-design-system', '/design-system')
  await anon.close()

  // --- The client journey -----------------------------------------------------
  const clientCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const client = await clientCtx.newPage()
  console.log('\n▸ Client')
  await signIn(client, 'client@aurora.test')

  await shot(client, '03-client-home', `/s/${SALON}/my`)
  await shot(client, '04-service-picker', `/s/${SALON}/my/consult/new`)

  // Start a real consultation so the guided flow has something to show.
  await client
    .getByRole('button', { name: /full balayage/i })
    .first()
    .click()
  await client.getByRole('button', { name: /^continue$/i }).click()
  await client.waitForURL(/\/my\/consult\/[a-z0-9]{20,}$/, { timeout: 20_000 })
  await client.waitForTimeout(800)
  await client.screenshot({ path: `${OUT}/05-guided-consultation.png`, fullPage: true })
  console.log('  05-guided-consultation.png')

  // The shade chart, which is the flow's most distinctive control. It lives on
  // the goal section, so open the colour family that shows it off.
  const consultUrl = client.url()
  const consultPath = new URL(consultUrl).pathname

  const familySelect = client.locator('select[id$="-family"]').first()
  if ((await familySelect.count()) > 0) {
    await familySelect.selectOption('BLONDE')
    await client.waitForTimeout(400)
    await client.screenshot({ path: `${OUT}/06-shade-chart.png`, fullPage: true })
    console.log('  06-shade-chart.png')
  }

  await shot(client, '07-my-appointments', `/s/${SALON}/my/appointments`)
  await shot(client, '08-hair-timeline', `/s/${SALON}/my/timeline`)

  // The two photo steps: the hair they have, then the look they want.
  await shot(client, '09-photo-capture', `${consultPath}/photos`)
  await shot(client, '10-reference-pictures', `${consultPath}/inspiration`)

  await clientCtx.close()

  // --- The salon --------------------------------------------------------------
  const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const staff = await staffCtx.newPage()
  console.log('\n▸ Salon')
  await signIn(staff, 'owner@aurora.test')

  await shot(staff, '11-front-desk', `/s/${SALON}/desk`)
  await shot(staff, '12-diary', `/s/${SALON}/desk/calendar`, false)
  await shot(staff, '13-review-queue', `/s/${SALON}/review`)

  // Open the first consultation in the queue.
  await staff.goto(`${BASE}/s/${SALON}/review`, { waitUntil: 'domcontentloaded' })
  const first = staff.getByRole('link', { name: /flag/i }).first()
  if ((await first.count()) > 0) {
    await first.click()
    await staff.waitForURL(/\/review\/[a-z0-9]+/, { timeout: 20_000 })
    await staff.waitForTimeout(800)
    await staff.screenshot({ path: `${OUT}/14-review-detail.png`, fullPage: true })
    console.log('  14-review-detail.png')
  }

  await shot(staff, '15-services', `/s/${SALON}/admin/services`)

  // The phase editor — open the balayage chain.
  await staff.goto(`${BASE}/s/${SALON}/admin/services`, { waitUntil: 'domcontentloaded' })
  await staff
    .getByRole('link', { name: /balayage/i })
    .first()
    .click()
  await staff.waitForURL(/\/admin\/services\/[a-z0-9]+/, { timeout: 20_000 })
  await staff.waitForTimeout(800)
  await staff.screenshot({ path: `${OUT}/16-phase-editor.png`, fullPage: true })
  console.log('  16-phase-editor.png')

  await shot(staff, '17-insights', `/s/${SALON}/insights?days=90`)
  await shot(staff, '18-integrations', `/s/${SALON}/admin/integrations`)
  await shot(staff, '19-client-record', `/s/${SALON}/desk/clients?q=Ada`)

  // --- Mobile, since the client flow is answered one-handed --------------------
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  const phone = await phoneCtx.newPage()
  console.log('\n▸ Phone')
  await signIn(phone, 'client@aurora.test')
  await shot(phone, '20-phone-home', `/s/${SALON}/my`)
  await shot(phone, '21-phone-consult', consultPath)
  await phoneCtx.close()

  await staffCtx.close()
  await browser.close()
  console.log(`\n▸ Written to ${OUT}/`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
