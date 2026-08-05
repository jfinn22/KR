'use server'

import { z } from 'zod'
import { withPublicAction } from './public-guard'
import { respondToCheckIn } from '@/server/services/check-in'

/**
 * Answering the check-in, with no account and no session.
 *
 * Public because the whole point is one tap from a text message — a client who
 * has to sign in to say "the tone went brassy" says nothing, and the salon
 * finds out in six weeks from somebody else.
 */

export const respondToCheckInAction = withPublicAction(
  {
    name: 'checkIn.respond',
    schema: z.object({
      token: z.string().min(20).max(200),
      sentiment: z.enum(['DELIGHTED', 'FINE', 'NOT_RIGHT']),
      note: z.string().max(2000).nullable(),
    }),
    /*
     * Counted against the link, not the caller's address.
     *
     * A check-in goes to a few hundred clients at once and most of them tap it
     * on a phone, sharing their carrier's egress IP. On an address bucket the
     * eleventh person to answer would be refused because the first ten already
     * had — and refused before the handler runs, so their answer is simply
     * lost. The token is unguessable and belongs to one person, which is what a
     * limit on this endpoint should actually be protecting.
     */
    subject: (input) => input.token,
    limit: { attempts: 8, windowMinutes: 15 },
    auditAs: () => ({ entityType: 'PostVisitCheckIn' }),
  },
  async (input, ctx) => {
    return respondToCheckIn({
      salonId: ctx.salonId,
      token: input.token,
      sentiment: input.sentiment,
      note: input.note,
    })
  },
)
