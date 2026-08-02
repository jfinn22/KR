import { pageContext } from '@/server/auth/page'
import { loadConsultation } from '@/server/services/consultation'
import { consultationPhotos } from '@/server/services/photos'
import { PhotoStep } from './photo-step'

export const dynamic = 'force-dynamic'

/**
 * Guided photo capture.
 *
 * Placed after the questions rather than before, because a client who has just
 * been asked about box dye and their target level understands why the photos
 * matter. Asking for seven pictures cold is where people put the phone down.
 */
export default async function PhotosPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContext(salon)

  const [view, photos] = await Promise.all([
    loadConsultation(ctx.salonId, id),
    consultationPhotos(ctx.salonId, id),
  ])

  return (
    <PhotoStep
      salonSlug={salon}
      consultationId={id}
      requiredViews={view.requiredPhotoViews}
      suggestedViews={view.suggestedPhotoViews}
      initialPhotos={photos}
    />
  )
}
