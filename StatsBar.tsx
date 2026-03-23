import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BTC Flow Detector — OI + CVD + VWAP',
  description: 'Détection de setups de trading en temps réel sur BTCUSDT perpetual',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body className="antialiased" style={{ background: 'var(--bg-primary)' }}>
        {children}
      </body>
    </html>
  )
}
