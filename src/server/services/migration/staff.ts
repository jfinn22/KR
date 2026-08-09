import { dbFor } from '@/server/db/tenant-client'
import { parseCsv, toRecords } from '@/domain/migration/csv'
import { normaliseHeader } from '@/domain/migration/columns'
import { parseEmail, parseName } from '@/domain/migration/normalise'

/**
 * The team, brought across — names and skills, and nothing else.
 *
 * Deliberately shallow, and the shallowness is the design. A rota is the one
 * thing in a salon that changes weekly and is remembered by everybody in the
 * building, so importing last month's working hours produces a diary that is
 * confidently wrong about who is in on Thursday — and a wrong rota is worse
 * than an empty one, because an empty one gets filled in.
 *
 * Not imported, on purpose: working hours, time off, commission, pay,
 * historical performance. Every one of those is either short-lived, sensitive,
 * or reconstructible from the appointment history that came across anyway.
 */

export interface StaffRow {
  line: number
  displayName: string
  email: string | null
  title: string | null
  /** Skill codes this platform recognises, from whatever the file called them. */
  skills: string[]
  /** Names in the file that match nothing here. Shown, never guessed at. */
  unknownSkills: string[]
  problems: string[]
}

export interface StaffImportPreview {
  rows: StaffRow[]
  /** Already on the team, matched by name. Updated rather than duplicated. */
  existing: Record<string, string>
}

/**
 * What the salon's own skill codes are called in the wild.
 *
 * Matched on the normalised form only, and deliberately short. A stylist
 * wrongly credited with COLOR_CORRECTION is one the solver will happily book a
 * corrective on, so a name this list does not recognise is reported to the
 * owner rather than guessed at — the four codes here are the ones the platform
 * actually reasons about, and inventing more would be inventing a vocabulary
 * nothing else in the system shares.
 */
const SKILL_ALIASES: Readonly<Record<string, string>> = {
  balayage: 'BALAYAGE',
  freehand: 'BALAYAGE',
  foils: 'FOILS',
  highlights: 'FOILS',
  colourcorrection: 'COLOR_CORRECTION',
  colorcorrection: 'COLOR_CORRECTION',
  correction: 'COLOR_CORRECTION',
  extensions: 'EXTENSIONS_TAPE',
  tapeextensions: 'EXTENSIONS_TAPE',
}

export async function previewStaffImport(
  salonId: string,
  text: string,
): Promise<StaffImportPreview> {
  const db = dbFor(salonId)
  const table = parseCsv(text)
  const records = toRecords(table)

  const headers = new Map(table.header.map((header) => [normaliseHeader(header), header]))
  const pick = (record: Record<string, string>, ...names: string[]): string => {
    for (const name of names) {
      const header = headers.get(name)
      if (header && record[header]?.trim()) return record[header].trim()
    }
    return ''
  }

  const rows = records.map((record, index): StaffRow => {
    const problems: string[] = []

    const rawName = pick(record, 'name', 'fullname', 'staffname', 'stylistname', 'displayname')
    const first = pick(record, 'firstname', 'first')
    const last = pick(record, 'lastname', 'surname', 'last')

    const parsed = rawName ? parseName(rawName) : null
    const displayName = parsed
      ? [parsed.firstName, parsed.lastName].filter(Boolean).join(' ')
      : [first, last].filter(Boolean).join(' ')

    if (displayName === '') problems.push('No name on this row.')

    const rawEmail = pick(record, 'email', 'emailaddress', 'workemail')
    const email = parseEmail(rawEmail)
    if (rawEmail !== '' && email === null) {
      problems.push(`"${rawEmail}" does not look like an email address.`)
    }

    const rawSkills = pick(record, 'skills', 'specialties', 'specialities', 'services')
    const skills: string[] = []
    const unknownSkills: string[] = []
    for (const piece of rawSkills.split(/[;,|/]/)) {
      const trimmed = piece.trim()
      if (trimmed === '') continue
      const code = SKILL_ALIASES[normaliseHeader(trimmed)]
      if (code) {
        if (!skills.includes(code)) skills.push(code)
      } else {
        unknownSkills.push(trimmed)
      }
    }

    return {
      // The header is line 1, so this matches what the owner sees in the file.
      line: index + 2,
      displayName,
      email,
      title: pick(record, 'title', 'role', 'jobtitle') || null,
      skills,
      unknownSkills,
      problems,
    }
  })

  const names = rows.map((row) => row.displayName).filter((name) => name !== '')
  const already = names.length
    ? await db.stylistProfile.findMany({
        where: { salonId, displayName: { in: names } },
        select: { id: true, displayName: true },
      })
    : []

  return {
    rows,
    existing: Object.fromEntries(already.map((row) => [row.displayName, row.id])),
  }
}

export interface StaffImportResult {
  created: number
  updated: number
  skipped: number
}

/**
 * Write them.
 *
 * A `StylistProfile` hangs off a `Membership`, which hangs off a `User`, which
 * needs an email — so a row with no address cannot become a stylist and is
 * counted as skipped rather than invented around. A placeholder address would
 * put an account nobody can sign into, and nobody can ever clean up, in the
 * team list forever; the owner adding one email is a smaller job than that.
 */
export async function commitStaffImport(
  salonId: string,
  rows: readonly StaffRow[],
  locationId: string,
): Promise<StaffImportResult> {
  const db = dbFor(salonId)
  const result: StaffImportResult = { created: 0, updated: 0, skipped: 0 }

  for (const row of rows) {
    if (row.displayName === '') {
      result.skipped += 1
      continue
    }

    const existing = await db.stylistProfile.findFirst({
      where: { salonId, displayName: row.displayName },
      select: { id: true },
    })

    if (existing) {
      await db.stylistProfile.update({
        where: { id: existing.id },
        data: { title: row.title ?? undefined },
      })
      await writeSkills(salonId, existing.id, row.skills)
      result.updated += 1
      continue
    }

    // No address, no membership, no profile. Reported, not guessed around.
    if (!row.email) {
      result.skipped += 1
      continue
    }

    const user = await db.user.upsert({
      where: { email: row.email },
      update: {},
      create: { email: row.email, name: row.displayName },
      select: { id: true },
    })

    const membership = await db.membership.upsert({
      where: { salonId_userId: { salonId, userId: user.id } },
      update: {},
      create: { salonId, userId: user.id, role: 'STYLIST', status: 'ACTIVE' },
      select: { id: true },
    })

    const profile = await db.stylistProfile.upsert({
      where: { membershipId: membership.id },
      update: { displayName: row.displayName, title: row.title ?? undefined },
      create: {
        salonId,
        membershipId: membership.id,
        displayName: row.displayName,
        title: row.title,
        defaultLocationId: locationId,
      },
      select: { id: true },
    })

    await writeSkills(salonId, profile.id, row.skills)
    result.created += 1
  }

  return result
}

/**
 * Skills, at a level nobody claimed.
 *
 * Level 3 of 5 — competent, not expert. The file said the stylist does
 * balayage; it did not say they are the best in the building, and seeding
 * everybody at 5 would make the solver's skill matching meaningless on day one.
 */
const IMPORTED_SKILL_LEVEL = 3

async function writeSkills(
  salonId: string,
  stylistProfileId: string,
  skills: readonly string[],
): Promise<void> {
  const db = dbFor(salonId)
  for (const skillCode of skills) {
    await db.stylistSkill.upsert({
      where: { stylistProfileId_skillCode: { stylistProfileId, skillCode } },
      // Never lowers a level somebody at the salon has already set by hand.
      update: {},
      create: {
        salonId,
        stylistProfileId,
        skillCode,
        level: IMPORTED_SKILL_LEVEL,
      },
    })
  }
}
