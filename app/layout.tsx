import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AI-RAG Chatbots',
  description: 'Enterprise RAG chatbot platform with document context and company isolation',
  generator: 'Shoaib Akhter',
  icons: {
    icon: [
      {
        url: '/chatbot.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/chatbot.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/chatbot.png',
  },
}

// The CerebrOS spec defines a single light palette — no dark variant.
export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#fafafa',
  width: 'device-width',
  initialScale: 1,
  // No maximumScale / userScalable lock: pinch-zoom stays available.
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <body className="bg-canvas font-sans text-ink-900 selection:bg-brand/20">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
