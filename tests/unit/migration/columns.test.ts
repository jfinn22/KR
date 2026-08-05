import { describe, expect, it } from 'vitest'
import {
  inferColumns,
  mapStatus,
  normaliseHeader,
  platformProfile,
  PLATFORMS,
  type ImportField,
} from '@/domain/migration/columns'

/**
 * Working out what a column is.
 *
 * The cost of getting this wrong is asymmetric, and that asymmetry is the whole
 * design: a column left unmapped is a question the owner answers once, while a
 * column mapped to the wrong field is data in the wrong place that nobody ever
 * finds again. So every test here is really asking "does it refuse when it
 * should".
 */

/** The mapping, as `{ header: field }`, which is what the assertions care about. */
function mapOf(headers: readonly string[]): Record<string, ImportField> {
  return Object.fromEntries(inferColumns(headers).map((c) => [c.header, c.field]))
}

describe('recognising a header', () => {
  it('matches a known name exactly, and says it is certain', () => {
    const [match] = inferColumns(['Phone'])
    expect(match).toMatchObject({ field: 'phone', header: 'Phone', index: 0, confidence: 1 })
  })

  it('ignores punctuation, case and spacing, because every export writes them differently', () => {
    expect(normaliseHeader('Phone Number')).toBe('phonenumber')
    expect(normaliseHeader('phone_number')).toBe('phonenumber')
    expect(normaliseHeader('PHONE-NUMBER')).toBe('phonenumber')

    for (const header of ['Phone Number', 'phone_number', 'PHONE-NUMBER']) {
      expect(mapOf([header])).toEqual({ [header]: 'phone' })
    }
  })

  it('drops a parenthesised unit, which is where the real name usually hides', () => {
    // "Duration (mins)" is the same column as "Duration".
    expect(normaliseHeader('Duration (mins)')).toBe('duration')
    expect(mapOf(['Duration (mins)'])).toEqual({ 'Duration (mins)': 'durationMin' })
  })

  it('takes a contained match, but marks it as a guess', () => {
    const [match] = inferColumns(['Client Email Address'])
    expect(match?.field).toBe('email')
    // Below 1, so the import screen shows it for confirmation rather than
    // applying it silently.
    expect(match?.confidence).toBeLessThan(1)
  })

  it('says nothing about a header it does not know', () => {
    expect(inferColumns(['Loyalty Points', 'Referral Source'])).toEqual([])
  })
})

describe('the columns that must never be guessed at', () => {
  it('refuses "Price Type", which is not a price', () => {
    /*
     * A column of the word "fixed" parsed as money is four thousand
     * appointments worth nothing at all — and a salon's imported takings are
     * the first number the owner checks.
     */
    expect(mapOf(['Price Type'])).toEqual({})
    // The real thing still maps, exactly.
    expect(mapOf(['Price'])).toEqual({ Price: 'priceCents' })
  })

  it('refuses "Duration Type" for the same reason', () => {
    expect(mapOf(['Duration Type'])).toEqual({})
    expect(mapOf(['Duration'])).toEqual({ Duration: 'durationMin' })
  })

  it('still takes an exact price alias whatever it is called', () => {
    expect(mapOf(['Total Price'])).toEqual({ 'Total Price': 'priceCents' })
    expect(mapOf(['Amount Paid'])).toEqual({ 'Amount Paid': 'priceCents' })
  })
})

describe('collisions, which every real file has', () => {
  it('does not put the stylist’s mobile on the client record', () => {
    /*
     * Both columns contain "phone". Only one of them is the client's, and
     * getting it wrong texts a salon's appointment reminders to its own staff.
     */
    expect(mapOf(['Client Phone', 'Stylist Phone'])).toMatchObject({
      'Client Phone': 'phone',
    })
    expect(mapOf(['Client Phone', 'Stylist Phone'])['Stylist Phone']).not.toBe('phone')
  })

  it('never fills one field from two columns', () => {
    const fields = inferColumns(['Name', 'Client Name', 'Customer Name']).map((c) => c.field)
    expect(fields.filter((f) => f === 'fullName')).toHaveLength(1)
  })

  it('never reads one column as two fields', () => {
    const indexes = inferColumns(['Client Name', 'Client Notes', 'Client Email']).map(
      (c) => c.index,
    )
    expect(new Set(indexes).size).toBe(indexes.length)
  })

  it('prefers separate name columns over the combined one', () => {
    /*
     * An export with First, Last AND Name is common. Splitting the combined
     * field would throw away the one the exporter was sure about.
     */
    expect(mapOf(['First Name', 'Last Name'])).toEqual({
      'First Name': 'firstName',
      'Last Name': 'lastName',
    })
  })

  it('returns matches in the order the columns appear', () => {
    const matches = inferColumns(['Date', 'Name', 'Phone', 'Service'])
    expect(matches.map((c) => c.index)).toEqual([0, 1, 2, 3])
  })
})

describe('a whole export header row', () => {
  it('reads a Vagaro-shaped one without a single question', () => {
    expect(
      mapOf([
        'Customer Name',
        'Phone',
        'Email',
        'Appointment Date',
        'Start Time',
        'Service',
        'Provider',
        'Duration',
        'Total',
        'Status',
      ]),
    ).toEqual({
      'Customer Name': 'fullName',
      Phone: 'phone',
      Email: 'email',
      'Appointment Date': 'appointmentDate',
      'Start Time': 'appointmentTime',
      Service: 'serviceName',
      Provider: 'stylistName',
      Duration: 'durationMin',
      Total: 'priceCents',
      Status: 'appointmentStatus',
    })
  })

  it('knows what Fresha and Square call the person who did the work', () => {
    // "Team member" is not a synonym anyone would guess, and it is the column
    // that assigns every appointment to a stylist.
    expect(mapOf(['Team member'])).toEqual({ 'Team member': 'stylistName' })
  })
})

describe('status words, which is the only thing a platform name really buys', () => {
  it('reads the vocabulary of each platform', () => {
    expect(mapStatus('Cancelled', platformProfile('FRESHA'))).toBe('CANCELLED')
    expect(mapStatus('No Show', platformProfile('VAGARO'))).toBe('NO_SHOW')
    expect(mapStatus('Checked Out', platformProfile('VAGARO'))).toBe('COMPLETED')
    expect(mapStatus('Canceled', platformProfile('SQUARE'))).toBe('CANCELLED')
  })

  it('calls a no-show a no-show even when the word cancelled is also there', () => {
    /*
     * Several platforms write "Cancelled (No Show)". Counting that as an
     * ordinary cancellation hides the client's actual attendance record, which
     * is the one thing a no-show history is for.
     */
    expect(mapStatus('Cancelled (No Show)', platformProfile('GENERIC'))).toBe('NO_SHOW')
  })

  it('treats anything it does not recognise as history that happened', () => {
    /*
     * An imported row IS history, and the overwhelming majority of history is
     * appointments that took place. Defaulting the other way shows a salon a
     * client with forty cancellations and no visits.
     */
    expect(mapStatus('', platformProfile('GENERIC'))).toBe('COMPLETED')
    expect(mapStatus('Closed - paid in full', platformProfile('GENERIC'))).toBe('COMPLETED')
  })

  it('gives every platform a profile, and an unknown name the generic one', () => {
    for (const profile of PLATFORMS) {
      expect(platformProfile(profile.platform).platform).toBe(profile.platform)
      expect(profile.label).not.toBe('')
    }
    expect(platformProfile('GENERIC').dateOrder).toBeNull()
    // Vagaro exports month-first whatever the salon's own locale is, which is
    // the single most common way a Vagaro import lands in the wrong months.
    expect(platformProfile('VAGARO').dateOrder).toBe('MDY')
  })
})
