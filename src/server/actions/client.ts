'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import {
  createClientAtDesk,
  saveAppointmentNote,
  saveClientNotes,
} from '@/server/services/front-desk'
import { unsafeDb } from '@/server/db/client'
import type { TenantContext } from '@/server/auth/context'

/**
 * What the salon knows about a client that the client does not write.
 *
 * These notes are the institutional memory a salon otherwise keeps in one
 * stylist's head — that somebody needs the radio off, that the last toner
 * pulled warm on them, that they book in for four hours and leave after two.
 * A colleague picking up the column should inherit it, and an erasure should
 * take it with everything else.
 *
 * Deliberately never shown to the client. `Appointment.clientNote` is theirs;
 * these are not.
 */

const cuid = z.string().min(1).max(64)

async function clientResource(clientProfileId: string, ctx: TenantContext) {
  const client = await unsafeDb.clientProfile.findFirst({
    where: { id: clientProfileId, salonId: ctx.salonId },
    select: { id: true, preferredStylistId: true },
  })
  if (!client) throw new DomainError('NOT_FOUND', 'That client is not on file.')
  return {
    salonId: ctx.salonId,
    clientProfileId: client.id,
    ownerStylistId: client.preferredStylistId,
  }
}

/** Standing notes about a client, carried across every visit. */
export const saveClientNotesAction = withAuthz(
  {
    action: 'client.edit',
    schema: z.object({
      clientProfileId: cuid,
      // Nullable rather than optional: clearing a note is a real edit, and it
      // has to be distinguishable from not touching the field.
      internalNotes: z.string().max(8000).nullable(),
    }),
    resource: (input, ctx) => clientResource(input.clientProfileId, ctx),
    auditAs: (input) => ({ entityType: 'ClientProfile', entityId: input.clientProfileId }),
  },
  async (input, ctx) => {
    await saveClientNotes(ctx.salonId, input.clientProfileId, input.internalNotes)
    revalidatePath(`/s/${ctx.salonSlug}/desk/clients/${input.clientProfileId}`)
    return { saved: true }
  },
)

/**
 * A note about one visit rather than the person.
 *
 * "Ran forty minutes over because the bleach lifted unevenly" belongs to the
 * appointment; "always runs late" belongs to the client. Keeping them apart is
 * what stops a one-off becoming a permanent character note.
 */
export const saveAppointmentNoteAction = withAuthz(
  {
    action: 'client.edit',
    schema: z.object({
      appointmentId: cuid,
      internalNote: z.string().max(8000).nullable(),
    }),
    resource: async (input, ctx) => {
      const appointment = await unsafeDb.appointment.findFirst({
        where: { id: input.appointmentId, salonId: ctx.salonId },
        select: { id: true, clientProfileId: true, primaryStylistId: true },
      })
      if (!appointment) throw new DomainError('NOT_FOUND', 'That appointment is not on file.')
      return {
        salonId: ctx.salonId,
        clientProfileId: appointment.clientProfileId,
        ownerStylistId: appointment.primaryStylistId,
      }
    },
    auditAs: (input) => ({ entityType: 'Appointment', entityId: input.appointmentId }),
  },
  async (input, ctx) => {
    await saveAppointmentNote(ctx.salonId, input.appointmentId, input.internalNote)
    revalidatePath(`/s/${ctx.salonSlug}/desk`)
    return { saved: true }
  },
)

/*
 * Hoisted out of the action, not inlined like the others.
 *
 * A `'use server'` module may only EXPORT async functions, and the arrow inside
 * `.refine()` sits in an exported const's initializer — which the compiler
 * rejects outright. A module-local const is unconstrained.
 */
const NEW_CLIENT = z
  .object({
    firstName: z.string().min(1, 'A first name, at least.').max(80),
    lastName: z.string().max(80).nullish(),
    email: z.string().email('That email does not look right.').max(320).nullish().or(z.literal('')),
    phone: z.string().max(40).nullish(),
    internalNotes: z.string().max(8000).nullish(),
    marketingOptIn: z.boolean().default(false),
  })
  // Somebody with neither an email nor a phone cannot be reminded about
  // anything, which makes the record close to useless — and a no-show the
  // salon could not have prevented.
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'We need either an email or a phone number to reach them on.',
    path: ['email'],
  })

/**
 * Create a client at the desk.
 *
 * `client.create` is already granted to every staff role in the matrix — the
 * front desk taking somebody's details is the most ordinary thing that happens
 * in a salon, and it is the missing piece that makes walk-ins bookable at all.
 */
export const createClientAction = withAuthz(
  {
    action: 'client.create',
    schema: NEW_CLIENT,
    auditAs: (_input, result) => ({
      entityType: 'ClientProfile',
      entityId: (result as { id?: string } | null)?.id ?? null,
    }),
  },
  async (input, ctx) => {
    const result = await createClientAtDesk({
      salonId: ctx.salonId,
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      email: input.email || null,
      phone: input.phone ?? null,
      internalNotes: input.internalNotes ?? null,
      marketingOptIn: input.marketingOptIn ?? false,
    })

    revalidatePath(`/s/${ctx.salonSlug}/desk/clients`)
    return result
  },
)
