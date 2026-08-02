import { redirect } from 'next/navigation'
import { pageContext } from '@/server/auth/page'
import { loadConsultation } from '@/server/services/consultation'
import { consultationContext } from '@/server/services/client-portal'
import { GuidedFlow, type FlowQuestion } from './guided-flow'

export const dynamic = 'force-dynamic'

/**
 * The guided consultation.
 *
 * The single biggest cause of abandonment in this product, so the server does
 * as little as possible and hands the client component a complete snapshot:
 * steps, existing answers, progress and which photos are needed. From there it
 * is one section per screen with no round trip between questions.
 */
export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ salon: string; id: string }>
}) {
  const { salon, id } = await params
  const ctx = await pageContext(salon)

  const [view, context] = await Promise.all([
    loadConsultation(ctx.salonId, id),
    consultationContext(ctx.salonId, id),
  ])

  // Already submitted — the review page is where the answer lives.
  if (view.status !== 'DRAFT' && view.status !== 'NEEDS_MORE_INFO') {
    redirect(`/s/${salon}/my/consult/${id}/review`)
  }

  return (
    <GuidedFlow
      salonSlug={salon}
      consultationId={id}
      questions={view.questions.map((question) => ({
        key: question.key,
        section: question.section,
        sortOrder: question.sortOrder,
        isRequired: question.isRequired,
        visibleWhenJson: question.visibleWhenJson,
        prompt: question.prompt,
        helpText: question.helpText,
        inputType: question.inputType as FlowQuestion['inputType'],
        optionsJson: question.optionsJson,
      }))}
      initialAnswers={view.answers}
      serviceNames={context.services.map((service) => service.name)}
      hasPhotoStep={view.requiredPhotoViews.length > 0}
    />
  )
}
