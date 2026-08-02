import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Inter } from 'next/font/google'
import './globals.css'

/**
 * Cormorant Garamond carries the display voice — page titles, salon names,
 * section headers. Inter carries every control, label and table. The pairing
 * is what makes the product read as a salon rather than a dashboard.
 */
const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
  themeColor: '#0f2a4a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  )
}
