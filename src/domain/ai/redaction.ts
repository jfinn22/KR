/**
 * Stripping identity before anything leaves for a model.
 *
 * Lives in the domain rather than beside the AI service so it is pure, so the
 * unit tier can test it without instantiating a database client, and so
 * nothing here can accidentally acquire an I/O dependency later. The service
 * calls it; the port asserts the result independently.
 */

/**
 * Strip anything that identifies the person.
 *
 * The model needs the hair, not the client. It gets a pseudonymous reference
 * and never a name, an email, a phone number or a date of birth — the same
 * discipline the rules engine already follows, for the same reason.
 */
export function redactForAi<T extends Record<string, unknown>>(input: T): T {
  const BANNED = new Set([
    'firstName',
    'lastName',
    'name',
    'email',
    'phone',
    'dateOfBirth',
    'addressLine1',
    'addressLine2',
    'postalCode',
    'clientName',
    'signerName',
  ])

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !BANNED.has(key))
          .map(([key, entry]) => [key, walk(entry)]),
      )
    }
    return value
  }

  return walk(input) as T
}
