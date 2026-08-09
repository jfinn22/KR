import { dbFor } from '@/server/db/tenant-client'

/**
 * The team.
 *
 * A small read service rather than an inline query, because route handlers and
 * server components are barred from importing the database client directly —
 * the boundary that keeps queries out of the request layer.
 */

export async function listStylists(salonId: string, opts: { activeOnly?: boolean } = {}) {
  const db = dbFor(salonId)
  return db.stylistProfile.findMany({
    where: { salonId, ...(opts.activeOnly === false ? {} : { isActive: true }) },
    orderBy: { displayName: 'asc' },
    select: {
      id: true,
      displayName: true,
      title: true,
      acceptsNewClients: true,
      colorHex: true,
    },
  })
}
