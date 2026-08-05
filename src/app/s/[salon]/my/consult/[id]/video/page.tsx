import { notFound } from 'next/navigation'
import { pageContext } from '@/server/auth/page'
import { consultationContext } from '@/server/services/client-portal'
import {
  consultationVideos,
  MAX_VIDEO_SECONDS,
  VIDEO_PROMPTS,
} from '@/server/services/consultation-video'
import { VideoStep } from './video-step'

export const dynamic = 'force-dynamic'

/**
 * A short clip of the hair moving.
 *
 * `ConsultationMode.VIDEO` has been one of four modes since the schema was
 * written, and `pickMode` has had a branch returning it — with nowhere for the
 * client to go once it did. This is that somewhere.
 *
 * Offered to everybody, not only when the engine asks. A video is useful for
 * any consultation and a step that appears once in fifty is a step nobody
 * discovers; when the engine DOES ask, the screen says so and the wording
 * changes from an invitation to a request.
 */
export default async function VideoPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContext(salon)

  const [{ consultation, evaluation }, videos] = await Promise.all([
    consultationContext(ctx.salonId, id),
    consultationVideos(ctx.salonId, id),
  ])
  if (!consultation) notFound()

  return (
    <VideoStep
      salonSlug={salon}
      consultationId={id}
      videos={videos}
      prompts={VIDEO_PROMPTS}
      asked={evaluation?.mode === 'VIDEO'}
      maxSeconds={MAX_VIDEO_SECONDS}
    />
  )
}
