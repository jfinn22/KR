import { AdapterError, mockId, requireEnv } from './types'

/**
 * Calendar sync. Two-way with Google; read-only via an iCal feed for everything
 * else, which covers Apple Calendar without an OAuth dance.
 */

export interface CalendarEvent {
  externalId?: string
  title: string
  description?: string
  location?: string
  startsAt: Date
  endsAt: Date
  /** Our appointment id, so a pulled event can be matched back. */
  reference: string
}

export interface BusyInterval {
  startsAt: Date
  endsAt: Date
}

export interface CalendarPort {
  readonly name: string
  push(calendarId: string, event: CalendarEvent): Promise<{ externalId: string }>
  remove(calendarId: string, externalId: string): Promise<void>
  /** External commitments the salon does not know about, so we avoid them. */
  pullBusy(calendarId: string, from: Date, to: Date): Promise<BusyInterval[]>
}

function assertRange(port: string, startsAt: Date, endsAt: Date): void {
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new AdapterError(port, 'INVALID_RANGE', 'startsAt is not a valid date.')
  }
  if (endsAt <= startsAt) {
    throw new AdapterError(port, 'INVALID_RANGE', 'endsAt must be after startsAt.')
  }
}

/** RFC 5545 feed. Pure string building — no adapter needed. */
export function buildIcsFeed(
  calendarName: string,
  events: readonly CalendarEvent[],
  domain = 'salon-intelligence.local',
): string {
  const stamp = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  const escape = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Salon Intelligence//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(calendarName)}`,
  ]

  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.reference}@${domain}`,
      `DTSTAMP:${stamp(new Date(0))}`,
      `DTSTART:${stamp(event.startsAt)}`,
      `DTEND:${stamp(event.endsAt)}`,
      `SUMMARY:${escape(event.title)}`,
      ...(event.description ? [`DESCRIPTION:${escape(event.description)}`] : []),
      ...(event.location ? [`LOCATION:${escape(event.location)}`] : []),
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  // iCal requires CRLF line endings; some clients silently reject LF-only.
  return lines.join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------------------

export class MockCalendarAdapter implements CalendarPort {
  readonly name = 'calendar:mock'

  readonly log: { action: 'push' | 'remove'; calendarId: string; externalId: string }[] = []
  private readonly events = new Map<string, CalendarEvent & { externalId: string }>()

  async push(calendarId: string, event: CalendarEvent): Promise<{ externalId: string }> {
    assertRange(this.name, event.startsAt, event.endsAt)
    const externalId = event.externalId ?? mockId('evt', calendarId, event.reference)
    this.events.set(externalId, { ...event, externalId })
    this.log.push({ action: 'push', calendarId, externalId })
    return { externalId }
  }

  async remove(calendarId: string, externalId: string): Promise<void> {
    this.events.delete(externalId)
    this.log.push({ action: 'remove', calendarId, externalId })
  }

  async pullBusy(_calendarId: string, from: Date, to: Date): Promise<BusyInterval[]> {
    assertRange(this.name, from, to)
    return [...this.events.values()]
      .filter((e) => e.endsAt > from && e.startsAt < to)
      .map((e) => ({ startsAt: e.startsAt, endsAt: e.endsAt }))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  }
}

export class GoogleCalendarAdapter implements CalendarPort {
  readonly name = 'calendar:google'

  constructor(
    private readonly clientId?: string,
    private readonly clientSecret?: string,
    private readonly refreshToken?: string,
  ) {}

  private async client() {
    requireEnv('calendar', {
      GOOGLE_CLIENT_ID: this.clientId,
      GOOGLE_CLIENT_SECRET: this.clientSecret,
    })
    const { google } = await import('googleapis')
    const auth = new google.auth.OAuth2(this.clientId, this.clientSecret)
    auth.setCredentials({ refresh_token: this.refreshToken })
    return google.calendar({ version: 'v3', auth })
  }

  async push(calendarId: string, event: CalendarEvent): Promise<{ externalId: string }> {
    assertRange(this.name, event.startsAt, event.endsAt)
    const calendar = await this.client()
    const body = {
      summary: event.title,
      description: event.description,
      location: event.location,
      start: { dateTime: event.startsAt.toISOString() },
      end: { dateTime: event.endsAt.toISOString() },
      extendedProperties: { private: { salonReference: event.reference } },
    }

    const res = event.externalId
      ? await calendar.events.update({ calendarId, eventId: event.externalId, requestBody: body })
      : await calendar.events.insert({ calendarId, requestBody: body })

    return { externalId: res.data.id! }
  }

  async remove(calendarId: string, externalId: string): Promise<void> {
    const calendar = await this.client()
    await calendar.events.delete({ calendarId, eventId: externalId })
  }

  async pullBusy(calendarId: string, from: Date, to: Date): Promise<BusyInterval[]> {
    assertRange(this.name, from, to)
    const calendar = await this.client()
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: calendarId }],
      },
    })
    const busy = res.data.calendars?.[calendarId]?.busy ?? []
    return busy.map((b) => ({ startsAt: new Date(b.start!), endsAt: new Date(b.end!) }))
  }
}
