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

/**
 * Set the tenant GUC that the row-level-security policies read.
 *
 * Transaction-local (`set_config(..., true)`), so it is safe under PgBouncer
 * transaction pooling and cannot leak into the next request on a pooled
 * connection.
 *
 * NOTE: Postgres superusers bypass RLS. In development and CI the app connects
 * as `postgres`, so the policies installed by the migration are inert and
 * isolation rests on the Prisma extension plus the repository layer — both of
 * which are covered by tests. To make RLS genuinely enforcing, run the app as
 * the non-superuser role created by `scripts/sql/app-role.sql`. See
 * docs/ARCHITECTURE.md.
 */
export async function setTenantGuc(
  tx: Pick<PrismaClient, '$executeRawUnsafe'>,
  salonId: string,
): Promise<void> {
  await tx.$executeRawUnsafe(`SELECT set_config('app.salon_id', $1, true)`, salonId)
}
