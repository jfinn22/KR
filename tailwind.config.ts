import type { Config } from 'tailwindcss'

/**
 * Salon theme.
 *
 * Every colour here maps to a CSS custom property declared once in
 * `src/app/globals.css`. Components must use these token names — never a raw
 * hex value. `tests/unit/design/palette.test.ts` asserts the contrast of every
 * text/background pair, so the palette cannot silently drift below WCAG AA.
 */
/** Wrap a channel-triplet custom property so Tailwind alpha modifiers work. */
const c = (token: string) => `rgb(var(--${token}) / <alpha-value>)`

const config: Config = {
  darkMode: [], // light theme only — the committed design
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: c('ink'),
          muted: c('ink-muted'),
          subtle: c('ink-subtle'),
          inverse: c('ink-inverse'),
        },
        canvas: c('canvas'),
        surface: {
          DEFAULT: c('surface'),
          alt: c('surface-alt'),
        },
        line: {
          DEFAULT: c('line'),
          strong: c('line-strong'),
        },
        blue: {
          900: c('blue-900'),
          700: c('blue-700'),
          500: c('blue-500'),
          300: c('blue-300'),
          100: c('blue-100'),
          50: c('blue-50'),
        },
        gold: {
          700: c('gold-700'),
          600: c('gold-600'),
          500: c('gold-500'),
          300: c('gold-300'),
          100: c('gold-100'),
        },
        success: {
          DEFAULT: c('success'),
          soft: c('success-soft'),
        },
        warn: {
          DEFAULT: c('warn'),
          soft: c('warn-soft'),
        },
        danger: {
          DEFAULT: c('danger'),
          soft: c('danger-soft'),
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Display scale — serif, used for page titles and section headers.
        'display-xl': ['2.5rem', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        'display-lg': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        'display-md': ['1.5rem', { lineHeight: '1.25' }],
        'display-sm': ['1.25rem', { lineHeight: '1.3' }],
        // UI scale — Inter.
        body: ['1rem', { lineHeight: '1.6' }],
        secondary: ['0.875rem', { lineHeight: '1.55' }],
        label: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 6px)',
        pill: '999px',
      },
      boxShadow: {
        // Deliberately almost invisible. Nothing dramatic.
        card: '0 1px 2px rgba(11, 11, 12, 0.04)',
        raised: '0 2px 8px rgba(11, 11, 12, 0.05)',
        overlay: '0 4px 16px rgba(11, 11, 12, 0.06)',
        modal: '0 12px 40px rgba(11, 11, 12, 0.12)',
      },
      spacing: {
        section: '3rem',
        card: '1.5rem',
      },
      maxWidth: {
        prose: '68ch',
        shell: '84rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
