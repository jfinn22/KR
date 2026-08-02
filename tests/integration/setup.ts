import { execFileSync } from 'node:child_process'
import { beforeAll } from 'vitest'

/**
 * Integration test bootstrap.
 *
 * Redirects DATABASE_URL to the test database BEFORE any module constructs a
 * PrismaClient — setupFiles run ahead of test file imports, which is what makes
 * this safe — then applies migrations once per run.
 */

const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/salon_test?schema=public'

process.env.DATABASE_URL = TEST_URL
process.env.ADAPTER_MODE = 'mock'
process.env.AUTH_SECRET ??= 'test-only-secret-not-used-anywhere-real'

let migrated = false

beforeAll(() => {
  if (migrated) return
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'pipe',
  })
  migrated = true
}, 120_000)
