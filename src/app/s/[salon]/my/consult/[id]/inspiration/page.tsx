import { pageContext } from '@/server/auth/page'
import { inspirationPhotos } from '@/server/services/photos'
import { InspirationBoard } from './inspiration-board'

export const dynamic = 'force-dynamic'

/**
 * Inspiration photos and what the client actually likes about them.
 *
 * The tagging is the point. A saved picture with no attributes tells the
 * stylist a client likes *something* in a photograph that contains a face, a
 * cut, a tone, a level and a light source — five things, of which four are
 * probably not what they meant.
 */
export default async function InspirationPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContext(salon)
  const photos = await inspirationPhotos(ctx.salonId, id)

  return <InspirationBoard salonSlug={salon} consultationId={id} initialPhotos={photos} />
}
