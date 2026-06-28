'use client'

import { useMarketStore } from './useMarketStore'

type SlotKey = 'BTC-1h' | 'ETH-1h' | 'SOL-1h' | 'XRP-1h'

const SLOT_COLOR: Record<SlotKey, string> = {
  'BTC-1h': '#f7931a',
  'ETH-1h': '#627eea',
  'SOL-1h': '#14f195',
  'XRP-1h': '#0085c3',
}

function colorRegime(regime: string) {
  if (regime === 'up') return 'var(--accent-green)'
  if (regime === 'down') return 'var(--accent-red)'
  return 'var(--text-muted)'
}

function colorWR(wr: number) {
  if (wr >= 70) return 'var(--accent-green)'
  if (wr >= 50) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}

function colorAction(action: string) {
  if (action === 'BUY') return 'var(--accent-green)'
  if (action === 'SELL') return 'var(--accent-red)'
  return 'var(--text-muted)'
}

export default function AnalyticsPanel() {
  const { slotSignals, allPositions, slotStats, setupStats, sessionStats } = useMarketStore()

  const slots: SlotKey[] = ['BTC-1h', 'ETH-1h', 'SOL-1h', 'XRP-1h']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* 4 Slots */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
          Squeeze H1 + Régime Daily — BTC · ETH · SOL · XRP
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {slots.map(slot => {
            const signal = slotSignals?.[slot]
            const position = allPositions?.[slot]
            const stats = slotStats?.[slot]
            const color = SLOT_COLOR[slot]

            return (
              <div key={slot} style={{ background: 'var(--bg-primary)', border: `1px solid ${color}44`, borderRadius: 10, padding: 12 }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color }}>{slot.replace('-', ' ')}</div>
                  <div style={{ fontSize: 10, background: `${colorRegime(signal?.dailyRegime ?? 'undefined')}22`, color: colorRegime(signal?.dailyRegime ?? 'undefined'), padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                    régime {signal?.dailyRegime ?? '—'}
                  </div>
                </div>

                {/* Signal */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>SIGNAL</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: colorAction(signal?.action ?? 'STABLE') }}>
                    {signal?.action ?? '—'}
                  </div>
                </div>

                {/* Trigger en attente de confirmation VWAP */}
                {signal?.pendingTrigger && (
                  <div style={{ marginBottom: 8, padding: '4px 8px', background: 'rgba(255,211,75,0.08)', borderRadius: 6, border: '1px solid rgba(255,211,75,0.2)' }}>
                    <div style={{ fontSize: 10, color: 'var(--accent-yellow)', fontFamily: 'monospace' }}>
                      TRIGGER EN ATTENTE — {signal.pendingTrigger.barsWaited}h / 8h
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      Confirmation VWAP : {signal.pendingTrigger.consecutiveCount}/2
                    </div>
                  </div>
                )}

                {/* Position ouverte */}
                {position ? (
                  <div style={{ marginBottom: 8, padding: '4px 8px', background: 'rgba(0,212,168,0.08)', borderRadius: 6, border: '1px solid rgba(0,212,168,0.2)' }}>
                    <div style={{ fontSize: 10, color: 'var(--accent-green)', fontFamily: 'monospace' }}>
                      {position.action} @ {position.entryPrice?.toFixed(0)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      SL {position.stopLoss?.toFixed(0)} · TP {position.takeProfit?.toFixed(0)}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>Pas de position</div>
                )}

                {/* Stats */}
                {stats && stats.total > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
                    <div style={{ color: 'var(--text-muted)' }}>Trades</div>
                    <div style={{ fontWeight: 700 }}>{stats.total}</div>
                    <div style={{ color: 'var(--text-muted)' }}>Win Rate</div>
                    <div style={{ fontWeight: 700, color: colorWR(stats.winrate) }}>{(stats.winrate ?? 0).toFixed(1)}%</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Stats globales */}
      {setupStats && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
            Performance globale
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {[
              { label: 'Trades', value: setupStats.total },
              { label: 'Wins', value: setupStats.wins },
              { label: 'Losses', value: setupStats.losses },
              { label: 'Win Rate', value: `${(setupStats.winrate ?? 0).toFixed(1)}%`, color: colorWR(setupStats.winrate ?? 0) },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: 'center', padding: '10px 0', background: 'var(--bg-primary)', borderRadius: 8 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: color ?? 'var(--text-primary)' }}>{value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Par session */}
      {sessionStats && sessionStats.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
            Par session
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sessionStats.map((s: { session: string; total: number; winrate: number }) => (
              <div key={s.session} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 8 }}>
                <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{s.session}</span>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'monospace' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{s.total} trades</span>
                  <span style={{ color: colorWR(s.winrate ?? 0), fontWeight: 700 }}>{(s.winrate ?? 0).toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liens backtest */}
      <div style={{ display: 'flex', gap: 12 }}>
        <a href="/backtest" style={{ flex: 1, textAlign: 'center', padding: '10px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-primary)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>
          📊 Backtest simple
        </a>
        <a href="/backtest/combined" style={{ flex: 1, textAlign: 'center', padding: '10px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-primary)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>
          📊 Backtest combiné
        </a>
        <a href="/api/analytics/export" style={{ flex: 1, textAlign: 'center', padding: '10px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-primary)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>
          📥 Export CSV trades
        </a>
        <a href="/api/signal" style={{ flex: 1, textAlign: 'center', padding: '10px', borderRadius: 8, border: '1px solid rgba(0,212,168,0.3)', background: 'rgba(0,212,168,0.06)', color: 'var(--accent-green)', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>
          📋 Export log signaux
        </a>
      </div>

    </div>
  )
}
