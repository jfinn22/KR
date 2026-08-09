import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  /*
   * Reseed before the suite. The tests write to the seeded salon — they check
   * people in, mark no-shows and book into gaps — so a second run without this
   * reads the wreckage of the first and fails on stale state rather than on
   * code, which points at the wrong file.
   */
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Some sandboxes and CI images ship a pre-installed Chromium whose
        // build number does not match what this Playwright version expects.
        // Honour PLAYWRIGHT_CHROMIUM_PATH when it is set rather than failing
        // with "Executable doesn't exist".
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    // E2E runs against a production build with mock adapters — no keys needed.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      ADAPTER_MODE: 'mock',
      NODE_ENV: 'production',
      // Production gates refuse mock adapters and weak secrets; e2e opts in.
      E2E_ALLOW_MOCK: '1',
      AUTH_SECRET: 'e2e-only-auth-secret-32chars-min!!',
      CRON_SECRET: 'e2e-only-cron-secret-32chars-min!!',
    },
  },
})
