'use client'

import { useState } from 'react'

type StatBlock = {
  trades: number
  wins: number
  winRate: number
  avgR: number
  expectancy: number
}

type SqueezeEvent = {
  triggerTime: number
  direction: 'up' | 'down'
  priceMovePct: number
  oiChangePct: number
  dominance: number
  atrAtTrigger: number
  confirmed: boolean
  barsToConfirm?: number
  action?: 'BUY' | 'SELL'
  entryPrice?: number
  slPrice?: number
  tpPrice?: number
  outcome: 'win' | 'loss' | 'breakeven' | 'no_confirmation'
  rMultiple: number
  barsToClose?: number
}

type SqueezeResults = {
  generatedAt: string
  symbol: string
  timeframe: string
  totalBars: number
  totalTriggers: number
  totalConfirmed: number
  confirmationRatePct: number
  overall: StatBlock
  byDirection: {
    up_to_sell: StatBlock
    down_to_buy: StatBlock
  }
  events: SqueezeEvent[]
}

function colorWR(wr: number) {
  if (wr >= 65) return 'var(--accent-green)'
  if (wr >= 50) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function PhaseBlock({ title, stats, color }: { title: string; stats: StatBlock; color: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${color}33`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 12, fontFamily: 'monospace' }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
        <div>Trades : <strong>{stats.trades}</strong></div>
        <div>Wins : <strong>{stats.wins}</strong></div>
        <div>Win Rate : <strong style={{ color: colorWR(stats.winRate) }}>{stats.winRate}%</strong></div>
        <div>Avg R : <strong style={{ color: stats.avgR >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{stats.avgR}R</strong></div>
        <div style={{ gridColumn: '1/-1' }}>
          Expectancy : <strong style={{ color: stats.expectancy >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{stats.expectancy}R/trade</strong>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontFamily: 'monospace' }}>
      {children}
    </div>
  )
}

function FunnelStep({ label, value, pctOfPrev, color }: { label: string; value: number; pctOfPrev?: string; color: string }) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>{label}</div>
      {pctOfPrev && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{pctOfPrev}</div>}
    </div>
  )
}

function FunnelArrow() {
  return <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)', fontSize: 18, padding: '0 8px' }}>→</div>
}

export default function SqueezeBacktestPage() {
  const [results, setResults] = useState<SqueezeResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collectMsg, setCollectMsg] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<'BTCUSDT' | 'ETHUSDT'>('BTCUSDT')
  const [tf, setTf] = useState<'1h' | '15m'>('1h')

  async function collect() {
    setCollecting(true); setCollectMsg(null); setError(null)
    try {
      const res = await fetch(`/api/backtest/collect?symbol=${symbol}&tf=${tf}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCollectMsg(`✓ ${data.bars} bougies ${symbol} ${tf} collectées${data.cached ? ' (cache)' : ''} — ${new Date(data.from ?? '').toLocaleDateString('fr-FR')} → ${new Date(data.to ?? '').toLocaleDateString('fr-FR')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur collecte')
    } finally {
      setCollecting(false)
    }
  }

  async function runBacktest() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/backtest/squeeze?symbol=${symbol}&tf=${tf}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur backtest')
    } finally {
      setLoading(false)
    }
  }

  // Distribution R réelle : avec RR=3 fixe et SL=-1, les valeurs possibles sont -1, 0 (timeout) ou +3
  const closedEvents = results ? results.events.filter(e => e.outcome === 'win' || e.outcome === 'loss' || e.outcome === 'breakeven') : []
  const rBuckets = results ? [
    { bucket: '-1R (loss)', count: closedEvents.filter(e => e.rMultiple < 0).length, color: 'var(--accent-red)' },
    { bucket: '0R (timeout)', count: closedEvents.filter(e => e.rMultiple === 0).length, color: 'var(--accent-yellow)' },
    { bucket: '+3R (win)', count: closedEvents.filter(e => e.rMultiple > 0).length, color: 'var(--accent-green)' },
  ] : []
  const maxRDist = Math.max(...rBuckets.map(r => r.count), 1)

  const bestDirection = results
    ? (results.byDirection.up_to_sell.expectancy >= results.byDirection.down_to_buy.expectancy ? 'up_to_sell' : 'down_to_buy')
    : null

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace' }}>Backtest Squeeze / Liquidation</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Impulsion + OI en baisse + dominance delta → stabilisation VWAP (proxy delta, pas de takerVolume réel)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['BTCUSDT', 'ETHUSDT'] as const).map(s => (
              <button key={s} onClick={() => { setSymbol(s); setResults(null) }} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid var(--bg-border)',
                background: symbol === s ? 'var(--accent-yellow)' : 'var(--bg-card)',
                color: symbol === s ? '#000' : 'var(--text-primary)',
                fontFamily: 'monospace', fontSize: 13, fontWeight: symbol === s ? 700 : 400, cursor: 'pointer',
              }}>
                {s.replace('USDT', '')}
              </button>
            ))}
            {(['1h', '15m'] as const).map(t => (
              <button key={t} onClick={() => { setTf(t); setResults(null) }} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid var(--bg-border)',
                background: tf === t ? 'var(--accent-yellow)' : 'var(--bg-card)',
                color: tf === t ? '#000' : 'var(--text-primary)',
                fontFamily: 'monospace', fontSize: 13, fontWeight: tf === t ? 700 : 400, cursor: 'pointer',
              }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={collect} disabled={collecting} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer' }}>
              {collecting ? '⏳ Collecte...' : '📥 Collecter données'}
            </button>
            <button onClick={runBacktest} disabled={loading} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-green)', color: '#000', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {loading ? '⏳ Calcul...' : '▶ Lancer Backtest Squeeze'}
            </button>
          </div>
        </div>

        {collectMsg && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,212,168,0.08)', border: '1px solid rgba(0,212,168,0.3)', color: 'var(--accent-green)', fontSize: 13, fontFamily: 'monospace' }}>
            {collectMsg}
          </div>
        )}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.3)', color: 'var(--accent-red)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {!results && !loading && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🧪</div>
            <div style={{ marginBottom: 8 }}>1. Clique sur "Collecter données" si pas déjà fait pour ce symbole/timeframe</div>
            <div>2. Clique sur "Lancer Backtest Squeeze" pour tester la nouvelle stratégie</div>
          </div>
        )}

        {results && (
          <>
            {/* Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard label="Bougies analysées" value={results.totalBars} />
              <StatCard label="Triggers détectés" value={results.totalTriggers} sub="Impulsion + OI down + dominance" />
              <StatCard
                label="Taux de confirmation"
                value={`${results.confirmationRatePct}%`}
                color={results.confirmationRatePct >= 50 ? 'var(--accent-green)' : 'var(--accent-yellow)'}
                sub={`${results.totalConfirmed} confirmés / ${results.totalTriggers}`}
              />
              <StatCard label="Période" value={new Date(results.generatedAt).toLocaleDateString('fr-FR')} />
            </div>

            {/* Funnel */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 20 }}>
              <SectionTitle>Entonnoir — du trigger au trade clôturé</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <FunnelStep label="Triggers bruts" value={results.totalTriggers} color="var(--accent-yellow)" />
                <FunnelArrow />
                <FunnelStep
                  label="Confirmés (stabilisation VWAP)"
                  value={results.totalConfirmed}
                  pctOfPrev={`${results.confirmationRatePct}%`}
                  color="#a78bfa"
                />
                <FunnelArrow />
                <FunnelStep
                  label="Clôturés (win/loss, hors timeout)"
                  value={results.overall.trades}
                  pctOfPrev={results.totalConfirmed > 0 ? `${Math.round((results.overall.trades / results.totalConfirmed) * 100)}%` : '—'}
                  color="var(--accent-green)"
                />
              </div>
            </div>

            {/* Performance globale + par direction */}
            <div>
              <SectionTitle>Performance — Global vs par direction</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <PhaseBlock title="Global" stats={results.overall} color="var(--accent-yellow)" />
                <PhaseBlock
                  title="Squeeze UP → SELL"
                  stats={results.byDirection.up_to_sell}
                  color={bestDirection === 'up_to_sell' ? 'var(--accent-green)' : '#a78bfa'}
                />
                <PhaseBlock
                  title="Liquidation DOWN → BUY"
                  stats={results.byDirection.down_to_buy}
                  color={bestDirection === 'down_to_buy' ? 'var(--accent-green)' : '#a78bfa'}
                />
              </div>
            </div>

            {/* Distribution R */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>Distribution des résultats (RR=3 fixe, SL=-1)</SectionTitle>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', height: 120 }}>
                {rBuckets.map(({ bucket, count, color }) => (
                  <div key={bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{count}</div>
                    <div style={{
                      width: '100%',
                      height: `${Math.round((count / maxRDist) * 90)}px`,
                      background: color,
                      borderRadius: '4px 4px 0 0', minHeight: 4,
                    }} />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{bucket}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Détail des événements */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>Détail des triggers (les plus récents en premier)</SectionTitle>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, fontFamily: 'monospace', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bg-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Date</th>
                      <th style={{ padding: '6px 8px' }}>Direction</th>
                      <th style={{ padding: '6px 8px' }}>Move %</th>
                      <th style={{ padding: '6px 8px' }}>OI %</th>
                      <th style={{ padding: '6px 8px' }}>Dominance</th>
                      <th style={{ padding: '6px 8px' }}>Confirmé</th>
                      <th style={{ padding: '6px 8px' }}>Action</th>
                      <th style={{ padding: '6px 8px' }}>Outcome</th>
                      <th style={{ padding: '6px 8px' }}>R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...results.events].reverse().slice(0, 100).map((e, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--text-secondary)' }}>
                          {new Date(e.triggerTime * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ padding: '6px 8px', color: e.direction === 'up' ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                          {e.direction === 'up' ? 'UP (squeeze)' : 'DOWN (liq.)'}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{e.priceMovePct.toFixed(2)}%</td>
                        <td style={{ padding: '6px 8px' }}>{e.oiChangePct.toFixed(2)}%</td>
                        <td style={{ padding: '6px 8px' }}>{e.dominance.toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', color: e.confirmed ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {e.confirmed ? `oui (+${e.barsToConfirm}b)` : 'non'}
                        </td>
                        <td style={{ padding: '6px 8px', fontWeight: 700, color: e.action === 'SELL' ? 'var(--accent-red)' : e.action === 'BUY' ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {e.action ?? '—'}
                        </td>
                        <td style={{ padding: '6px 8px', color: e.outcome === 'win' ? 'var(--accent-green)' : e.outcome === 'loss' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {e.outcome}
                        </td>
                        <td style={{ padding: '6px 8px', fontWeight: 700, color: e.rMultiple > 0 ? 'var(--accent-green)' : e.rMultiple < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                          {e.rMultiple > 0 ? `+${e.rMultiple}` : e.rMultiple}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
