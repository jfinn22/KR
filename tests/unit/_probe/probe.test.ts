import { describe, it, expect } from 'vitest'
import { parsePhone, parseTimeOfDay, parseMoneyCents } from '@/domain/migration/normalise'
import { parseCsv, toRecords } from '@/domain/migration/csv'
import { parseImport } from '@/domain/migration/parse'

describe('probe', () => {
  it('phone', () => {
    console.log('00 prefix:', parsePhone('0044 7700 900123', '44'))
    console.log('(0) form:', parsePhone('+44 (0)7700 900123', '44'))
    console.log('cc no plus:', parsePhone('1-415-555-2671', '1'))
    console.log('plain uk:', parsePhone('07700 900123', '44'))
  })
  it('dup headers', () => {
    const t = 'Client,Phone,Date,Phone\nAda Rivera,07700 900123,03/04/2024,\n'
    console.log(JSON.stringify(toRecords(parseCsv(t))))
    const p = parseImport(t, { defaultCallingCode: '44' })
    console.log('phone parsed as:', p.rows[0]?.phone, 'problems:', p.rows[0]?.problems)
  })
  it('time default', () => {
    console.log('14h30 ->', parseTimeOfDay('14h30'))
    const t = 'Client,Phone,Date,Time,Team member\nAda,07700 900123,03/04/2024,14h30,Wren\n'
    const p = parseImport(t, { defaultCallingCode: '44' })
    console.log('row:', JSON.stringify(p.rows[0]))
  })
  it('split identity', () => {
    const t = [
      'Client,Mobile,Email,Date,Time,Service,Team member,Price,Status',
      'Ada Rivera,07700 900123,ada@example.com,03/04/2024,14:30,Balayage,Wren,285,Completed',
      'Ada Rivera,,,13/04/2024,09:00,Toner,Wren,45,Completed',
    ].join('\n')
    const p = parseImport(t, { platform: 'FRESHA', defaultCallingCode: '44' })
    console.log(p.rows.map((r) => ({ line: r.line, phone: r.phone, email: r.email, first: r.firstName, last: r.lastName, status: r.status })))
  })
  it('future status', () => {
    const t = [
      'Client,Mobile,Date,Time,Service,Team member,Price,Status',
      'Cy Okafor,07700 900999,01/09/2026,15:00,Balayage,Wren,285,Confirmed',
    ].join('\n')
    const p = parseImport(t, { platform: 'FRESHA', defaultCallingCode: '44' })
    console.log('future row status:', p.rows[0]?.status, p.rows[0]?.appointmentDate)
  })
})
