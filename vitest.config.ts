import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Root config: path aliases and coverage policy. The two test projects live in
 * `vitest.workspace.ts`.
 *
 * Aliases are declared explicitly rather than via vite-tsconfig-paths, which is
 * ESM-only and cannot be loaded by Vitest 2's CJS config loader.
 */
export const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  '~/tests': fileURLToPath(new URL('./tests', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      thresholds: {
        // The rules engine and the availability solver are the parts that must
        // be provably correct, so the bar is high and scoped to exactly them.
        'src/domain/consultation/**': { branches: 85, functions: 90, lines: 90, statements: 90 },
        'src/domain/scheduling/**': { branches: 85, functions: 90, lines: 90, statements: 90 },
      },
    },
  },
})
