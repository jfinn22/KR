import { PrismaClient } from '@prisma/client'

/**
 * Base Prisma clients.
 *
 * `unsafeDb` is UNSCOPED. It sees every salon's rows. Request-path code must
 * use `dbFor(salonId)` from ./tenant-client instead.
 *
 * ESLint bans importing `unsafeDb` outside the allowlist in `.eslintrc.json`
 * (jobs, auth bootstrap, public-guard, audit/outbox sinks, and the few
 * services that still need a true cross-tenant or pre-tenant lookup).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function create(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [
            { level: 'warn', emit: 'stdout' },
            { level: 'error', emit: 'stdout' },
          ]
        : [{ level: 'error', emit: 'stdout' }],
  })
}

export const unsafeDb: PrismaClient = globalForPrisma.prisma ?? create()

// Next.js dev server hot-reloads modules; without this every reload leaks a
// connection pool until Postgres refuses new connections.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = unsafeDb

export type Db = PrismaClient
