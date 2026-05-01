'use client'

import { useMarketStore, type Timeframe } from './useMarketStore'

const TFS: Timeframe[] = ['15m', '1h']

export function Header({ onRefresh }: { onRefresh: () => void }) {
  const {
    ticker,
    timeframe,
    setTimeframe,
    isConnected,
    thresholds,
    setThresholds,
  } = useMarketStore()

  const up = ticker ? ticker.change24h >= 0 : false
  const priceColor = ticker
    ? up ? 'var(--accent-green)' : 'var(--accent-red)'
    : 'var(--text-muted)'

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(10,11,14,0.96)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--bg-border)',
    }}>
      <div style={{
        maxWidth: 1800, margin: '0 auto', padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--accent-red)', fontSize: 20 }}>•</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.2em', fontSize: 22 }}>
                BTC FLOW
              </span>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12 }}>
                DETECTOR
              </span>
            </div>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.08em' }}>
              by Hugo Macaire
            </span>
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 4,
          background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
          borderRadius: 8, padding: 4,
        }}>
          {TFS.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: '8px 14px', borderRadius: 6, border: 'none',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
                background: timeframe === tf ? 'var(--accent-green)' : 'transparent',
                color: timeframe === tf ? '#0a0b0e' : 'var(--text-secondary)',
              }}
            >
              {tf}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {ticker && (
            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: priceColor, fontSize: 14 }}>
              ${ticker.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </div>
          )}

          <button
            onClick={() => setThresholds({ mode: thresholds.mode === 'aggressive' ? 'strict' : 'aggressive' })}
            style={{
              border: '1px solid var(--bg-border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 12px',
              fontFamily: 'monospace', cursor: 'pointer',
            }}
          >
            ⚡ {thresholds.mode.toUpperCase()}
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            color: isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
            fontFamily: 'monospace', fontSize: 12,
          }}>
            <span>●</span>
            <span>{isConnected ? 'ONLINE' : 'OFFLINE'}</span>
          </div>

          <button
            onClick={onRefresh}
            style={{
              border: '1px solid var(--bg-border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 12px',
              fontFamily: 'monospace', cursor: 'pointer',
            }}
          >
            ↻
          </button>
        </div>
      </div>
    </header>
  )
}
