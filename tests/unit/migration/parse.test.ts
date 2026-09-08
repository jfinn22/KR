import { describe, expect, it } from 'vitest'
import { parseImport, summarise } from '@/domain/migration/parse'

/**
 * A whole file, end to end.
 *
 * These are the shapes the four platforms actually export. A salon's entire
 * history goes through this function once and there is no second pass, so what
 * matters here is not that the happy path works — it is that the file which
 * cannot be read honestly says so, on the row it went wrong.
 */

const VAGARO = [
  'Customer Name,Phone,Email,Appointment Date,Start Time,Service,Provider,Duration,Total,Status',
  '"Rivera, Ada",+447700900123,Ada@Example.com,03/04/2024,2:30 PM,Balayage,Nina,180,$285.00,Completed',
  '"Chen, Bea",+447700900456,bea@example.com,12/25/2024,9:00 AM,Root Touch-Up,Nina,90,$95.00,No Show',
].join('\n')

const FRESHA = [
  'Client,Mobile,Date,Time,Service,Team member,Price,Status,Loyalty Points',
  'Ada Rivera,07700 900123,03/04/2024,14:30,Balayage,Nina,£285,Completed,120',
  'Bea Chen,07700 900456,13/04/2024,09:00,Toner,Jo,£45,Cancelled,0',
].join('\n')

describe('a Vagaro export', () => {
  const result = parseImport(VAGARO, { platform: 'VAGARO' })

  it('resolves the date order from the file itself, not from the platform', () => {
    /*
     * 12/25/2024 has no 25th month, so the file proves it is month-first. The
     * platform's habit is only the fallback — a salon that has re-exported
     * through a spreadsheet in another locale is exactly the case where
     * trusting the platform name loses a year of history.
     */
    expect(result.dateOrder).toBe('MDY')
    expect(result.dateOrderAmbiguous).toBe(false)
    expect(result.rows[0]?.appointmentDate).toBe('2024-03-04')
    expect(result.rows[1]?.appointmentDate).toBe('2024-12-25')
  })

  it('reads a row completely', () => {
    expect(result.rows[0]).toMatchObject({
      line: 2,
      firstName: 'Ada',
      lastName: 'Rivera',
      email: 'ada@example.com',
      phone: '+447700900123',
      appointmentTimeMin: 870,
      serviceName: 'Balayage',
      stylistName: 'Nina',
      durationMin: 180,
      priceCents: 28500,
      status: 'COMPLETED',
      problems: [],
    })
  })

  it('numbers rows the way the owner will count them', () => {
    // The header is line 1, so "row 3 is wrong" means the same thing in the
    // review screen and in Excel.
    expect(result.rows.map((row) => row.line)).toEqual([2, 3])
  })

  it('reads the platform’s own word for a missed appointment', () => {
    expect(result.rows[1]?.status).toBe('NO_SHOW')
  })

  it('collects the names that need one decision each', () => {
    expect(result.serviceNames).toEqual(['Balayage', 'Root Touch-Up'])
    expect(result.stylistNames).toEqual(['Nina'])
  })
})

describe('a Fresha export', () => {
  const result = parseImport(FRESHA, { platform: 'FRESHA', defaultCallingCode: '44' })

  it('reads day-first dates, proven by the file', () => {
    expect(result.dateOrder).toBe('DMY')
    expect(result.rows.map((row) => row.appointmentDate)).toEqual(['2024-04-03', '2024-04-13'])
  })

  it('turns a national mobile into something the SMS port will accept', () => {
    expect(result.rows.map((row) => row.phone)).toEqual(['+447700900123', '+447700900456'])
  })

  it('splits a plain full name', () => {
    expect(result.rows[0]).toMatchObject({ firstName: 'Ada', lastName: 'Rivera' })
  })

  it('says which column it did not recognise rather than dropping it quietly', () => {
    // Data silently thrown away during a migration is the one thing nobody
    // ever catches.
    expect(result.unmappedHeaders).toEqual(['Loyalty Points'])
    expect(summarise(result).warnings.join(' ')).toContain('Loyalty Points')
  })

  it('reads a cancellation as one', () => {
    expect(result.rows[1]?.status).toBe('CANCELLED')
  })
})

describe('the dates nothing in the file settles', () => {
  const AMBIGUOUS = [
    'Name,Phone,Date',
    'Ada,+447700900123,03/04/2024',
    'Bea,+447700900456,05/06/2024',
  ].join('\n')

  it('refuses to proceed rather than picking a side', () => {
    /*
     * Every one of these could be either way round, and getting it wrong moves
     * a salon's whole history by up to eleven months. This is the one question
     * the importer must ask.
     */
    const result = parseImport(AMBIGUOUS)
    expect(result.dateOrderAmbiguous).toBe(true)
    expect(summarise(result).blockers.join(' ')).toContain('day-first or month-first')
  })

  it('stops asking once the owner has answered', () => {
    const result = parseImport(AMBIGUOUS, { dateOrder: 'MDY' })
    expect(result.dateOrderAmbiguous).toBe(false)
    expect(result.rows[0]?.appointmentDate).toBe('2024-03-04')
    expect(summarise(result).blockers).toEqual([])
  })

  it('does not ask at all about a file with no dates in it', () => {
    // A client list is not an appointment history, and asking about its date
    // order is a question with no answer.
    const clients = parseImport('Name,Email\nAda Rivera,ada@example.com')
    expect(clients.dateOrderAmbiguous).toBe(false)
    expect(summarise(clients).blockers).toEqual([])
  })
})

describe('rows that are wrong', () => {
  const result = parseImport(
    [
      'First Name,Last Name,Phone,Email,Date',
      'Ada,Rivera,not a phone,ada@example.com,03/04/2024',
      'Bea,Chen,+447700900456,bea at example dot com,13/04/2024',
      'Cleo,Diaz,+447700900789,cleo@example.com,31/02/2024',
    ].join('\n'),
    { defaultCallingCode: '44' },
  )

  it('keeps the row and says what it could not read', () => {
    /*
     * Dropping it would hide the fact that four hundred phone numbers failed.
     * An import that silently loses a tenth of a salon's clients is worse than
     * one that refuses outright.
     */
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]?.phone).toBeNull()
    expect(result.rows[0]?.problems.join(' ')).toContain('not a phone')
  })

  it('names the row by the line the owner will look at', () => {
    expect(result.rows[1]).toMatchObject({ line: 3, email: null })
    expect(result.rows[1]?.problems.join(' ')).toContain('does not look like an email')
  })

  it('refuses a date that never happened instead of rolling it into March', () => {
    expect(result.rows[2]?.appointmentDate).toBeNull()
    expect(result.rows[2]?.problems.join(' ')).toContain('31/02/2024')
    // No date, so no status — a row that is not an appointment must not import
    // as a completed one.
    expect(result.rows[2]?.status).toBeNull()
  })

  it('counts them, without stopping the import', () => {
    const summary = summarise(result)
    expect(summary.rowsWithProblems).toBe(3)
    expect(summary.blockers).toEqual([])
    expect(summary.warnings.join(' ')).toContain('3 rows have something we could not read')
  })
})

describe('files that should not be imported', () => {
  it('says so when there is nothing under the header', () => {
    expect(summarise(parseImport('Name,Phone,Date\n')).blockers.join(' ')).toContain('no rows')
  })

  it('says so when the file is not a client list at all', () => {
    // The wrong report, exported by mistake. Saying so beats importing four
    // thousand blanks.
    const summary = summarise(parseImport('Loyalty Points,Referral Source\n120,Instagram'))
    expect(summary.usableClients).toBe(0)
    expect(summary.blockers.join(' ')).toContain('right report')
  })

  it('is not an empty file just because it has no header', () => {
    expect(summarise(parseImport('')).blockers.join(' ')).toContain('no rows')
  })
})

describe('what makes a row usable', () => {
  it('counts a client as usable only if they can be contacted', () => {
    /*
     * A name with no phone and no email is history, not a client — nothing can
     * ever be sent to them, and counting them inflates what the owner thinks
     * they are getting.
     */
    const result = parseImport(
      [
        'Name,Phone,Email,Date',
        'Ada Rivera,+447700900123,,03/04/2024',
        'Bea Chen,,bea@example.com,13/04/2024',
        'Cleo Diaz,,,14/04/2024',
      ].join('\n'),
    )
    const summary = summarise(result)
    expect(summary.totalRows).toBe(3)
    expect(summary.usableClients).toBe(2)
    expect(summary.usableAppointments).toBe(3)
  })

  it('prefers separate name columns to the combined one when a file has both', () => {
    const result = parseImport('Name,First Name,Last Name\nWrong Person,Ada,van der Berg')
    expect(result.rows[0]).toMatchObject({ firstName: 'Ada', lastName: 'van der Berg' })
  })
})
