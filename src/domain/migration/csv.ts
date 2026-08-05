/**
 * Reading a CSV somebody else's software wrote.
 *
 * Hand-written rather than a dependency, for one reason: this is the actual
 * risk surface. A salon's whole history arrives through this function, once,
 * and every real-world export is subtly broken — a client note containing a
 * comma, an address containing a newline, a name containing a quote, a file
 * saved by Excel on a Mac in 2014. A library would handle all of that too, but
 * it would handle it somewhere I cannot read, and when a salon's import comes
 * out wrong the question is always "which row, and why".
 *
 * So: RFC 4180, implemented in one pass, with the four deviations that matter
 * in practice and are documented where they happen. Fully pure, so a broken
 * export can be turned into a failing test in one line.
 *
 * What it deliberately does NOT do: infer types, trim values, or skip blank
 * lines silently. Every one of those is a decision that belongs to whoever
 * knows what the column means, and a parser that quietly "helps" is how a
 * phone number becomes 7.7712e+9.
 */

export interface CsvTable {
  /** The first row, verbatim. Empty when the file had no rows at all. */
  header: string[]
  /** Every subsequent row. Ragged rows are preserved as-is, not padded. */
  rows: string[][]
}

/**
 * The separator, worked out from the file rather than assumed.
 *
 * A "CSV" exported in a European locale is usually semicolon-separated,
 * because the comma is the decimal point there. Guessing wrong produces one
 * enormous column and an owner who thinks the platform cannot read their file.
 *
 * Decided on the header line only, and by counting separators OUTSIDE quotes —
 * a header of `"Last, First",Phone` has one real comma and one that is part of
 * a value, and counting naively picks the wrong winner.
 */
export function sniffDelimiter(text: string): string {
  const firstLine = firstUnquotedLine(text)
  const candidates = [',', ';', '\t', '|']

  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    const count = countUnquoted(firstLine, candidate)
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

export function parseCsv(text: string, delimiter?: string): CsvTable {
  const sep = delimiter ?? sniffDelimiter(text)
  const rows = parseRows(stripBom(text), sep)

  const header = rows.shift() ?? []
  return { header, rows }
}

/**
 * One pass, character by character.
 *
 * A regex cannot do this: a quoted field may contain the delimiter, a newline,
 * and escaped quotes, and no regular language covers that. The state is two
 * booleans, which is small enough to reason about completely.
 */
function parseRows(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let sawAnyContent = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote — the
        // only escape RFC 4180 has.
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') {
      /*
       * Only opens a quoted field at the START of one. Excel writes
       * `5" heels` unquoted, and treating that quote as an opener swallows the
       * rest of the file into one field — which is exactly the failure that
       * looks like "the platform lost my data".
       */
      inQuotes = true
      sawAnyContent = true
      continue
    }

    if (char === sep) {
      row.push(field)
      field = ''
      sawAnyContent = true
      continue
    }

    if (char === '\r') {
      // CRLF, and also a lone CR from a very old Mac export.
      if (text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      sawAnyContent = false
      continue
    }

    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      sawAnyContent = false
      continue
    }

    field += char
    sawAnyContent = true
  }

  // A file not ending in a newline still has a last row.
  if (field !== '' || row.length > 0 || sawAnyContent) {
    row.push(field)
    rows.push(row)
  }

  /*
   * Trailing blank lines are dropped; interior ones are not.
   *
   * Almost every export ends with a newline, which would otherwise produce a
   * final row of one empty string that then fails validation as "a client with
   * no name". An interior blank line is different — it might mean a section
   * break in a hand-edited file, and silently dropping rows from the middle of
   * somebody's data is not a parser's decision to make.
   */
  while (rows.length > 0 && isBlank(rows[rows.length - 1]!)) rows.pop()

  return rows
}

/** Excel writes one, and it turns the first header into `﻿Name`. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function isBlank(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

/** The header, however many embedded newlines its quoted fields contain. */
function firstUnquotedLine(text: string): string {
  const clean = stripBom(text)
  let inQuotes = false
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!
    if (char === '"') inQuotes = !inQuotes
    else if (!inQuotes && (char === '\n' || char === '\r')) return clean.slice(0, i)
  }
  return clean
}

function countUnquoted(line: string, char: string): number {
  let inQuotes = false
  let count = 0
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes
    else if (!inQuotes && c === char) count += 1
  }
  return count
}

/**
 * Rows as objects, keyed by header.
 *
 * Ragged rows are the norm, not the exception: a trailing empty column gets
 * dropped by half the exporters in existence. A short row yields empty strings
 * for the missing columns rather than `undefined`, so every consumer can treat
 * a missing value and an empty value the same way — which they are, coming
 * from a spreadsheet.
 *
 * A LONG row keeps its overflow under numeric keys rather than discarding it.
 * Data silently thrown away during a migration is the one thing nobody ever
 * catches, and an unmapped extra column is at least visible in the review.
 */
export function toRecords(table: CsvTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const record: Record<string, string> = {}
    for (const [index, key] of table.header.entries()) {
      record[key] = row[index] ?? ''
    }
    for (let index = table.header.length; index < row.length; index += 1) {
      record[`column${index + 1}`] = row[index] ?? ''
    }
    return record
  })
}
