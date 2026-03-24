'use client'
import { useMarketStore } from '@/store/useMarketStore'
import { analyzeOI } from '@/lib/indicators'

export function OIStatsPanel() {
  const { oi } = useMarketStore()
  const a = analyzeOI(oi)
  const trendCfg = {
    building:  { color: 'var(--accent-green)', label: '▲ BUILD-UP' },
    unwinding: { color: 'var(--accent-red)',   label: '▼ UNWIND' },
    stable:    { color: 'var(--text-muted)',   label: '→ STABLE' },
  }[a.trend]

  const stats = [
    { label: 'OI Actuel',        value: a.current > 0 ? `${(a.current/1000).toFixed(1)}K BTC` : '—',                          color: 'var(--text-primary)' },
    { label: 'Variation 1h',     value: a.current > 0 ? `${a.change1h >= 0 ? '+' : ''}${a.change1h.toFixed(2)}%` : '—',       color: a.change1h > 0 ? 'var(--accent-green)' : a.change1h < 0 ? 'var(--accent-red)' : 'var(--text-muted)' },
    { label: 'Variation 4h',     value: a.current > 0 ? `${a.change4h >= 0 ? '+' : ''}${a.change4h.toFixed(2)}%` : '—',       color: a.change4h > 0 ? 'var(--accent-green)' : a.change4h < 0 ? 'var(--accent-red)' : 'var(--text-muted)' },
    { label: 'Tendance récente', value: a.recentTrend === 'up' ? '↑ Hausse' : a.recentTrend === 'down' ? '↓ Baisse' : '→ Stable', color: a.recentTrend === 'up' ? 'var(--accent-green)' : a.recentTrend === 'down' ? 'var(--accent-red)' : 'var(--text-muted)' },
  ]

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>Open Interest</span>
        <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: trendCfg.color, background: `${trendCfg.color}15`, borderRadius: 4, padding: '2px 8px' }}>{trendCfg.label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 14, fontFamily: 'monospace', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
