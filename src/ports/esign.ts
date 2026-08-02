import { createHash } from 'node:crypto'
import { AdapterError } from './types'

/**
 * Signature capture.
 *
 * The valuable artefact is not the squiggle — it is `documentHash`, a digest of
 * the exact rendered document the client agreed to. That is what stops a later
 * template edit changing what someone is shown to have signed.
 */

export type SignatureMethod = 'DRAWN' | 'TYPED' | 'CLICKWRAP'

export interface SignatureInput {
  signerName: string
  method: SignatureMethod
  /** Normalised stroke points for DRAWN, in a 600x200 box. */
  strokes?: readonly (readonly { x: number; y: number }[])[]
  documentBody: string
  documentVersion: number
}

export interface SignatureArtifact {
  documentHash: string
  /** SVG rather than PNG: no native image dependency, and it stays crisp. */
  imageSvg: string | null
  method: SignatureMethod
}

export interface EsignPort {
  readonly name: string
  hashDocument(body: string, version: number): string
  render(input: SignatureInput): Promise<SignatureArtifact>
}

/**
 * Hash the document as the client saw it.
 *
 * Whitespace is normalised so an inconsequential reformat does not invalidate a
 * signature, but every word is significant.
 */
export function hashDocument(body: string, version: number): string {
  const normalized = body.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(`v${version}\n${normalized}`).digest('hex')
}

function strokesToSvg(strokes: readonly (readonly { x: number; y: number }[])[]): string {
  const paths = strokes
    .filter((s) => s.length > 1)
    .map((stroke) => {
      const d = stroke
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ')
      return `<path d="${d}" fill="none" stroke="#0B0B0C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200">${paths}</svg>`
}

function typedToSvg(name: string): string {
  const escaped = name.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200">` +
    `<text x="20" y="130" font-family="Cormorant Garamond, Georgia, serif" font-size="64" ` +
    `font-style="italic" fill="#0B0B0C">${escaped}</text></svg>`
  )
}

// ---------------------------------------------------------------------------

export class LocalEsignAdapter implements EsignPort {
  readonly name = 'esign:local'

  hashDocument(body: string, version: number): string {
    return hashDocument(body, version)
  }

  async render(input: SignatureInput): Promise<SignatureArtifact> {
    if (input.signerName.trim().length < 2) {
      throw new AdapterError(this.name, 'INVALID_SIGNER', 'A signer name is required.')
    }
    if (input.documentBody.trim().length === 0) {
      throw new AdapterError(this.name, 'EMPTY_DOCUMENT', 'Refusing to sign an empty document.')
    }
    if (input.method === 'DRAWN' && (!input.strokes || input.strokes.length === 0)) {
      throw new AdapterError(
        this.name,
        'NO_STROKES',
        'A drawn signature needs at least one stroke.',
      )
    }

    const imageSvg =
      input.method === 'DRAWN'
        ? strokesToSvg(input.strokes!)
        : input.method === 'TYPED'
          ? typedToSvg(input.signerName)
          : null

    return {
      documentHash: hashDocument(input.documentBody, input.documentVersion),
      imageSvg,
      method: input.method,
    }
  }
}

/**
 * Remote e-signature providers.
 *
 * The local adapter is the DEFAULT even in production: for a salon consent form
 * the legal requirement is a durable record of what was agreed and by whom, and
 * a hashed document plus a captured signature meets that. A remote provider is
 * worth its cost only where counter-signing or notarisation is genuinely needed,
 * so this is a deliberate seam rather than a stub.
 */
export class RemoteEsignAdapter implements EsignPort {
  readonly name = 'esign:remote'

  private readonly local = new LocalEsignAdapter()

  hashDocument(body: string, version: number): string {
    return hashDocument(body, version)
  }

  async render(input: SignatureInput): Promise<SignatureArtifact> {
    // Falls through to local capture; a provider integration slots in here when
    // a salon needs counter-signing, without changing any call site.
    return this.local.render(input)
  }
}
