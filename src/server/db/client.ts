import { PrismaClient } from '@prisma/client'

/**
 * Base Prisma clients.
 *
 * `unsafeDb` is UNSCOPED. It sees every salon's rows and must never be used to
 * serve a request. ESLint restricts its import to src/server/repositories,
 * src/server/jobs, prisma/seed and scripts. Request handlers get a scoped
 * client from `dbFor(ctx)` in ./tenant-client.
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

