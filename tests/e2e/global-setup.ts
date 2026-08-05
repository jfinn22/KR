import { execFileSync } from 'node:child_process'

/**
 * Put the demo salon back the way the tests expect to find it.
 *
 * The suite asserts against a seeded live day — one appointment past its start
 * with nobody having acted, one in the chair, one mid-development — and the
 * tests then check people in, mark no-shows and book into the gaps. Those are
 * writes. Run the suite twice and the second run is reading the wreckage of
 * the first, so a test fails on stale state rather than on code, which is the
 * worst kind of red: it points at the wrong file.
 *
 * Reseeding here rather than per-test on purpose. Seventy-six tests sharing one
 * salon is what makes the suite fast and what makes the seeded day worth
 * having; tearing it down between tests would cost more than it buys and would
 * make each test set up a world instead of using a real one.
 *
 * Skippable with E2E_SKIP_SEED=1 for the case where somebody is iterating on
 * one test and does not want to pay for a reseed each run.
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_SEED === '1') return

  execFileSync('pnpm', ['seed'], {
    // Inherited so a seed failure is readable in the test output rather than
    // arriving as an exit code with no explanation.
    stdio: 'inherit',
    env: process.env,
  })
}
