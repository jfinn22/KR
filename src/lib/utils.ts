import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge has to be taught this theme's vocabulary.
 *
 * Out of the box it only knows the stock scale, so it cannot tell that
 * `text-secondary` is a FONT SIZE here and `text-ink-inverse` a COLOUR. It
 * filed both under "text colour", kept the later one, and silently deleted the
 * other — which is how every primary button shipped with black text on blue:
 * the variant said `text-ink-inverse`, the size said `text-secondary`, and the
 * white lost the merge. No type error, no lint, just an unreadable button.
 *
 * Declaring the theme's font sizes puts the two in different groups, so both
 * survive. The list must track fontSize keys in tailwind.config.ts —
 * `tests/unit/design/class-merge.test.ts` fails if the two drift apart.
 */
export const THEME_FONT_SIZES = [
  'display-xl',
  'display-lg',
  'display-md',
  'display-sm',
  'body',
  'secondary',
  'label',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...THEME_FONT_SIZES] }],
    },
  },
})

/** Merge conditional class names, resolving Tailwind conflicts last-wins. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
