'use client'
import { useMarketStore } from '@/store/useMarketStore'
import type { Timeframe } from '@/types'

const TFS: Timeframe[] = ['1m', '5m', '15m', '1h']

export function Header({ onRefresh }: { onRefresh: () => void }) {
  const { ticker, timeframe, setTimeframe, isConnected, thresholds, setThresholds } = useMarketStore()
  const up = ticker && ticker.change24h >= 0
  const priceColor = ticker ? (up ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)'

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(10,11,14,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--bg-border)' }}>
      <div style={{ maxWidth: 1800, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: isConnected ? 'var(--accent-green)' : 'var(--accent-red)', display: 'inline-block' }} />
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, letterSpacing: '0.15em', color: 'var(--text-primary)' }}>BTC FLOW</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>DETECTOR</span>
        </div>

        {/* Price */}
        {ticker && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 20, color: priceColor }}>
              ${ticker.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: priceColor }}>
              {up ? '+' : ''}{ticker.change24h.toFixed(2)}% 24h
            </div>
          </div>
        )}

        {/* Timeframe */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: 4 }}>
          {TFS.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, background: timeframe === tf ? 'var(--accent-green)' : 'transparent', color: timeframe === tf ? '#0a0b0e' : 'var(--text-secondary)', transition: 'all 0.15s' }}>
              {tf}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setThresholds({ mode: thresholds.mode === 'aggressive' ? 'strict' : 'aggressive' })} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${thresholds.mode === 'strict' ? 'var(--accent-yellow)' : 'var(--bg-border)'}`, background: 'transparent', cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, color: thresholds.mode === 'strict' ? 'var(--accent-yellow)' : 'var(--text-muted)' }}>
            {thresholds.mode === 'strict' ? '🔒 STRICT' : '⚡ AGRESSIF'}
          </button>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: isConnected ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {isConnected ? '● LIVE' : '○ OFFLINE'}
          </span>
          <button onClick={onRefresh} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--bg-border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13 }}>↻</button>
        </div>
      </div>
    </header>
  )
}
