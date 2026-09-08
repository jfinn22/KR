'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The salon's navigation, as a navy column down the left.
 *
 * It used to be a row across the top, which worked while there were four links
 * and stopped working at sixteen: an owner's nav wrapped, the labels compressed
 * to fit, and "What was done" sat next to "Diary" with nothing to say which
 * belonged to running the day and which to running the business. A column has
 * room to group, and grouping is the whole point — somebody looking for the
 * waitlist should be able to find it by looking in one place rather than
 * reading all sixteen.
 *
 * Navy because the palette already has one: `blue-900` is the deepest rung of
 * the family the design system calls "structure", and the branding ladder
 * guarantees white text clears AA on it for every salon that supplies its own
 * colour. So the column re-skins with the brand and stays readable, rather than
 * being a hardcoded navy that a branded salon would fight.
 *
 * The active row is marked three ways — a gold edge, a lifted background and a
 * heavier weight — because gold on navy is a strong signal at the shipped
 * palette and a weaker one on a salon's own dark accent. Colour alone was never
 * going to be enough on its own anyway.
 *
 * ONE element, styled two ways. The first cut of this rendered a drawer for
 * phones and a column for desktops, which put every label in the document
 * twice: a screen reader announced the navigation twice over, and anything
 * looking for text by name found the copy that was hidden. A drawer that
 * becomes a column at `lg` is the same markup wearing different position rules.
 */

export interface NavItem {
  href: string
  label: string
}

export interface NavGroup {
  /** Null for the client's short list, which is not worth sectioning. */
  label: string | null
  items: NavItem[]
}

export interface SalonNavProps {
  salon: string
  salonName: string
  logoUrl: string | null
  /** "Salon" or "Your account" — who this shell belongs to. */
  kicker: string
  groups: NavGroup[]
  /** Sits under the nav, so the timezone travels with the salon's identity. */
  footnote: string
}

export function SalonNav({ salon, salonName, logoUrl, kicker, groups, footnote }: SalonNavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const drawerId = useId()

  const base = `/s/${salon}`
  const active = activeHref(pathname, base, groups)

  // A tap that navigates should also put the drawer away — otherwise the page
  // changes behind a panel still covering it.
  useEffect(() => setOpen(false), [pathname])

  // Escape closes it, because a drawer that traps you is worse than no drawer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // The page behind must not scroll while the drawer is over it.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  /*
   * Widening past `lg` turns the drawer back into a column, so the open flag
   * has to be dropped with it. Without this, somebody who opened the menu on a
   * phone and then rotated into the desktop layout kept the scroll lock the
   * drawer had set — a page that will not scroll and no visible reason why.
   */
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const sync = () => {
      if (desktop.matches) setOpen(false)
    }
    sync()
    desktop.addEventListener('change', sync)
    return () => desktop.removeEventListener('change', sync)
  }, [])

  return (
    <>
      {/* --- The bar that only exists on a phone ---------------------------- */}
      <div className="nav-navy sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 lg:hidden">
        <p className="min-w-0 truncate font-display text-display-sm text-white">{salonName}</p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={drawerId}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10"
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <MenuGlyph open={open} />
        </button>
      </div>

      {/* The scrim. Phone only, and only while the drawer is over the page. */}
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink/40 lg:hidden"
        />
      ) : null}

      {/*
       * The nav itself.
       *
       * Phone: fixed to the left edge, slid out of frame until asked for.
       * `invisible` rather than `inert` because it has to come back at `lg`,
       * and visibility is the one way to leave the tab order that a media query
       * can also reverse — an `inert` attribute cannot be responsive.
       *
       * Desktop: an ordinary column in the page's flex row, so it stretches to
       * the full height of the document and the navy runs to the bottom of any
       * page. The inner element is what sticks to the top of the viewport.
       */}
      <div
        id={drawerId}
        className={cn(
          'nav-navy fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-200 ease-out',
          'lg:visible lg:static lg:z-auto lg:w-64 lg:shrink-0 lg:translate-x-0 lg:transition-none xl:w-72',
          open ? 'visible translate-x-0' : 'invisible -translate-x-full',
        )}
      >
        <aside className="flex h-full flex-col lg:sticky lg:top-0 lg:h-screen">
          <div className="flex items-start justify-between gap-2 px-3 pb-1 pt-5">
            <Link
              href={`${base}/my`}
              className="min-w-0 rounded-md px-3 py-2 transition-colors hover:bg-white/10"
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={salonName} className="max-h-9 w-auto object-contain" />
              ) : (
                <span className="font-display text-display-sm leading-tight text-white">
                  {salonName}
                </span>
              )}
              <span className="block pt-1 text-label uppercase tracking-[0.12em] text-gold-300">
                {kicker}
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-white/10 lg:hidden"
            >
              <span className="sr-only">Close menu</span>
              <MenuGlyph open />
            </button>
          </div>

          <div aria-hidden="true" className="mx-3 mt-3 h-px bg-gold-500/40" />

          <nav aria-label="Salon" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
            {groups.map((group, index) => (
              <div key={group.label ?? `group-${index}`} className="flex flex-col gap-1">
                {group.label ? (
                  <h2 className="mb-1 px-3 text-label font-semibold uppercase tracking-[0.12em] text-white/55">
                    {group.label}
                  </h2>
                ) : null}

                {group.items.map((item) => {
                  const href = `${base}${item.href}`
                  const isActive = href === active
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative rounded-md py-2 pl-4 pr-3 text-secondary transition-colors',
                        isActive
                          ? 'bg-white/[0.14] font-semibold text-white'
                          : 'font-medium text-white/80 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      {isActive ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-pill bg-gold-500"
                        />
                      ) : null}
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>

          <div className="border-t border-white/10 px-6 py-4">
            <p className="text-label text-white/55">{footnote}</p>
          </div>
        </aside>
      </div>
    </>
  )
}

/** Three rules, or a cross. No icon dependency for two glyphs. */
function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className="h-5 w-5"
    >
      {open ? (
        <>
          <path d="M5 5l10 10" />
          <path d="M15 5L5 15" />
        </>
      ) : (
        <>
          <path d="M3 6h14" />
          <path d="M3 10h14" />
          <path d="M3 14h14" />
        </>
      )}
    </svg>
  )
}

/**
 * Which row to light up.
 *
 * Longest match wins, because `/desk` is a prefix of `/desk/calendar` and a
 * naive `startsWith` would light both — leaving "Today" permanently highlighted
 * while somebody is looking at the diary.
 */
function activeHref(pathname: string, base: string, groups: NavGroup[]): string | null {
  let best: string | null = null
  for (const group of groups) {
    for (const item of group.items) {
      const full = `${base}${item.href}`
      if (pathname === full || pathname.startsWith(`${full}/`)) {
        if (best === null || full.length > best.length) best = full
      }
    }
  }
  return best
}
