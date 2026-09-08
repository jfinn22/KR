import { dbFor } from '@/server/db/tenant-client'
import { DomainError } from '@/server/errors'
import { paymentsPort } from '@/ports/registry'

/**
 * A card the client agreed we could keep.
 *
 * No card number ever reaches this server. The browser talks to the provider
 * directly with a client secret, the provider hands back a reference, and a
 * reference is all that is stored — so the worst case for this table is that
 * somebody learns which bank a client uses and the last four digits printed on
 * every receipt they have ever been given.
 *
 * The customer is created per salon, not per person. A client of two salons has
 * two provider customers, because each salon's provider account is its own and
 * a shared one would let one salon charge a card the other collected.
 */

/** Find or create this client's customer at the provider. */
export async function customerFor(salonId: string, clientProfileId: string): Promise<string> {
  const db = dbFor(salonId)
  const client = await db.clientProfile.findFirst({
    where: { id: clientProfileId, salonId },
    select: { id: true, email: true, firstName: true, lastName: true, paymentsCustomerRef: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not on file.')
  if (client.paymentsCustomerRef) return client.paymentsCustomerRef

  const customer = await paymentsPort().createCustomer({
    email: client.email,
    name: `${client.firstName} ${client.lastName ?? ''}`.trim(),
    // Keyed on the client, so two tabs racing produce one customer.
    idempotencyKey: `cus_${salonId}_${client.id}`,
    metadata: { salonId, clientProfileId: client.id },
  })

  await db.clientProfile.update({
    where: { id: client.id },
    data: { paymentsCustomerRef: customer.id },
  })
  return customer.id
}

/**
 * Begin collecting a card.
 *
 * Returns a client secret the browser uses to talk to the provider directly.
 * Nothing is stored yet — the card lands here as a webhook, or on the next
 * `syncCards`, because a browser that closes mid-flow must not leave a client
 * believing they have a card on file when they do not.
 */
export async function beginCardSetup(input: {
  salonId: string
  clientProfileId: string
}): Promise<{ clientSecret: string; setupIntentId: string }> {
  const db = dbFor(input.salonId)
  const customerRef = await customerFor(input.salonId, input.clientProfileId)

  /*
   * Keyed on how many cards this client has EVER had, detached ones included.
   *
   * A key fixed to the client is wrong in a way that only shows up on the
   * second card: replaying it returns the first setup, which already
   * succeeded and is already attached to a card — so "add another card" hands
   * the browser a finished intent and collects nothing, forever.
   *
   * Counting every row ever written makes the key monotonic. A double-tap of
   * the same button sees the same count and is genuinely idempotent; adding a
   * second card, or replacing one that was removed, gets a fresh intent.
   */
  const everHad = await db.savedCard.count({
    where: { salonId: input.salonId, clientProfileId: input.clientProfileId },
  })

  const setup = await paymentsPort().createSetupIntent({
    customerRef,
    idempotencyKey: `seti_${input.salonId}_${input.clientProfileId}_${everHad}`,
    metadata: { salonId: input.salonId, clientProfileId: input.clientProfileId },
  })
  return { clientSecret: setup.clientSecret, setupIntentId: setup.id }
}

/**
 * Bring the stored cards in line with what the provider actually holds.
 *
 * Called after a setup completes and from the webhook. Idempotent by
 * construction: it upserts on the provider reference, so running it twice
 * writes the same rows. A card the provider no longer has is marked detached
 * rather than deleted — a deposit already charged against it still has to be
 * explainable a year later.
 */
export async function syncCards(input: {
  salonId: string
  clientProfileId: string
}): Promise<{ cards: { id: string; brand: string; last4: string }[] }> {
  const db = dbFor(input.salonId)
  const client = await db.clientProfile.findFirst({
    where: { id: input.clientProfileId, salonId: input.salonId },
    select: { paymentsCustomerRef: true },
  })
  if (!client?.paymentsCustomerRef) return { cards: [] }

  const live = await paymentsPort().listPaymentMethods(client.paymentsCustomerRef)
  const liveRefs = new Set(live.map((card) => card.id))

  const existing = await db.savedCard.findMany({
    where: { salonId: input.salonId, clientProfileId: input.clientProfileId },
    select: { id: true, providerRef: true, detachedAt: true },
  })
  const hadAny = existing.some((row) => row.detachedAt === null)

  for (const [index, card] of live.entries()) {
    await db.savedCard.upsert({
      where: { salonId_providerRef: { salonId: input.salonId, providerRef: card.id } },
      update: {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        detachedAt: null,
      },
      create: {
        salonId: input.salonId,
        clientProfileId: input.clientProfileId,
        providerRef: card.id,
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        // The first card somebody adds is the one to charge. Making them then
        // choose it is a step that exists only because the software could not
        // guess, and it can.
        isDefault: !hadAny && index === 0,
      },
    })
  }

  // Anything the provider no longer holds — removed from another device, or
  // expired out — stops being chargeable here too.
  const gone = existing.filter((row) => !liveRefs.has(row.providerRef) && !row.detachedAt)
  if (gone.length > 0) {
    await db.savedCard.updateMany({
      where: { id: { in: gone.map((row) => row.id) } },
      data: { detachedAt: new Date(), isDefault: false },
    })
  }

  return {
    cards: live.map((card) => ({ id: card.id, brand: card.brand, last4: card.last4 })),
  }
}

/**
 * Finish a setup with no browser involved.
 *
 * Only possible against the mock adapter, which is the point: with no provider
 * account configured there is no Elements to render, and a card step that
 * cannot be completed makes the whole booking journey untestable. Against a
 * real key `attachTestCard` does not exist, so this refuses — the fallback is
 * unreachable by construction rather than gated on a flag.
 */
export async function completeCardSetupWithoutBrowser(input: {
  salonId: string
  clientProfileId: string
  setupIntentId: string
}): Promise<{ cards: { id: string; brand: string; last4: string }[] }> {
  const port = paymentsPort()
  if (!port.attachTestCard) {
    throw new DomainError(
      'CONFLICT',
      'This salon takes cards through its payment provider — use the card form.',
    )
  }
  port.attachTestCard(input.setupIntentId)
  return syncCards({ salonId: input.salonId, clientProfileId: input.clientProfileId })
}

/** The cards this client can be charged against, newest default first. */
export async function cardsFor(salonId: string, clientProfileId: string) {
  const db = dbFor(salonId)
  return db.savedCard.findMany({
    where: { salonId, clientProfileId, detachedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      brand: true,
      last4: true,
      expMonth: true,
      expYear: true,
      isDefault: true,
    },
  })
}

/**
 * Take a card off file.
 *
 * Detached at the provider first. Marking it removed here while it still
 * exists there would leave a client believing they had withdrawn permission
 * they had not — which is the one thing this feature must never do.
 */
export async function removeCard(input: {
  salonId: string
  clientProfileId: string
  savedCardId: string
}): Promise<{ removed: boolean }> {
  const db = dbFor(input.salonId)
  const card = await db.savedCard.findFirst({
    where: {
      id: input.savedCardId,
      salonId: input.salonId,
      clientProfileId: input.clientProfileId,
    },
  })
  if (!card) throw new DomainError('NOT_FOUND', 'That card is not on file.')

  /*
   * A card holding an authorised deposit cannot be removed. The money is
   * already reserved against it; letting it go would strand a hold the client
   * can see on their statement and nobody can release.
   */
  const holding = await db.deposit.count({
    where: { savedCardId: card.id, status: { in: ['AUTHORIZED', 'PENDING'] } },
  })
  if (holding > 0) {
    throw new DomainError(
      'CONFLICT',
      'This card is holding a deposit for an upcoming appointment. Cancel or complete it first.',
    )
  }

  await paymentsPort().detachPaymentMethod(card.providerRef)
  await db.savedCard.update({
    where: { id: card.id },
    data: { detachedAt: new Date(), isDefault: false },
  })

  // Somebody has to be the default, or the next deposit has nothing to charge.
  if (card.isDefault) {
    const next = await db.savedCard.findFirst({
      where: { salonId: input.salonId, clientProfileId: input.clientProfileId, detachedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (next) {
      await db.savedCard.update({ where: { id: next.id }, data: { isDefault: true } })
    }
  }

  return { removed: true }
}
