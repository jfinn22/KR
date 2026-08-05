/**
 * Join codes a receptionist can read out loud.
 *
 * A plain module rather than part of the settings service, because the settings
 * form is a client component: importing this from `server/services/settings.ts`
 * would drag Prisma into the browser bundle. `check:boundary` catches a server
 * module reaching into a client one, not this direction — so the placement is
 * the only thing preventing it.
 */

/**
 * No O/0, no I/1, no S/5.
 *
 * The whole point is somebody saying it across a counter and somebody else
 * typing it correctly first time. Uppercase for the same reason; matching is
 * case-insensitive anyway.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY2346789'

export function generateJoinCode(prefix: string): string {
  let body = ''
  for (let i = 0; i < 4; i++) {
    body += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  const clean = prefix
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 6)
  return clean ? `${clean}-${body}` : body
}
