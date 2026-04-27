'use client'
import { useMarketStore } from './useMarketStore'

export default function OIStatsPanel() {
  const { oi, funding } = useMarketStore()

  const latest = oi.at(-1)
  const prev = oi.at(-2)
  const first = oi[0]

  const lastStep =
    latest && prev ? latest.openInterest - prev.openInterest : 0

  const sessionChange =
    latest && first ? latest.openInterest - first.openInterest : 0

  const sessionChangePct =
    latest && first && first.openInterest !== 0
      ? ((latest.openInterest - first.openInterest) / first.openInterest) * 100
      : 0

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: 12,
        }}
      >
        OI Stats Panel
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          Current OI: {latest ? latest.openInterest.toFixed(2) : '—'}
        </div>
        <div
          style={{
            color: lastStep >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
          }}
        >
          Last OI Step: {typeof lastStep === 'number' ? lastStep.toFixed(2) : '—'}
        </div>
        <div
          style={{
            color:
              sessionChange >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
          }}
        >
          Session OI Change: {typeof sessionChange === 'number' ? sessionChange.toFixed(2) : '—'}
        </div>
        <div
          style={{
            color:
              sessionChangePct >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
          }}
        >
          Session OI %: {typeof sessionChangePct === 'number' ? sessionChangePct.toFixed(4) : '—'}%
        </div>
        <div>
          Funding: {funding ? `${(funding.rate * 100).toFixed(4)}%` : '—'}
        </div>
      </div>
    </div>
  )
}
