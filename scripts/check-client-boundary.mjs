#!/usr/bin/env node
/**
 * A server component cannot call a plain function exported from a `'use client'`
 * module.
 *
 * The import resolves to a client reference — an opaque object — and calling it
 * throws at render time, producing a bare "Application error: a server-side
 * exception has occurred" with a digest and no stack. It typechecks, it lints,
 * it builds, and it fails only when somebody loads the page. That combination
 * cost real debugging time here, so it is now a check.
 *
 * Rule: a server module (no `'use client'`) may import from a client module
 * only for JSX components. Anything else — a formatter, a pure helper — belongs
 * in a shared module that neither side marks.
 */
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const ROOT = resolve(process.cwd(), 'src')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const isClient = new Map()

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  isClient.set(file, /^\s*(['"])use client\1/m.test(source.slice(0, 400)))
}

/** Resolve an `@/…` import to a file on disk. */
function resolveImport(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (isClient.has(candidate)) return candidate
  }
  return null
}

/** A JSX component by convention: PascalCase. Anything else is a helper. */
const isComponentName = (name) => /^[A-Z]/.test(name)

const problems = []

for (const file of files) {
  if (isClient.get(file)) continue // client importing client is fine

  const source = readFileSync(file, 'utf8')
  const importRe = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g

  let match
  while ((match = importRe.exec(source)) !== null) {
    const [, typeOnly, names, spec] = match
    if (typeOnly) continue

    const target = resolveImport(spec, file)
    if (!target || !isClient.get(target)) continue

    for (const raw of names.split(',')) {
      const name = raw.trim()
      if (!name || name.startsWith('type ')) continue

      const local = name.split(/\s+as\s+/)[0].trim()
      if (isComponentName(local)) continue

      problems.push(
        `${file.replace(`${process.cwd()}/`, '')}: imports \`${local}\` from the client module ` +
          `'${spec}'. A server module cannot call it — move it to a shared module.`,
      )
    }
  }
}

if (problems.length > 0) {
  console.error('\n✖ Client/server boundary violations:\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    '\n  Pure helpers shared by both sides belong in src/lib/** or src/domain/**,\n' +
      "  in a module that does NOT declare 'use client'.\n",
  )
  process.exit(1)
}

console.log('✓ No server module calls a client-module helper')
