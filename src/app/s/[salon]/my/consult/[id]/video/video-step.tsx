'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { removeVideoAction } from '@/server/actions/consultation'

/**
 * Recording a clip, from a phone.
 *
 * `capture="user"` on a video input opens the front camera straight away on a
 * phone, which is what somebody filming their own hair actually wants — and on
 * a desktop it degrades to a file picker, which is what somebody at a laptop
 * wants. No library, no recorder UI, no permissions dance: the phone already
 * has all of that and does it better.
 *
 * The prompts are the important part. A client handed a camera and no
 * instruction films their face; each prompt is a thing a still genuinely
 * cannot carry, phrased as an action rather than as a photography brief.
 */

export interface UploadedVideo {
  id: string
  prompt: string | null
  clientNote: string | null
  durationSec: number | null
  mimeType: string
  url: string
}

export function VideoStep({
  salonSlug,
  consultationId,
  videos,
  prompts,
  asked,
  maxSeconds,
}: {
  salonSlug: string
  consultationId: string
  videos: UploadedVideo[]
  prompts: readonly string[]
  /** True when the engine decided a still will not do for this one. */
  asked: boolean
  maxSeconds: number
}) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [prompt, setPrompt] = React.useState<string>(prompts[0] ?? '')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    try {
      /*
       * The length, read here because this is the only place that can.
       *
       * The server enforces a limit on it, and a limit the client never sends
       * a value for is not a limit — it was one line of documentation guarding
       * nothing. The browser already decoded enough of the file to know, so
       * asking it costs nothing.
       */
      const durationSec = await durationOf(file)
      if (durationSec != null && durationSec > maxSeconds) {
        throw new Error(
          `That is ${Math.round(durationSec)} seconds. Keep it under ${maxSeconds} — that is plenty to see how the hair moves.`,
        )
      }

      const form = new FormData()
      form.set('salon', salonSlug)
      form.set('consultationId', consultationId)
      form.set('kind', 'video')
      form.set('file', file)
      form.set('prompt', prompt)
      if (durationSec != null) form.set('durationSec', String(Math.round(durationSec)))
      if (note.trim()) form.set('note', note.trim())

      const response = await fetch('/api/uploads', { method: 'POST', body: form })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? 'That did not upload.')
      }
      setNote('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not upload.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <header>
        <p className="label-caps">Video</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">
          {asked ? 'We need to see it move' : 'Want to show us it moving?'}
        </h1>
        <p className="mt-2 max-w-prose text-body text-ink-muted">
          {asked
            ? 'A still cannot show what your hair actually does. Thirty seconds of it moving tells us more about the condition than any photograph.'
            : 'Optional, and genuinely useful. Banding reads as a line in a photo and as a stripe travelling down the length when you turn your head.'}
        </p>
        <p className="mt-2 text-secondary text-ink-muted">
          Under {maxSeconds} seconds, and no need to say anything — we just need to see it move.
        </p>
      </header>

      <fieldset className="flex flex-col gap-3">
        <legend className="label-caps mb-1">What to film</legend>
        {prompts.map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors ${
              prompt === option
                ? 'bg-gold-soft border-gold-500'
                : 'border-line hover:border-gold-500'
            }`}
          >
            <input
              type="radio"
              name="prompt"
              value={option}
              checked={prompt === option}
              onChange={() => setPrompt(option)}
              className="mt-1"
            />
            <span className="text-body text-ink">{option}</span>
          </label>
        ))}
      </fieldset>

      <Field label="Anything you want to point out?" help="Optional.">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="It goes frizzy about an inch from the roots."
        />
      </Field>

      <div>
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Sending…' : 'Record or choose a video'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          // Opens the front camera on a phone; a file picker on a laptop.
          capture="user"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void upload(file)
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}

      {videos.length > 0 && (
        <section className="flex flex-col gap-4">
          <p className="label-caps">What you have sent</p>
          {videos.map((video) => (
            <figure key={video.id} className="overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={video.url} controls playsInline className="w-full" />
              <figcaption className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  {video.prompt && <p className="text-secondary text-ink">{video.prompt}</p>}
                  {video.clientNote && (
                    <p className="mt-1 text-secondary text-ink-muted">{video.clientNote}</p>
                  )}
                </div>
                {/*
                 * A misfired clip used to be permanent for the life of the
                 * consultation — and a video of the wrong thing is a more
                 * uncomfortable thing to be stuck with than a photograph.
                 */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError(null)
                    const result = await removeVideoAction(salonSlug, {
                      consultationId,
                      videoId: video.id,
                    })
                    setBusy(false)
                    if (!result.ok) {
                      setError(result.error)
                      return
                    }
                    router.refresh()
                  }}
                >
                  Remove
                </Button>
              </figcaption>
            </figure>
          ))}
        </section>
      )}

      <div>
        <Button variant="secondary" asChild>
          <Link href={`/s/${salonSlug}/my/consult/${consultationId}/review`}>
            {videos.length > 0 ? 'Done — see the answer' : 'Skip this'}
          </Link>
        </Button>
      </div>
    </div>
  )
}

/**
 * How long the clip runs, according to the browser that is about to send it.
 *
 * Returns null rather than throwing when the format cannot be probed. A client
 * whose phone produced something this browser will not decode should still be
 * able to send it — the server's size cap is the backstop, and refusing an
 * upload because we could not measure it would punish the wrong person.
 */
function durationOf(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const probe = document.createElement('video')

    const done = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }

    probe.preload = 'metadata'
    probe.onloadedmetadata = () =>
      done(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null)
    probe.onerror = () => done(null)
    probe.src = url
  })
}
