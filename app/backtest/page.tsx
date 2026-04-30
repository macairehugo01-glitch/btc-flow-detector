'use client'

import { useState } from 'react'

type StatBlock = {
  trades: number
  wins: number
  winRate: number
  avgR: number
  expectancy: number
}

type BacktestResults = {
  generatedAt: string
  symbol: string
  totalBars: number
  totalSweeps: number
  L: StatBlock
  LF: StatBlock
  LFR: StatBlock
  byScore: Record<number, StatBlock>
  fundingFilter: {
    aligned: StatBlock
    neutral: StatBlock
    counter: StatBlock
  }
  oiFilter: {
    withExpansion: { trades: number; wins: number; winRate: number }
    withoutExpansion: { trades: number; wins: number; winRate: number }
  }
  bySession: Record<string, StatBlock>
  byHTFContext: Record<string, StatBlock>
  bySweepAge: Record<string, StatBlock>
  rDistribution: { bucket: string; count: number }[]
  suggestedWeights: {
    L: number; F_oi: number; F_cvd: number; F_funding: number; R_vwap: number; R_structure: number
  }
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

function StatRow({ label, stats, highlight }: { label: string; stats: StatBlock; highlight?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 14px', background: highlight ? 'rgba(0,212,168,0.06)' : 'rgba(255,255,255,0.03)',
      borderRadius: 8, border: highlight ? '1px solid rgba(0,212,168,0.2)' : '1px solid var(--bg-border)',
      marginBottom: 6,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{label}</span>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'monospace' }}>
        <span style={{ color: 'var(--text-muted)' }}>{stats.trades}T</span>
        <span style={{ color: colorWR(stats.winRate), fontWeight: 700, minWidth: 45, textAlign: 'right' }}>{stats.winRate}%</span>
        <span style={{ color: stats.avgR >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', minWidth: 50, textAlign: 'right' }}>{stats.avgR}R avg</span>
        <span style={{ color: stats.expectancy >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', minWidth: 70, textAlign: 'right' }}>{stats.expectancy}R/t</span>
      </div>
    </div>
  )
}

export default function BacktestPage() {
  const [results, setResults] = useState<BacktestResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collectMsg, setCollectMsg] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<'BTCUSDT' | 'ETHUSDT'>('BTCUSDT')

  async function collect() {
    setCollecting(true); setCollectMsg(null); setError(null)
    try {
      const res = await fetch(`/api/backtest/collect?symbol=${symbol}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCollectMsg(`✓ ${data.bars} bougies ${symbol} collectées${data.cached ? ' (cache)' : ''} — ${new Date(data.from ?? '').toLocaleDateString('fr-FR')} → ${new Date(data.to ?? '').toLocaleDateString('fr-FR')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur collecte')
    } finally {
      setCollecting(false)
    }
  }

  async function runBacktest() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/backtest/run?symbol=${symbol}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur backtest')
    } finally {
      setLoading(false)
    }
  }

  const maxRDist = results ? Math.max(...results.rDistribution.map(r => r.count), 1) : 1

  // Trouver la meilleure session
  const bestSession = results ? Object.entries(results.bySession)
    .filter(([, s]) => s.trades >= 3)
    .sort(([, a], [, b]) => b.winRate - a.winRate)[0]?.[0] : null

  // Meilleur age sweep
  const bestAge = results ? Object.entries(results.bySweepAge)
    .filter(([, s]) => s.trades >= 3)
    .sort(([, a], [, b]) => b.winRate - a.winRate)[0]?.[0] : null

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace' }}>Backtest LFR</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Validation empirique — Sessions · Funding directionnel · HTF Context · Age du sweep
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
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={collect} disabled={collecting} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13, cursor: 'pointer' }}>
              {collecting ? '⏳ Collecte...' : '📥 Collecter données'}
            </button>
            <button onClick={runBacktest} disabled={loading} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'var(--accent-green)', color: '#000', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              {loading ? '⏳ Calcul...' : '▶ Lancer Backtest'}
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
            <div style={{ fontSize: 32, marginBottom: 16 }}>📊</div>
            <div style={{ marginBottom: 8 }}>1. Clique sur "Collecter données" pour charger l'historique Bybit</div>
            <div>2. Clique sur "Lancer Backtest" pour valider ta stratégie LFR</div>
          </div>
        )}

        {results && (
          <>
            {/* Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard label="Bougies analysées" value={results.totalBars} />
              <StatCard label="Sweeps détectés" value={results.totalSweeps} />
              <StatCard label="Période" value={new Date(results.generatedAt).toLocaleDateString('fr-FR')} />
              <StatCard label="Edge L seul" value={`${results.L.winRate}%`} color={colorWR(results.L.winRate)} sub="Win rate sweep sans filtre" />
            </div>

            {/* Phases */}
            <div>
              <SectionTitle>Validation par phase — L → LF → LFR</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <PhaseBlock title="L seul (Sweep)" stats={results.L} color="var(--accent-yellow)" />
                <PhaseBlock title="L+F (Sweep + CVD)" stats={results.LF} color="#a78bfa" />
                <PhaseBlock title="L+F+R complet (≥4/5)" stats={results.LFR} color="var(--accent-green)" />
              </div>
            </div>

            {/* Score */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>Win Rate par Score 0–5</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {[1, 2, 3, 4, 5].map(sc => {
                  const s = results.byScore[sc]
                  if (!s) return null
                  return (
                    <div key={sc} style={{ textAlign: 'center', padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--bg-border)' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: colorWR(s.winRate) }}>{s.winRate}%</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Score {sc}/5</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{s.trades} trades</div>
                      <div style={{ fontSize: 11, color: s.avgR >= 0 ? 'var(--accent-green)' : 'var(--accent-red)', marginTop: 2 }}>{s.avgR}R avg</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* AMÉLIORATION 1 — Sessions */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>📅 Amélioration 1 — Performance par Session</SectionTitle>
              {bestSession && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(0,212,168,0.08)', borderRadius: 8, fontSize: 12, color: 'var(--accent-green)', fontFamily: 'monospace' }}>
                  💡 Meilleure session : <strong>{bestSession}</strong> — trade prioritairement pendant cette session
                </div>
              )}
              {Object.entries(results.bySession).map(([session, stats]) => (
                <StatRow key={session} label={session} stats={stats} highlight={session === bestSession} />
              ))}
            </div>

            {/* AMÉLIORATION 2 — Funding directionnel */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>💰 Amélioration 2 — Funding Directionnel</SectionTitle>
              <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                Aligned = funding dans le sens du sweep (positif → SELL, négatif → BUY)
              </div>
              <StatRow label="Funding aligné avec sweep" stats={results.fundingFilter.aligned} highlight={results.fundingFilter.aligned.winRate > results.fundingFilter.neutral.winRate} />
              <StatRow label="Funding neutre" stats={results.fundingFilter.neutral} />
              <StatRow label="Funding contre sweep" stats={results.fundingFilter.counter} />
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                💡 Si "aligné" &gt; "neutre" → ajouter le funding comme critère de scoring directionnel
              </div>
            </div>

            {/* AMÉLIORATION 3 — HTF Context */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>📈 Amélioration 3 — Contexte HTF (Trend vs Range)</SectionTitle>
              <StatRow label="Tendance alignée" stats={results.byHTFContext['trend_aligned'] ?? { trades: 0, wins: 0, winRate: 0, avgR: 0, expectancy: 0 }} highlight />
              <StatRow label="Range (consolidation)" stats={results.byHTFContext['range'] ?? { trades: 0, wins: 0, winRate: 0, avgR: 0, expectancy: 0 }} />
              <StatRow label="Contre-tendance" stats={results.byHTFContext['counter_trend'] ?? { trades: 0, wins: 0, winRate: 0, avgR: 0, expectancy: 0 }} />
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                💡 Si "tendance alignée" domine → filtrer les sweeps en contre-tendance
              </div>
            </div>

            {/* AMÉLIORATION 4 — Age du sweep */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>⏱ Amélioration 4 — Age Optimal du Sweep</SectionTitle>
              {bestAge && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(0,212,168,0.08)', borderRadius: 8, fontSize: 12, color: 'var(--accent-green)', fontFamily: 'monospace' }}>
                  💡 Meilleur timing : sweep <strong>{bestAge}</strong> — ajuster le TTL en conséquence
                </div>
              )}
              <StatRow label="Fresh (0-2 bougies)" stats={results.bySweepAge['fresh'] ?? { trades: 0, wins: 0, winRate: 0, avgR: 0, expectancy: 0 }} highlight={bestAge === 'fresh'} />
              <StatRow label="Recent (3-6 bougies)" stats={results.bySweepAge['recent'] ?? { trades: 0, wins: 0, winRate: 0, avgR: 0, expectancy: 0 }} highlight={bestAge === 'recent'} />
              <StatRow label="Old (>6 bougies)" stats={results.bySweepAge['old'] ?? { trades: 0, wins: 0, winRate: 0, avgR: 0, expectancy: 0 }} highlight={bestAge === 'old'} />
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                💡 Si "old" a un win rate plus faible → réduire le TTL du sweep dans route.ts
              </div>
            </div>

            {/* Distribution R */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>Distribution des R</SectionTitle>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
                {results.rDistribution.map(({ bucket, count }) => (
                  <div key={bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{count}</div>
                    <div style={{
                      width: '100%',
                      height: `${Math.round((count / maxRDist) * 90)}px`,
                      background: bucket.startsWith('+') ? 'var(--accent-green)' : bucket === '0R' ? 'var(--accent-yellow)' : 'var(--accent-red)',
                      borderRadius: '4px 4px 0 0', minHeight: 4,
                    }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{bucket}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Poids suggérés */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <SectionTitle>Poids suggérés (calibrés sur tes données)</SectionTitle>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Lift de win rate apporté par chaque critère — remplace l'équipondération actuelle
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                {Object.entries(results.suggestedWeights).map(([key, val]) => (
                  <div key={key} style={{ textAlign: 'center', padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--bg-border)' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: (val as number) > 0.05 ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>
                      +{((val as number) * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{key.replace('_', ' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
