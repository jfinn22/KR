'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { withAuthz, DomainError } from './guard'
import { saveAppointmentNote, saveClientNotes } from '@/server/services/front-desk'
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
