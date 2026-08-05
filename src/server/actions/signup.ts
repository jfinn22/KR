'use server'

import { z } from 'zod'
import { withPublicAction } from './public-guard'
import { assertJoinCode, joinCodeMatches, signUpClient } from '@/server/services/signup'

/**
 * Joining a salon.
 *
 * The first thing to go through `withPublicAction`, and the reason it exists:
 * the person doing this has no account, so `withAuthz` would reject them
 * before the handler ran.
 *
 * The limit is tighter than the default. Signup creates User rows, so an
 * unthrottled endpoint is a way to fill somebody else's database.
 */
export const signUpClientAction = withPublicAction(
  {
    name: 'client.signUp',
    limit: { attempts: 5, windowMinutes: 15 },
    schema: z.object({
      email: z.string().email('Please enter an email we can reach you on.').max(320),
      // Long rather than complex. A length floor is the requirement that
      // actually correlates with a password not being guessable.
      password: z.string().min(10, 'Please use at least 10 characters.').max(200),
      firstName: z.string().min(1, 'Please tell us your first name.').max(80),
      lastName: z.string().max(80).nullish(),
      phone: z.string().max(40).nullish(),
      marketingOptIn: z.boolean().default(false),
      joinCode: z.string().max(40).nullish(),
    }),
    auditAs: () => ({ entityType: 'ClientProfile' }),
  },
  async (input, ctx) => {
    assertJoinCode(await joinCodeMatches(ctx.salonId, input.joinCode ?? null))

    await signUpClient({
      salonId: ctx.salonId,
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      marketingOptIn: input.marketingOptIn ?? false,
      joinCode: input.joinCode ?? null,
    })

    /*
     * Deliberately returns nothing about whether an account already existed.
     * The service knows; the caller must not, or this becomes a way to ask
     * "is this person a client of that salon?" without an account.
     */
    return { done: true }
  },
)
