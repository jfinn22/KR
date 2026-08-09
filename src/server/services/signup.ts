import { unsafeDb } from '@/server/db/client'
import { DomainError } from '@/server/errors'
import { hashPassword } from '@/server/auth/password'

/**
 * A client joining a salon.
 *
 * Until now there was no path here at all: `/signup` was linked three times
 * and 404'd every time, and `clientProfile.create` appeared nowhere in `src/`.
 * The only client records that existed came from the seed.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not let somebody browse for a salon. A client arrives on a
 *    salon's own link, its QR code, or with its join code, and becomes a client
 *    of that salon only. There is no directory, because a directory is a
 *    marketplace and a marketplace competes with the salons paying for this.
 *
 *  - It does not tell an unauthenticated caller whether an email is already
 *    registered. Signup and claim look identical from outside, which is what
 *    stops this being an account-enumeration oracle.
 */

export interface SignUpInput {
  salonId: string
  email: string
  password: string
  firstName: string
  lastName?: string | null
  phone?: string | null
  /** Explicitly ticked. Absence means no marketing, not "ask again later". */
  marketingOptIn: boolean
  joinCode?: string | null
}

export interface SignUpResult {
  /** True when this linked an existing walk-in rather than creating a record. */
  claimedExisting: boolean
}

export async function signUpClient(input: SignUpInput): Promise<SignUpResult> {
  const email = input.email.trim().toLowerCase()

  const existingUser = await unsafeDb.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  })

  /*
   * An account already exists for this email. Do not create a second one, do
   * not overwrite the password, and do not say so — from outside, this
   * response is indistinguishable from a successful signup. Someone who really
   * owns the address signs in; someone probing learns nothing.
   */
  if (existingUser) {
    await linkToSalon(existingUser.id, input, email)
    return { claimedExisting: true }
  }

  const passwordHash = await hashPassword(input.password)
  const user = await unsafeDb.user.create({
    data: { email, name: `${input.firstName} ${input.lastName ?? ''}`.trim(), passwordHash },
    select: { id: true },
  })

  const claimed = await linkToSalon(user.id, input, email)
  return { claimedExisting: claimed }
}

/**
 * Attach a user to the salon as a client.
 *
 * `ClientProfile.userId` is nullable by design — the front desk creates records
 * for walk-ins who have never logged in. So the first thing to try is CLAIMING
 * one of those rather than creating a duplicate: a client who has been coming
 * for two years and finally makes an account should find their history waiting,
 * not start from nothing beside a shadow record of themselves.
 */
async function linkToSalon(userId: string, input: SignUpInput, email: string): Promise<boolean> {
  const already = await unsafeDb.clientProfile.findFirst({
    where: { salonId: input.salonId, userId },
    select: { id: true },
  })
  if (already) return true

  const walkIn = await unsafeDb.clientProfile.findFirst({
    where: {
      salonId: input.salonId,
      userId: null,
      status: 'ACTIVE',
      email: { equals: email, mode: 'insensitive' },
    },
    select: { id: true },
  })

  if (walkIn) {
    await unsafeDb.clientProfile.update({
      where: { id: walkIn.id },
      data: { userId, source: 'PORTAL_CLAIMED' },
    })
    await writeConsents(input.salonId, walkIn.id, input.marketingOptIn)
    return true
  }

  const created = await unsafeDb.clientProfile.create({
    data: {
      salonId: input.salonId,
      userId,
      firstName: input.firstName.trim(),
      lastName: input.lastName?.trim() || '',
      email,
      phone: input.phone?.trim() || null,
      source: input.joinCode ? 'JOIN_CODE' : 'PORTAL',
    },
    select: { id: true },
  })

  await writeConsents(input.salonId, created.id, input.marketingOptIn)
  return false
}

/**
 * Record what they agreed to, at the moment they agreed to it.
 *
 * Transactional is granted because they are asking us to book them in and
 * confirm it — that is the service, not marketing. Marketing is only ever
 * written when explicitly ticked, and is written as REVOKED rather than left
 * absent when it is not, so the record says "they were asked and declined"
 * instead of "nobody knows".
 *
 * Exported because the front desk creates clients too, and a walk-in with no
 * consent rows now silently loses every marketing message — the send path
 * treats an absent row as "no" for marketing. One definition, both doors.
 */
export async function writeConsents(
  salonId: string,
  clientProfileId: string,
  marketingOptIn: boolean,
  capturedVia = 'SIGNUP',
): Promise<void> {
  const rows = (['SMS', 'EMAIL'] as const).flatMap((channel) => [
    { channel, purpose: 'TRANSACTIONAL' as const, status: 'GRANTED' as const },
    {
      channel,
      purpose: 'MARKETING' as const,
      status: marketingOptIn ? ('GRANTED' as const) : ('REVOKED' as const),
    },
  ])

  for (const row of rows) {
    await unsafeDb.contactConsent.upsert({
      where: {
        clientProfileId_channel_purpose: {
          clientProfileId,
          channel: row.channel,
          purpose: row.purpose,
        },
      },
      update: {},
      create: {
        salonId,
        clientProfileId,
        channel: row.channel,
        purpose: row.purpose,
        status: row.status,
        capturedVia,
      },
    })
  }
}

/** Check a salon's join code, if it has one set. */
export async function joinCodeMatches(salonId: string, code: string | null): Promise<boolean> {
  const settings = await unsafeDb.salonSettings.findUnique({
    where: { salonId },
    select: { joinCode: true },
  })
  const required = settings?.joinCode?.trim()
  // No code configured — the door is open.
  if (!required) return true
  // A salon that set a code is not open to an empty submission.
  if (!code?.trim()) return false
  return required.toUpperCase() === code.trim().toUpperCase()
}

export function assertJoinCode(matched: boolean): void {
  if (!matched) throw new DomainError('INVALID_INPUT', 'That join code is not right.')
}
