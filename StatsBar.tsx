'use client'

import { useMarketStore } from './useMarketStore'

export default function StatsBar() {
  const { ticker, funding, lastUpdate, isConnected } = useMarketStore()

  const price = ticker?.price ?? 0
  const change24h = ticker?.change24h ?? 0
  const volume24h = ticker?.volume24h ?? 0
  const fundingPct = (funding?.rate ?? 0) * 100

  const cards = [
    {
      label: 'Last Price',
      value: price ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—',
    },
    {
      label: '24h Change',
      value: `${change24h.toFixed(2)}%`,
      color:
        change24h >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
    },
    {
      label: '24h Volume',
      value: volume24h ? volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—',
    },
    {
      label: 'Funding',
      value: `${fundingPct.toFixed(4)}%`,
      color:
        fundingPct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
    },
    {
      label: 'Status',
      value: isConnected ? 'ONLINE' : 'OFFLINE',
      color:
        isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
    },
    {
      label: 'Last Update',
      value: lastUpdate ? new Date(lastUpdate).toLocaleTimeString('fr-FR') : '—',
    },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
        gap: 12,
      }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: 8,
            }}
          >
            {card.label}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: card.color ?? 'var(--text-primary)',
            }}
          >
            {card.value}
          </div>
        </div>
      ))}
    </div>
  )
}
