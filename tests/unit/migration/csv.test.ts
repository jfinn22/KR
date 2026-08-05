import { describe, expect, it } from 'vitest'
import { parseCsv, sniffDelimiter, toRecords } from '@/domain/migration/csv'

/**
 * Reading a CSV somebody else's software wrote.
 *
 * Every case here is a real shape a real export produces. A salon's whole
 * history goes through this once, and the failures are not theoretical: a
 * comma in a client note, a newline in an address, a file Excel saved with a
 * byte-order mark. Each one has cost somebody their data somewhere.
 */

describe('the shape of the file', () => {
  it('reads a plain one', () => {
    const table = parseCsv('Name,Phone\nAda,07700 900123\nBea,07700 900456')

    expect(table.header).toEqual(['Name', 'Phone'])
    expect(table.rows).toEqual([
      ['Ada', '07700 900123'],
      ['Bea', '07700 900456'],
    ])
  })

  it('survives the byte-order mark Excel writes', () => {
    // Without stripping it the first header becomes "﻿Name" and nothing
    // matches it — a file that looks fine and imports nothing.
    const table = parseCsv('﻿Name,Phone\nAda,123')
    expect(table.header[0]).toBe('Name')
  })

  it('handles CRLF, and a lone CR from a very old export', () => {
    expect(parseCsv('A,B\r\n1,2\r\n3,4').rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
    expect(parseCsv('A,B\r1,2\r3,4').rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('does not invent a final blank row from the trailing newline', () => {
    // Almost every export ends with one, and the phantom row then fails
    // validation as "a client with no name".
    expect(parseCsv('A,B\n1,2\n').rows).toEqual([['1', '2']])
  })

  it('keeps an interior blank line rather than silently dropping rows', () => {
    // Dropping rows from the middle of somebody's data is not a parser's
    // decision to make.
    expect(parseCsv('A,B\n1,2\n\n3,4\n').rows).toHaveLength(3)
  })
})

describe('quoting, which is where every parser dies', () => {
  it('keeps a comma inside a quoted field', () => {
    const table = parseCsv('Name,Notes\n"Rivera, Ada","Allergic to PPD, use the other line"')
    expect(table.rows[0]).toEqual(['Rivera, Ada', 'Allergic to PPD, use the other line'])
  })

  it('keeps a newline inside a quoted field', () => {
    // An address column does this constantly.
    const table = parseCsv('Name,Address\nAda,"12 High Street\nManchester"')
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]![1]).toBe('12 High Street\nManchester')
  })

  it('unescapes a doubled quote', () => {
    const table = parseCsv('Name,Notes\nAda,"She calls it ""the copper one"""')
    expect(table.rows[0]![1]).toBe('She calls it "the copper one"')
  })

  it('does not treat a mid-field quote as an opener', () => {
    /*
     * `5" heels` is not a quoted field. Treating that quote as an opener
     * swallows the rest of the file into one cell — the failure that looks
     * exactly like "the platform lost my data".
     */
    const table = parseCsv('A,B\nwears 5" heels,kept\nsecond,row')
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]).toEqual(['wears 5" heels', 'kept'])
  })
})

describe('the separator', () => {
  it('finds a semicolon file, which is what a European locale exports', () => {
    // Guessing comma here produces one enormous column and an owner who
    // thinks the platform cannot read their file.
    expect(sniffDelimiter('Name;Phone;Email')).toBe(';')
    expect(parseCsv('Name;Phone\nAda;123').rows[0]).toEqual(['Ada', '123'])
  })

  it('finds a tab file', () => {
    expect(sniffDelimiter('Name\tPhone')).toBe('\t')
  })

  it('is not fooled by a comma inside a quoted header', () => {
    // `"Last, First";Phone` has one real separator and one that is part of a
    // value, and counting naively picks the wrong winner.
    expect(sniffDelimiter('"Last, First";Phone;Email')).toBe(';')
  })

  it('defaults to a comma when nothing separates anything', () => {
    expect(sniffDelimiter('JustOneColumn')).toBe(',')
  })
})

describe('rows as records', () => {
  it('fills a short row with empty strings rather than undefined', () => {
    /*
     * Ragged rows are the norm: half the exporters in existence drop a
     * trailing empty column. A missing value and an empty value are the same
     * thing coming from a spreadsheet, and every consumer should be able to
     * treat them that way.
     */
    const records = toRecords(parseCsv('A,B,C\n1,2'))
    expect(records[0]).toEqual({ A: '1', B: '2', C: '' })
  })

  it('keeps the overflow of a long row rather than discarding it', () => {
    // Data silently thrown away during a migration is the one thing nobody
    // ever catches.
    const records = toRecords(parseCsv('A,B\n1,2,3'))
    expect(records[0]).toMatchObject({ A: '1', B: '2', column3: '3' })
  })

  it('does not trim, because a parser that helps is how a phone loses a plus', () => {
    const records = toRecords(parseCsv('A\n" +44 7700 900123 "'))
    expect(records[0]!.A).toBe(' +44 7700 900123 ')
  })
})

describe('files that are barely files', () => {
  it('an empty string is an empty table, not a crash', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] })
  })

  it('a header with no rows is a header with no rows', () => {
    const table = parseCsv('Name,Phone\n')
    expect(table.header).toEqual(['Name', 'Phone'])
    expect(table.rows).toEqual([])
  })
})

describe('headers that repeat', () => {
  it('does not let the second one erase the first', () => {
    /*
     * Two columns called "Notes" is ordinary: one is the client's and one is
     * the visit's, and the export named them the same. Keyed naively the second
     * overwrites the first and a populated column vanishes with nothing to say
     * it did — the one failure nobody ever catches during a migration.
     */
    const records = toRecords(parseCsv('Notes,Notes\nallergic to PPD,went well'))
    expect(records[0]).toEqual({ Notes: 'allergic to PPD', 'Notes (2)': 'went well' })
  })

  it('leaves the first occurrence alone, so column matching still works', () => {
    const records = toRecords(parseCsv('Phone,Phone\n123,456'))
    expect(records[0]!.Phone).toBe('123')
  })
})
