import { feedFor } from '@/server/services/integrations'

/**
 * A stylist's subscribable calendar.
 *
 * No account, no OAuth, no sync loop — a URL pasted into a phone. It covers
 * most of what people actually mean by "calendar integration" and cannot
 * corrupt the salon's data, because it is read-only by construction.
 *
 * The token is a bearer credential in a URL, which is unavoidable for a
 * subscribable feed, so it is scoped to one stylist, stored only as a hash,
 * and revocable in one click.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params
  const stylistProfileId = file.replace(/\.ics$/i, '')
  const token = new URL(request.url).searchParams.get('token')

  if (!token) return notFound()

  const feed = await feedFor(stylistProfileId, token)
  // Deliberately identical to a bad token: a different response would confirm
  // which stylist ids exist.
  if (!feed) return notFound()

  return new Response(feed.ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${stylistProfileId}.ics"`,
      // Calendar clients poll hard. Fifteen minutes is fresh enough for a
      // salon diary and stops a phone hammering the endpoint all day.
      'Cache-Control': 'private, max-age=900',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}
