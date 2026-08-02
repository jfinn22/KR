import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

/**
 * Plus Jakarta Sans carries the display voice — page titles, salon names,
 * section headers. Inter carries every control, label and table.
 *
 * Both are sans on purpose. A display serif photographs beautifully and costs
 * legibility exactly where this product is used: a consultation answered
 * one-handed on a phone, a stylist scanning a risk flag between clients. The
 * character comes from weight, spacing and colour instead, which cost nothing
 * to read.
 */
const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
})

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Salon Intelligence Platform',
    template: '%s · Salon Intelligence',
  },
  description:
    'Consultation-first salon software. The right service, the right timing, the right expectations — decided before the client sits down.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#133458',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  )
}
