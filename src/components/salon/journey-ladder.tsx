import type { HairJourney } from '@/domain/hair/journey'

/**
 * The way there, drawn.
 *
 * A server component and pure presentation — every decision on this screen was
 * made in `planJourney`, which is pure and tested. The one thing it does that
 * a naive swatch strip does not is mark the stages nobody finishes on, because
 * that is the whole reason it exists: a client going to platinum from a level 4
 * brown is going to be orange for a while, and being told so in advance is the
 * difference between a stage and a disaster.
 *
 * No generated imagery. A picture of *this client's* hair reads as a promise
 * about their hair specifically — which is the exact thing this product exists
 * not to do.
 */
export function JourneyLadder({
  journey,
  /** Softer framing for the staff screens, which do not need reassuring. */
  audience = 'client',
}: {
  journey: HairJourney
  audience?: 'client' | 'staff'
}) {
  if (!journey.worthShowing) return null

  const staging = journey.rungs.filter((rung) => rung.isStagingPost && rung.note)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="label-caps mb-1">
          {audience === 'client' ? 'What it takes to get there' : 'The journey shown to the client'}
        </p>
        <p className="text-body text-ink">{journey.summary}</p>
      </div>

      <ol className="flex flex-wrap items-start gap-3">
        {journey.rungs.map((rung, index) => (
          <li key={rung.visit} className="flex items-start gap-3">
            {index > 0 && (
              <span aria-hidden="true" className="mt-8 text-ink-subtle">
                →
              </span>
            )}

            <div className="flex w-28 flex-col gap-2">
              <div
                className="h-16 w-full rounded-md border border-line"
                style={{ backgroundColor: rung.hex }}
                /*
                 * The swatch is decorative; every word it could carry is in the
                 * text beneath it. Labelling it too would read the same thing
                 * twice to anybody using a screen reader.
                 */
                aria-hidden="true"
              />
              <div>
                <p className="text-label font-medium text-ink">{rung.label}</p>
                <p className="text-label text-ink-muted">
                  {rung.toneName} · level {rung.level}
                </p>
                {rung.isStagingPost && <p className="text-label text-gold-700">Not the finish</p>}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/*
       * Said once, under the ladder, rather than repeated on every swatch. A
       * client who reads "that is the stage, not the result" three times stops
       * reading it.
       */}
      {staging.length > 0 && (
        <div className="wash-gold rounded-lg p-5">
          <p className="text-body text-ink">{staging[0]!.note}</p>
          {staging.length > 1 && (
            <p className="mt-2 text-secondary text-ink-muted">
              The same is true of every visit before the last one.
            </p>
          )}
        </div>
      )}

      {journey.rungs.at(-1)?.note && (
        <p className="text-secondary text-ink-muted">{journey.rungs.at(-1)!.note}</p>
      )}
    </div>
  )
}
