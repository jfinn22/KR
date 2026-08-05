/**
 * The salon's country dialling code, guessed from where the salon is.
 *
 * A national number — 07700 900123 — cannot become E.164 without one, and the
 * parser refuses rather than assuming, because assuming +1 is how a British
 * salon's entire client list becomes unreachable by SMS.
 *
 * That refusal is right for the parser and wrong for the review screen: an
 * owner opening it for the first time would see every phone number in their
 * file marked "could not read", which says the platform is broken rather than
 * that it has one question. So the screen guesses from the location's own
 * timezone — which the salon set when it opened, not something inferred from a
 * file — and shows the guess in an editable field.
 *
 * A guess, and only a guess. Nothing here is used unless the owner leaves it
 * as it is, and where there is no confident answer the field is simply blank.
 */
const BY_ZONE: Readonly<Record<string, string>> = {
  'Europe/London': '44',
  'Europe/Belfast': '44',
  'Europe/Dublin': '353',
  'Europe/Paris': '33',
  'Europe/Madrid': '34',
  'Europe/Lisbon': '351',
  'Europe/Berlin': '49',
  'Europe/Amsterdam': '31',
  'Europe/Brussels': '32',
  'Europe/Rome': '39',
  'Europe/Vienna': '43',
  'Europe/Zurich': '41',
  'Europe/Stockholm': '46',
  'Europe/Oslo': '47',
  'Europe/Copenhagen': '45',
  'Europe/Helsinki': '358',
  'Europe/Warsaw': '48',
  'Pacific/Auckland': '64',
}

/**
 * Zones where `America/` does not mean the North American numbering plan.
 *
 * The prefix covers the United States and Canada, which between them are most
 * of it — and would otherwise silently claim Mexico City and São Paulo too,
 * which is precisely the wrong-number failure this whole file exists to avoid.
 */
const NOT_NANP = new Set([
  'America/Mexico_City',
  'America/Tijuana',
  'America/Monterrey',
  'America/Cancun',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Caracas',
  'America/Montevideo',
  'America/La_Paz',
  'America/Guatemala',
  'America/Costa_Rica',
  'America/Panama',
  'America/Havana',
])

export function callingCodeForTimeZone(timeZone: string): string | null {
  const known = BY_ZONE[timeZone]
  if (known) return known

  if ((timeZone.startsWith('America/') || timeZone === 'US/Eastern') && !NOT_NANP.has(timeZone)) {
    return '1'
  }
  if (timeZone.startsWith('Australia/')) return '61'

  // No confident answer. The screen asks, which is better than being wrong.
  return null
}
