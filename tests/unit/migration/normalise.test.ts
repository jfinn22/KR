import { describe, expect, it } from 'vitest'
import {
  parseBoolean,
  parseDate,
  parseDurationMin,
  parseEmail,
  parseMoneyCents,
  parseName,
  parsePhone,
  parseTimeOfDay,
  sniffDateOrder,
} from '@/domain/migration/normalise'

/**
 * Turning what a spreadsheet says into what the database means.
 *
 * The rule these all share: parse confidently where the answer is
 * unambiguous, return null where it is not, and never invent a default. A
 * migration that guesses is worse than one that asks — a wrong phone number is
 * a client who never hears from the salon again.
 */

describe('the ambiguity nobody escapes', () => {
  it('resolves a whole column from one unambiguous row', () => {
    /*
     * 03/04/2024 is a coin flip. A column containing 13/04/2024 is not: no
     * month is 13, so the file is day-first, and every other row inherits that.
     */
    expect(sniffDateOrder(['03/04/2024', '13/04/2024'])).toBe('DMY')
    expect(sniffDateOrder(['03/04/2024', '04/13/2024'])).toBe('MDY')
  })

  it('says nothing when a file genuinely could be either', () => {
    // Getting this wrong moves a salon's entire history by up to eleven
    // months, so the honest answer is to ask.
    expect(sniffDateOrder(['03/04/2024', '05/06/2024', '07/08/2024'])).toBeNull()
  })

  it('recognises ISO outright, because it is unambiguous by construction', () => {
    expect(sniffDateOrder(['2024-04-03', '2024-11-30'])).toBe('ISO')
  })

  it('reads a date both ways round on request', () => {
    expect(parseDate('03/04/2024', 'DMY')).toBe('2024-04-03')
    expect(parseDate('03/04/2024', 'MDY')).toBe('2024-03-04')
  })

  it('reads ISO, dotted and named forms', () => {
    expect(parseDate('2024-04-03')).toBe('2024-04-03')
    expect(parseDate('03.04.2024', 'DMY')).toBe('2024-04-03')
    expect(parseDate('3 April 2024')).toBe('2024-04-03')
    expect(parseDate('April 3, 2024')).toBe('2024-04-03')
  })

  it('refuses a date that does not exist rather than rolling it forward', () => {
    /*
     * A rolled date is a real-looking appointment on a day it never happened,
     * which is worse than a row the owner has to look at.
     */
    expect(parseDate('31/02/2024', 'DMY')).toBeNull()
    expect(parseDate('30/02/2024', 'DMY')).toBeNull()
    // And it knows which Februaries have 29 days.
    expect(parseDate('29/02/2024', 'DMY')).toBe('2024-02-29')
    expect(parseDate('29/02/2023', 'DMY')).toBeNull()
  })

  it('expands a two-digit year the only way salon history allows', () => {
    // Appointments are in the past or near future; a date of birth can be in
    // the nineteen-hundreds.
    expect(parseDate('03/04/24', 'DMY')).toBe('2024-04-03')
    expect(parseDate('03/04/98', 'DMY')).toBe('1998-04-03')
  })

  it('returns nothing rather than a guess for anything else', () => {
    expect(parseDate('')).toBeNull()
    expect(parseDate('last Tuesday')).toBeNull()
    expect(parseDate('n/a')).toBeNull()
  })
})

describe('times', () => {
  it('reads 24-hour and 12-hour', () => {
    expect(parseTimeOfDay('14:30')).toBe(870)
    expect(parseTimeOfDay('2:30 PM')).toBe(870)
    expect(parseTimeOfDay('2:30pm')).toBe(870)
    expect(parseTimeOfDay('9:00 AM')).toBe(540)
  })

  it('knows midnight and noon, which is where 12-hour clocks break', () => {
    expect(parseTimeOfDay('12:00 AM')).toBe(0)
    expect(parseTimeOfDay('12:00 PM')).toBe(720)
  })

  it('refuses nonsense', () => {
    expect(parseTimeOfDay('25:00')).toBeNull()
    expect(parseTimeOfDay('10:75')).toBeNull()
    expect(parseTimeOfDay('morning')).toBeNull()
  })
})

describe('money, in every shape an export writes it', () => {
  it('reads a currency symbol on either side', () => {
    expect(parseMoneyCents('$45.00')).toBe(4500)
    expect(parseMoneyCents('£45')).toBe(4500)
    expect(parseMoneyCents('45,00 €')).toBe(4500)
  })

  it('tells a thousands separator from a decimal point', () => {
    // Whichever appears last is the decimal: 1.234,56 is European.
    expect(parseMoneyCents('1,234.56')).toBe(123456)
    expect(parseMoneyCents('1.234,56')).toBe(123456)
    // One separator, three digits after: thousands.
    expect(parseMoneyCents('1,234')).toBe(123400)
    // One separator, two digits after: a decimal.
    expect(parseMoneyCents('1,23')).toBe(123)
  })

  it('reads accounting parentheses as the refund they are', () => {
    // Reading it as positive would inflate a salon's imported takings.
    expect(parseMoneyCents('(45.00)')).toBe(-4500)
    expect(parseMoneyCents('-45.00')).toBe(-4500)
  })

  it('returns nothing for text', () => {
    expect(parseMoneyCents('free')).toBeNull()
    expect(parseMoneyCents('')).toBeNull()
  })
})

describe('phone numbers, which the SMS port will refuse if we get them wrong', () => {
  it('keeps an E.164 number as it is', () => {
    expect(parsePhone('+44 7700 900123', '44')).toBe('+447700900123')
    // Already international, so it does not matter what the default is.
    expect(parsePhone('+1 415 555 0123', '44')).toBe('+14155550123')
  })

  it('refuses a country code where a calling code was wanted', () => {
    /*
     * "GB" strips to nothing, and `+` plus a national number is ten
     * valid-looking digits belonging to somebody else entirely. A caller who
     * gets this wrong should see no numbers rather than wrong ones.
     */
    expect(parsePhone('07700 900123', 'GB')).toBeNull()
  })

  it('drops the trunk zero when adding a country code', () => {
    expect(parsePhone('07700 900123', '44')).toBe('+447700900123')
    expect(parsePhone('(0161) 496 0123', '44')).toBe('+441614960123')
  })

  it('refuses a national number when nobody said which country', () => {
    /*
     * Assuming +1 is how a British salon's entire client list becomes
     * unreachable by SMS. Better to hand the owner a list to fix.
     */
    expect(parsePhone('07700 900123', null)).toBeNull()
  })

  it('refuses something too short to be a number', () => {
    expect(parsePhone('123', '44')).toBeNull()
    expect(parsePhone('ext 4', '44')).toBeNull()
  })
})

describe('email', () => {
  it('lower-cases and trims', () => {
    expect(parseEmail('  Ada@Example.COM ')).toBe('ada@example.com')
  })

  it('rejects obvious rubbish without adjudicating RFC 5322', () => {
    // A real address this rejects is a client lost, so it stays loose.
    expect(parseEmail('not an email')).toBeNull()
    expect(parseEmail('ada@')).toBeNull()
    expect(parseEmail('')).toBeNull()
    expect(parseEmail("o'brien+colour@sub.domain.co.uk")).toBe("o'brien+colour@sub.domain.co.uk")
  })
})

describe('names', () => {
  it('splits a plain two-word name', () => {
    expect(parseName('Ada Rivera')).toEqual({ firstName: 'Ada', lastName: 'Rivera' })
  })

  it('reads the comma form the other way round', () => {
    expect(parseName('Rivera, Ada')).toEqual({ firstName: 'Ada', lastName: 'Rivera' })
  })

  it('keeps a two-word surname together', () => {
    /*
     * Wrong about a middle name is cosmetic. Splitting "van der Berg" is a
     * client who cannot find themselves.
     */
    expect(parseName('Ada van der Berg')).toEqual({
      firstName: 'Ada',
      lastName: 'van der Berg',
    })
  })

  it('accepts a single name, because plenty of people have one on file', () => {
    expect(parseName('Cher')).toEqual({ firstName: 'Cher', lastName: null })
  })

  it('returns nothing for nothing', () => {
    expect(parseName('   ')).toBeNull()
  })
})

describe('the small ones', () => {
  it('reads whatever an export means by yes', () => {
    expect(parseBoolean('Y')).toBe(true)
    expect(parseBoolean('TRUE')).toBe(true)
    expect(parseBoolean('x')).toBe(true)
    expect(parseBoolean('0')).toBe(false)
    expect(parseBoolean('maybe')).toBeNull()
  })

  it('reads a duration however it is written', () => {
    expect(parseDurationMin('90')).toBe(90)
    expect(parseDurationMin('90 min')).toBe(90)
    expect(parseDurationMin('1:30')).toBe(90)
    expect(parseDurationMin('1h 30m')).toBe(90)
    expect(parseDurationMin('2 hours')).toBe(120)
    expect(parseDurationMin('a while')).toBeNull()
  })
})

describe('the number that already had its country code', () => {
  it('does not add it twice', () => {
    /*
     * Fresha and Booksy both export `447700900123` for a UK mobile. Adding the
     * code again produces +44447700900123 — fifteen digits, inside every length
     * check, and belonging to nobody. A silently wrong number is exactly the
     * failure this function exists to avoid.
     */
    expect(parsePhone('447700900123', '44')).toBe('+447700900123')
    expect(parsePhone('1 415 555 0123', '1')).toBe('+14155550123')
  })

  it('still adds it to a genuinely national number', () => {
    expect(parsePhone('07700 900123', '44')).toBe('+447700900123')
    expect(parsePhone('7700 900123', '44')).toBe('+447700900123')
  })
})
