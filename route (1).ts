import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'BTC Flow Detector',
  description: 'OI + CVD + VWAP — Détection de setups BTCUSDT',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
