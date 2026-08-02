import { describe, expect, it, beforeEach } from 'vitest'
import { z } from 'zod'

import { InMemoryMessageSink, AdapterError, AdapterNotConfiguredError, mockId } from '@/ports/types'
import { MockSmsAdapter, TwilioSmsAdapter, countSegments } from '@/ports/sms'
import { MockEmailAdapter, ResendEmailAdapter, htmlToText } from '@/ports/email'
import { MockPaymentsAdapter, StripePaymentsAdapter } from '@/ports/payments'
import { MockStorageAdapter, S3StorageAdapter, stripJpegMetadata } from '@/ports/storage'
import { MockAiAdapter, DisabledAiAdapter, AnthropicAiAdapter, assertRedacted } from '@/ports/ai'
import { MockCalendarAdapter, GoogleCalendarAdapter, buildIcsFeed } from '@/ports/calendar'
import { LocalEsignAdapter, hashDocument } from '@/ports/esign'

/**
 * Port contract suite.
 *
 * The point of these is drift: a mock that behaves differently from the real
 * adapter is worse than no mock, because it makes the whole product look tested
 * when it is not. Every behaviour asserted here is one both implementations
 * must honour.
 *
 * Runs in the UNIT tier, which has no database — which is precisely why the
 * sms/email mocks take an injectable sink rather than writing to DevOutbox.
 */

// ---------------------------------------------------------------------------
// SMS
// ---------------------------------------------------------------------------

describe('sms port', () => {
  let sink: InMemoryMessageSink
  let sms: MockSmsAdapter

  beforeEach(() => {
    sink = new InMemoryMessageSink()
    sms = new MockSmsAdapter(sink)
  })

  it('delivers to the sink and returns a provider id', async () => {
    const result = await sms.send({
      to: '+15551234567',
      body: 'Your appointment is tomorrow at 2pm.',
    })
    expect(result.providerMessageId).toMatch(/^sms_mock_/)
    expect(result.status).toBe('QUEUED')
    expect(sink.messages).toHaveLength(1)
    expect(sink.messages[0]).toMatchObject({ channel: 'SMS', to: '+15551234567' })
  })

  it('rejects a non-E.164 recipient', async () => {
    await expect(sms.send({ to: '5551234567', body: 'hi' })).rejects.toThrow(AdapterError)
    expect(sink.messages).toHaveLength(0)
  })

  it('rejects an empty body rather than sending whitespace', async () => {
    await expect(sms.send({ to: '+15551234567', body: '   ' })).rejects.toThrow(AdapterError)
  })

  it('is idempotent in the id it derives — same message, same id', async () => {
    const a = await sms.send({ to: '+15551234567', body: 'same' })
    const b = await sms.send({ to: '+15551234567', body: 'same' })
    expect(a.providerMessageId).toBe(b.providerMessageId)
  })

  it('counts segments the way a carrier bills them', () => {
    expect(countSegments('')).toBe(1)
    expect(countSegments('a'.repeat(160))).toBe(1)
    expect(countSegments('a'.repeat(161))).toBe(2)
    expect(countSegments('a'.repeat(306))).toBe(2)
    expect(countSegments('a'.repeat(307))).toBe(3)
  })

  it('the real adapter refuses to run without credentials, and says which', async () => {
    const real = new TwilioSmsAdapter(undefined, undefined, undefined)
    await expect(real.send({ to: '+15551234567', body: 'hi' })).rejects.toThrow(
      AdapterNotConfiguredError,
    )
  })
})

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

describe('email port', () => {
  let sink: InMemoryMessageSink
  let email: MockEmailAdapter

  beforeEach(() => {
    sink = new InMemoryMessageSink()
    email = new MockEmailAdapter(sink)
  })

  it('delivers with a plain-text alternative derived from the html', async () => {
    await email.send({
      to: 'client@example.com',
      subject: 'Your consultation',
      html: '<p>Hi Ada,</p><p>Your plan is ready.</p>',
    })
    expect(sink.messages[0]!.body).toBe('Hi Ada,\n\nYour plan is ready.')
  })

  it('rejects an invalid address', async () => {
    await expect(email.send({ to: 'nope', subject: 's', html: 'x' })).rejects.toThrow(AdapterError)
  })

  it('rejects an empty subject', async () => {
    await expect(email.send({ to: 'a@b.co', subject: '  ', html: 'x' })).rejects.toThrow(
      AdapterError,
    )
  })

  it('unescapes entities when producing text', () => {
    expect(htmlToText('<p>Tom &amp; Jerry&#39;s</p>')).toBe("Tom & Jerry's")
  })

  it('the real adapter refuses to run without credentials', async () => {
    const real = new ResendEmailAdapter(undefined)
    await expect(real.send({ to: 'a@b.co', subject: 's', html: 'x' })).rejects.toThrow(
      AdapterNotConfiguredError,
    )
  })
})

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('payments port', () => {
  let payments: MockPaymentsAdapter

  beforeEach(() => {
    payments = new MockPaymentsAdapter()
  })

  const deposit = {
    amountCents: 9500,
    currency: 'usd',
    captureMethod: 'manual' as const,
    idempotencyKey: 'dep-1',
  }

  it('authorises a deposit without capturing it', async () => {
    const intent = await payments.createIntent(deposit)
    expect(intent.status).toBe('REQUIRES_CAPTURE')
    expect(intent.capturedCents).toBe(0)
  })

  it('captures immediately when capture is automatic', async () => {
    const intent = await payments.createIntent({ ...deposit, captureMethod: 'automatic' })
    expect(intent.status).toBe('SUCCEEDED')
    expect(intent.capturedCents).toBe(9500)
  })

  // The behaviour that stops a double-tap becoming a double charge.
  it('replaying an idempotency key returns the original intent', async () => {
    const first = await payments.createIntent(deposit)
    const second = await payments.createIntent({ ...deposit, amountCents: 50_000 })
    expect(second.id).toBe(first.id)
    expect(second.amountCents).toBe(9500)
  })

  it('rejects a zero or negative amount', async () => {
    await expect(payments.createIntent({ ...deposit, amountCents: 0 })).rejects.toThrow(
      AdapterError,
    )
    await expect(payments.createIntent({ ...deposit, amountCents: -1 })).rejects.toThrow(
      AdapterError,
    )
  })

  it('refuses to capture more than was authorised', async () => {
    const intent = await payments.createIntent(deposit)
    await expect(payments.capture(intent.id, 20_000)).rejects.toThrow(/OVER_CAPTURE|more than/)
  })

  it('supports a partial capture', async () => {
    const intent = await payments.createIntent(deposit)
    const captured = await payments.capture(intent.id, 5000)
    expect(captured.capturedCents).toBe(5000)
    expect(captured.status).toBe('SUCCEEDED')
  })

  it('refunds only what was captured', async () => {
    const intent = await payments.createIntent({ ...deposit, captureMethod: 'automatic' })
    await expect(payments.refund(intent.id, 20_000, 'r1')).rejects.toThrow(/OVER_REFUND|exceeds/)
    const refund = await payments.refund(intent.id, 2500, 'r2')
    expect(refund.status).toBe('SUCCEEDED')
    expect(refund.amountCents).toBe(2500)
  })

  it('refunds are idempotent too', async () => {
    const intent = await payments.createIntent({ ...deposit, captureMethod: 'automatic' })
    const a = await payments.refund(intent.id, 1000, 'same-key')
    const b = await payments.refund(intent.id, 1000, 'same-key')
    expect(b.id).toBe(a.id)
  })

  it('cannot cancel a captured intent — that is a refund', async () => {
    const intent = await payments.createIntent({ ...deposit, captureMethod: 'automatic' })
    await expect(payments.cancel(intent.id)).rejects.toThrow(/INVALID_STATE|refund/)
  })

  it('verifies a webhook signature before trusting the payload', async () => {
    const event = { id: 'evt_1', type: 'payment_intent.succeeded', objectId: 'pi_1' }
    const { payload, signature } = MockPaymentsAdapter.synthesizeWebhook(event)

    await expect(payments.parseWebhook(payload, 'forged')).rejects.toThrow(/signature/i)
    expect(await payments.parseWebhook(payload, signature)).toMatchObject(event)
  })

  it('the real adapter refuses to run without credentials', async () => {
    const real = new StripePaymentsAdapter(undefined)
    await expect(real.createIntent(deposit)).rejects.toThrow(AdapterNotConfiguredError)
  })
})

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe('storage port', () => {
  const storage = new MockStorageAdapter()
  const jpeg = (extra: Buffer = Buffer.alloc(0)) =>
    Buffer.concat([
      Buffer.from([0xff, 0xd8]), // SOI
      extra,
      Buffer.from([0xff, 0xda, 0x00, 0x02]), // SOS
      Buffer.from('imagedata'),
    ])

  it('stores and retrieves an object', async () => {
    const body = jpeg()
    const stored = await storage.put({ key: 'test/a.jpg', body, contentType: 'image/jpeg' })
    expect(stored.sha256).toHaveLength(64)
    expect(await storage.get('test/a.jpg')).not.toBeNull()
    await storage.delete('test/a.jpg')
    expect(await storage.get('test/a.jpg')).toBeNull()
  })

  it('rejects an unsupported content type', async () => {
    await expect(
      storage.put({
        key: 'x.exe',
        body: Buffer.from('MZ'),
        contentType: 'application/x-msdownload',
      }),
    ).rejects.toThrow(AdapterError)
  })

  it('rejects a key that tries to traverse out of the root', async () => {
    await expect(
      storage.put({ key: '../escape.jpg', body: jpeg(), contentType: 'image/jpeg' }),
    ).rejects.toThrow(AdapterError)
  })

  it('rejects an empty object', async () => {
    await expect(
      storage.put({ key: 'e.jpg', body: Buffer.alloc(0), contentType: 'image/jpeg' }),
    ).rejects.toThrow(AdapterError)
  })

  // EXIF carries GPS. This is the single most important thing the port does.
  it('strips the EXIF segment from a JPEG', () => {
    // The APP1 length field counts itself plus the payload, so it must be
    // payload.length + 2 — get this wrong and the marker walk desynchronises.
    const payload = Buffer.from('Exif\0\0GPSDATA')
    const header = Buffer.alloc(4)
    header.writeUInt8(0xff, 0)
    header.writeUInt8(0xe1, 1)
    header.writeUInt16BE(payload.length + 2, 2)
    const withExif = jpeg(Buffer.concat([header, payload]))
    expect(withExif.includes(Buffer.from('GPSDATA'))).toBe(true)

    const stripped = stripJpegMetadata(withExif)
    expect(stripped.includes(Buffer.from('GPSDATA'))).toBe(false)
    // The actual image data survives.
    expect(stripped.includes(Buffer.from('imagedata'))).toBe(true)
    expect(stripped.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
  })

  it('records that stripping happened', async () => {
    const stored = await storage.put({ key: 'test/b.jpg', body: jpeg(), contentType: 'image/jpeg' })
    expect(stored.exifStripped).toBe(true)
    await storage.delete('test/b.jpg')
  })

  it('leaves a non-JPEG untouched', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect(stripJpegMetadata(png)).toEqual(png)
  })

  it('signs URLs with an expiry rather than exposing a permanent path', async () => {
    const url = await storage.signedUrl('test/c.jpg', 60)
    expect(url).toMatch(/expires=\d+/)
    expect(url).toMatch(/sig=[a-f0-9]{32}/)
  })

  it('the real adapter refuses to run without credentials', async () => {
    const real = new S3StorageAdapter(undefined)
    await expect(
      real.put({ key: 'a.jpg', body: jpeg(), contentType: 'image/jpeg' }),
    ).rejects.toThrow(AdapterNotConfiguredError)
  })
})

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

describe('ai port', () => {
  const summarySchema = z.object({
    headline: z.string(),
    bullets: z.array(z.string()),
    confidence: z.number(),
  })

  const request = {
    task: 'consultation.summary' as const,
    promptVersion: 'v1',
    input: { goal: 'level 9', history: ['box dye'] },
    schema: summarySchema,
  }

  it('returns schema-valid output', async () => {
    const result = await new MockAiAdapter().complete(request)
    expect(result.ok).toBe(true)
    expect(summarySchema.safeParse(result.value).success).toBe(true)
  })

  // Determinism is what makes end-to-end runs stable.
  it('is deterministic for the same input', async () => {
    const ai = new MockAiAdapter()
    const a = await ai.complete(request)
    const b = await ai.complete(request)
    expect(b.value).toEqual(a.value)
    expect(b.inputHash).toBe(a.inputHash)
  })

  it('produces different output for different input', async () => {
    const ai = new MockAiAdapter()
    const a = await ai.complete(request)
    const b = await ai.complete({ ...request, input: { goal: 'level 4' } })
    expect(b.inputHash).not.toBe(a.inputHash)
  })

  it('reports a schema mismatch rather than returning junk', async () => {
    const result = await new MockAiAdapter().complete({
      ...request,
      schema: z.object({ somethingElse: z.string() }),
    })
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('SCHEMA_INVALID')
    expect(result.value).toBeNull()
  })

  it('injects failures deterministically when asked', async () => {
    const ai = new MockAiAdapter({ failureRate: 1 })
    const result = await ai.complete(request)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('TRANSPORT')
  })

  it('the disabled adapter degrades cleanly instead of throwing', async () => {
    const result = await new DisabledAiAdapter().complete(request)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('DISABLED')
  })

  // Defence in depth: the service layer redacts, and the port checks anyway.
  it('refuses to transmit an email address or phone number', () => {
    expect(() => assertRedacted('ai', { note: 'call me on +1 555 123 4567' })).toThrow(
      /Refusing to send what looks like/,
    )
    expect(() => assertRedacted('ai', { note: 'ada@example.com' })).toThrow(
      /Refusing to send what looks like/,
    )
    expect(() => assertRedacted('ai', { note: 'level 9, cool tone' })).not.toThrow()
  })

  it('the mock refuses unredacted input just as the real one would', async () => {
    await expect(
      new MockAiAdapter().complete({ ...request, input: { email: 'ada@example.com' } }),
    ).rejects.toThrow(/Refusing to send what looks like/)
  })

  it('the real adapter refuses to run without credentials', async () => {
    await expect(new AnthropicAiAdapter(undefined).complete(request)).rejects.toThrow(
      AdapterNotConfiguredError,
    )
  })

  it('covers every task with a schema-valid stand-in', async () => {
    const ai = new MockAiAdapter()
    const loose = z.record(z.unknown())
    for (const task of [
      'consultation.summary',
      'photo.analysis',
      'inspiration.attributes',
      'risk.explain',
      'plan.narrative',
      'message.draft',
      'formula.suggest',
      'intake.normalize',
    ] as const) {
      const result = await ai.complete({
        task,
        promptVersion: 'v1',
        input: { x: 1 },
        schema: loose,
      })
      expect(result.ok, `${task} produced no output`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

describe('calendar port', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 1, h, 0, 0))

  it('pushes, reads back as busy, and removes', async () => {
    const calendar = new MockCalendarAdapter()
    const { externalId } = await calendar.push('cal-1', {
      title: 'Balayage — Ada',
      startsAt: at(10),
      endsAt: at(14),
      reference: 'appt_1',
    })

    const busy = await calendar.pullBusy('cal-1', at(0), at(23))
    expect(busy).toHaveLength(1)

    await calendar.remove('cal-1', externalId)
    expect(await calendar.pullBusy('cal-1', at(0), at(23))).toHaveLength(0)
  })

  it('only returns events overlapping the window', async () => {
    const calendar = new MockCalendarAdapter()
    await calendar.push('c', { title: 'x', startsAt: at(8), endsAt: at(9), reference: 'a' })
    await calendar.push('c', { title: 'y', startsAt: at(20), endsAt: at(21), reference: 'b' })
    expect(await calendar.pullBusy('c', at(10), at(12))).toHaveLength(0)
    expect(await calendar.pullBusy('c', at(7), at(12))).toHaveLength(1)
  })

  it('rejects an inverted range', async () => {
    const calendar = new MockCalendarAdapter()
    await expect(
      calendar.push('c', { title: 'x', startsAt: at(14), endsAt: at(10), reference: 'a' }),
    ).rejects.toThrow(AdapterError)
  })

  it('builds a valid ICS feed with CRLF line endings', () => {
    const ics = buildIcsFeed('Aurora — Rowan', [
      { title: 'Balayage', startsAt: at(10), endsAt: at(14), reference: 'appt_1' },
    ])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('UID:appt_1@')
    expect(ics).toContain('DTSTART:20260901T100000Z')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics.includes('\r\n')).toBe(true)
  })

  it('escapes ICS-significant characters in text fields', () => {
    const ics = buildIcsFeed('Cal', [
      { title: 'Cut; colour, gloss', startsAt: at(1), endsAt: at(2), reference: 'r' },
    ])
    expect(ics).toContain('SUMMARY:Cut\\; colour\\, gloss')
  })

  it('the real adapter refuses to run without credentials', async () => {
    const real = new GoogleCalendarAdapter(undefined, undefined)
    await expect(
      real.push('c', { title: 'x', startsAt: at(1), endsAt: at(2), reference: 'r' }),
    ).rejects.toThrow(AdapterNotConfiguredError)
  })
})

// ---------------------------------------------------------------------------
// E-signature
// ---------------------------------------------------------------------------

describe('esign port', () => {
  const esign = new LocalEsignAdapter()

  const base = {
    signerName: 'Ada Rivera',
    documentBody: 'I consent to the chemical service described above.',
    documentVersion: 3,
  }

  it('captures a drawn signature as SVG', async () => {
    const artifact = await esign.render({
      ...base,
      method: 'DRAWN',
      strokes: [
        [
          { x: 10, y: 100 },
          { x: 60, y: 40 },
          { x: 110, y: 120 },
        ],
      ],
    })
    expect(artifact.imageSvg).toContain('<path')
    expect(artifact.documentHash).toHaveLength(64)
  })

  it('renders a typed signature', async () => {
    const artifact = await esign.render({ ...base, method: 'TYPED' })
    expect(artifact.imageSvg).toContain('Ada Rivera')
  })

  it('clickwrap has no image but still hashes the document', async () => {
    const artifact = await esign.render({ ...base, method: 'CLICKWRAP' })
    expect(artifact.imageSvg).toBeNull()
    expect(artifact.documentHash).toHaveLength(64)
  })

  it('rejects a drawn signature with no strokes', async () => {
    await expect(esign.render({ ...base, method: 'DRAWN', strokes: [] })).rejects.toThrow(
      AdapterError,
    )
  })

  it('rejects an empty document', async () => {
    await expect(
      esign.render({ ...base, documentBody: '   ', method: 'CLICKWRAP' }),
    ).rejects.toThrow(AdapterError)
  })

  it('escapes markup in a typed name', async () => {
    const artifact = await esign.render({ ...base, signerName: 'A <script>', method: 'TYPED' })
    expect(artifact.imageSvg).not.toContain('<script>')
  })

  // The hash is the artefact that actually matters legally.
  it('hashes the document so a later edit is detectable', () => {
    const a = hashDocument('I consent to the service.', 1)
    expect(hashDocument('I consent to the service.', 1)).toBe(a)
    expect(hashDocument('I consent to the  service.', 1)).toBe(a) // whitespace-insensitive
    expect(hashDocument('I consent to the service!', 1)).not.toBe(a) // wording matters
    expect(hashDocument('I consent to the service.', 2)).not.toBe(a) // version matters
  })
})

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

describe('mock identifiers', () => {
  it('are stable for the same inputs and differ otherwise', () => {
    expect(mockId('pi', 'a', 1)).toBe(mockId('pi', 'a', 1))
    expect(mockId('pi', 'a', 1)).not.toBe(mockId('pi', 'a', 2))
    expect(mockId('pi', 'a')).toMatch(/^pi_mock_[a-f0-9]{24}$/)
  })
})
