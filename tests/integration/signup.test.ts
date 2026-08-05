import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { unsafeDb } from '@/server/db/client'
import { signUpClient } from '@/server/services/signup'
import { createClientAtDesk } from '@/server/services/front-desk'

/**
 * The two doors into a salon, and the point where they meet.
 *
 * A client can arrive by signing up on the salon's own link, or by being typed
 * in at the desk while they stand there. The interesting case is the same
 * person coming through both — somebody the front desk created two years ago
 * who finally makes an account. They must find their history waiting rather
 * than start again beside a shadow record of themselves.
 */

const S = 'su_salon'

async function seed() {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@su-test.example' } } })

  await unsafeDb.salon.create({
    data: {
      id: S,
      slug: 'su-test-salon',
      name: 'Signup Test Salon',
      defaultTimezone: 'America/New_York',
      settings: { create: {} },
    },
  })
}

beforeEach(seed)
afterAll(async () => {
  await unsafeDb.salon.deleteMany({ where: { id: S } })
  await unsafeDb.user.deleteMany({ where: { email: { endsWith: '@su-test.example' } } })
})

const profiles = () => unsafeDb.clientProfile.findMany({ where: { salonId: S } })

const consentsFor = (clientProfileId: string) =>
  unsafeDb.contactConsent.findMany({
    where: { clientProfileId },
    orderBy: [{ channel: 'asc' }, { purpose: 'asc' }],
  })

describe('signing up', () => {
  it('creates a user and a client of that salon only', async () => {
    await signUpClient({
      salonId: S,
      email: 'Wren@su-test.example',
      password: 'a-long-enough-password',
      firstName: 'Wren',
      marketingOptIn: false,
    })

    const rows = await profiles()
    expect(rows).toHaveLength(1)
    // Normalised, or the same person signs up twice with different casing.
    expect(rows[0]!.email).toBe('wren@su-test.example')
    expect(rows[0]!.userId).toBeTruthy()
    expect(rows[0]!.source).toBe('PORTAL')
  })

  it('records marketing as an explicit no rather than leaving it unknown', async () => {
    await signUpClient({
      salonId: S,
      email: 'quiet@su-test.example',
      password: 'a-long-enough-password',
      firstName: 'Quiet',
      marketingOptIn: false,
    })

    const [client] = await profiles()
    const consents = await consentsFor(client!.id)

    // Four rows: both channels, both purposes. "They were asked and declined"
    // is a different fact from "nobody knows", and the send path now treats an
    // absent marketing row as a refusal — so the record has to say which.
    expect(consents).toHaveLength(4)
    expect(
      consents.filter((c) => c.purpose === 'TRANSACTIONAL').every((c) => c.status === 'GRANTED'),
    ).toBe(true)
    expect(
      consents.filter((c) => c.purpose === 'MARKETING').every((c) => c.status === 'REVOKED'),
    ).toBe(true)
  })

  it('grants marketing when it was actually ticked', async () => {
    await signUpClient({
      salonId: S,
      email: 'keen@su-test.example',
      password: 'a-long-enough-password',
      firstName: 'Keen',
      marketingOptIn: true,
    })

    const [client] = await profiles()
    const consents = await consentsFor(client!.id)
    expect(
      consents.filter((c) => c.purpose === 'MARKETING').every((c) => c.status === 'GRANTED'),
    ).toBe(true)
  })

  it('does not create a second account for an email that already has one', async () => {
    const input = {
      salonId: S,
      email: 'twice@su-test.example',
      password: 'a-long-enough-password',
      firstName: 'Twice',
      marketingOptIn: false,
    }
    await signUpClient(input)
    await signUpClient({ ...input, password: 'a-completely-different-one' })

    expect(await profiles()).toHaveLength(1)
    expect(await unsafeDb.user.count({ where: { email: 'twice@su-test.example' } })).toBe(1)
  })

  it('never overwrites the password of an account that already exists', async () => {
    await signUpClient({
      salonId: S,
      email: 'victim@su-test.example',
      password: 'the-real-owners-password',
      firstName: 'Victim',
      marketingOptIn: false,
    })
    const before = await unsafeDb.user.findUnique({
      where: { email: 'victim@su-test.example' },
      select: { passwordHash: true },
    })

    // Somebody else "signing up" with a known address must not be able to
    // reset it out from under them.
    await signUpClient({
      salonId: S,
      email: 'victim@su-test.example',
      password: 'an-attackers-password',
      firstName: 'Not Them',
      marketingOptIn: false,
    })

    const after = await unsafeDb.user.findUnique({
      where: { email: 'victim@su-test.example' },
      select: { passwordHash: true },
    })
    expect(after?.passwordHash).toBe(before?.passwordHash)
  })
})

describe('the front desk creating somebody', () => {
  it('creates a client with no login, which is the point', async () => {
    const { id, mergedWithExisting } = await createClientAtDesk({
      salonId: S,
      firstName: 'Walk',
      lastName: 'In',
      phone: '+1 555 0100',
    })

    expect(mergedWithExisting).toBe(false)
    const row = await unsafeDb.clientProfile.findUnique({ where: { id } })
    expect(row?.userId).toBeNull()
    expect(row?.source).toBe('FRONT_DESK')
  })

  it('writes consent rows, or the walk-in silently receives nothing', async () => {
    const { id } = await createClientAtDesk({
      salonId: S,
      firstName: 'Consented',
      email: 'desk@su-test.example',
    })
    expect(await consentsFor(id)).toHaveLength(4)
  })

  it('finds the same person again instead of making a second record', async () => {
    const first = await createClientAtDesk({
      salonId: S,
      firstName: 'Ada',
      email: 'ada@su-test.example',
    })
    const second = await createClientAtDesk({
      salonId: S,
      firstName: 'Ada',
      lastName: 'Byron',
      email: 'ADA@su-test.example',
    })

    expect(second.mergedWithExisting).toBe(true)
    expect(second.id).toBe(first.id)
    expect(await profiles()).toHaveLength(1)
  })

  it('matches on a phone number typed a different way', async () => {
    // Nobody writes the same number down twice the same way.
    const first = await createClientAtDesk({
      salonId: S,
      firstName: 'Phone',
      phone: '5550199',
    })
    const second = await createClientAtDesk({
      salonId: S,
      firstName: 'Phone',
      phone: '555-0199',
    })

    expect(second.id).toBe(first.id)
  })
})

describe('a walk-in who later makes an account', () => {
  it('claims their existing record rather than starting again', async () => {
    const walkIn = await createClientAtDesk({
      salonId: S,
      firstName: 'Long',
      lastName: 'Standing',
      email: 'long@su-test.example',
    })

    // Two years of history hanging off that record.
    await unsafeDb.clientProfile.update({
      where: { id: walkIn.id },
      data: { completedVisits: 14, internalNotes: 'Likes the radio off.' },
    })

    await signUpClient({
      salonId: S,
      email: 'long@su-test.example',
      password: 'a-long-enough-password',
      firstName: 'Long',
      marketingOptIn: false,
    })

    const rows = await profiles()
    expect(rows, 'no duplicate was created').toHaveLength(1)
    expect(rows[0]!.id).toBe(walkIn.id)
    expect(rows[0]!.userId, 'the login is attached').toBeTruthy()
    expect(rows[0]!.completedVisits, 'the history survived').toBe(14)
    expect(rows[0]!.internalNotes).toBe('Likes the radio off.')
    expect(rows[0]!.source).toBe('PORTAL_CLAIMED')
  })

  it('does not claim a record belonging to a different salon', async () => {
    const other = await unsafeDb.salon.create({
      data: {
        id: 'su_other',
        slug: 'su-other-salon',
        name: 'Other',
        defaultTimezone: 'America/New_York',
        settings: { create: {} },
      },
    })

    try {
      await createClientAtDesk({
        salonId: other.id,
        firstName: 'Elsewhere',
        email: 'elsewhere@su-test.example',
      })

      await signUpClient({
        salonId: S,
        email: 'elsewhere@su-test.example',
        password: 'a-long-enough-password',
        firstName: 'Elsewhere',
        marketingOptIn: false,
      })

      // One record at each salon, and the other salon's is untouched.
      expect(await profiles()).toHaveLength(1)
      const theirs = await unsafeDb.clientProfile.findMany({ where: { salonId: other.id } })
      expect(theirs).toHaveLength(1)
      expect(theirs[0]!.userId, 'the other salon did not gain a login').toBeNull()
    } finally {
      await unsafeDb.salon.deleteMany({ where: { id: 'su_other' } })
    }
  })
})
