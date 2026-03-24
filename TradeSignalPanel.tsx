'use client'

import { useMarketStore } from './useMarketStore'

export default function TradeSignalPanel() {
  const signal = useMarketStore((s) => s.signal)

  const action = signal?.action ?? 'STABLE'
  const confidence = signal?.confidence ?? 1
  const reasons = signal?.reasons ?? ['Pas encore de signal.']
  const metrics = signal?.metrics

  const color =
    action === 'BUY'
      ? 'var(--accent-green)'
      : action === 'SELL'
      ? 'var(--accent-red)'
      : 'var(--accent-yellow)'

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
        Signal Panel
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color,
          marginBottom: 8,
        }}
      >
        {action}
      </div>

      <div
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 12,
        }}
      >
        Confidence: {confidence}/5
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {reasons.map((reason, i) => (
          <div key={i} style={{ fontSize: 13, color: 'var(--text-primary)' }}>
            • {reason}
          </div>
        ))}
      </div>

      {metrics && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            fontSize: 12,
            color: 'var(--text-secondary)',
          }}
        >
          <div>Price vs VWAP: {metrics.priceVsVwapPct.toFixed(2)}%</div>
          <div>CVD Δ: {metrics.cvdDelta.toFixed(2)}</div>
          <div>OI Δ: {metrics.oiDeltaPct.toFixed(4)}%</div>
          <div>Funding: {(metrics.fundingRate * 100).toFixed(4)}%</div>
        </div>
      )}
    </div>
  )
}
