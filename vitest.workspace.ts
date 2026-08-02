import { defineWorkspace } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '~/tests': fileURLToPath(new URL('./tests', import.meta.url)),
}

/**
 * Two projects, deliberately separated:
 *
 *  - `unit`        — src/domain, ports and design tokens. It has NO setup file,
 *                    so a domain test physically cannot reach a database. That
 *                    is the enforcement mechanism, not a convention.
 *  - `integration` — repositories, services, tenant isolation and the booking
 *                    race, against a real Postgres.
 */
export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'unit',
      environment: 'node',
      globals: true,
      include: ['tests/unit/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'integration',
      environment: 'node',
      globals: true,
      include: ['tests/integration/**/*.test.ts'],
      setupFiles: ['tests/integration/setup.ts'],
      // One database, so files run strictly sequentially in a single fork.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      sequence: { concurrent: false },
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  },
])
