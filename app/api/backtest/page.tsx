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
  totalBars: number
  totalSweeps: number
  L: StatBlock
  LF: StatBlock
  LFR: StatBlock
  byScore: Record<number, StatBlock & { trades: number; wins: number; winRate: number; avgR: number }>
  fundingFilter: {
    withExtreme: { trades: number; wins: number; winRate: number }
    withoutExtreme: { trades: number; wins: number; winRate: number }
  }
  oiFilter: {
    withExpansion: { trades: number; wins: number; winRate: number }
    withoutExpansion: { trades: number; wins: number; winRate: number }
  }
  rDistribution: { bucket: string; count: number }[]
  suggestedWeights: {
    L: number; F_oi: number; F_cvd: number; R_vwap: number; R_structure: number
  }
}

function colorWR(wr: number) {
  if (wr >= 60) return 'var(--accent-green)'
  if (wr >= 50) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--bg-border)',
      borderRadius: 12,
      padding: 16,
    }}>
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color ?? 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function PhaseBlock({ title, stats, color }: { title: string; stats: StatBlock; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${color}33`,
      borderRadius: 12,
      padding: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 12, fontFamily: 'monospace' }}>
        {title}
      </div>
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

export default function BacktestPage() {
  const [results, setResults] = useState<BacktestResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collectMsg, setCollectMsg] = useState<string | null>(null)

  async function collect() {
    setCollecting(true)
    setCollectMsg(null)
    setError(null)
    try {
      const res = await fetch('/api/backtest/collect')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCollectMsg(`✓ ${data.bars} bougies 4h collectées${data.cached ? ' (cache)' : ''} — de ${new Date(data.from ?? '').toLocaleDateString('fr-FR')} à ${new Date(data.to ?? '').toLocaleDateString('fr-FR')}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur collecte')
    } finally {
      setCollecting(false)
    }
  }

  async function runBacktest() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/backtest/run')
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

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace' }}>Backtest LFR</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Validation empirique de la stratégie sur données 4h historiques Bybit
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={collect}
              disabled={collecting}
              style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid var(--bg-border)',
                background: 'var(--bg-card)', color: 'var(--text-primary)',
                fontFamily: 'monospace', fontSize: 13, cursor: 'pointer',
              }}
            >
              {collecting ? '⏳ Collecte...' : '📥 Collecter données 4h'}
            </button>
            <button
              onClick={runBacktest}
              disabled={loading}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                background: 'var(--accent-green)', color: '#000',
                fontFamily: 'monospace', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
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
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12,
            padding: 48, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'monospace',
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📊</div>
            <div style={{ marginBottom: 8 }}>1. Clique sur "Collecter données 4h" pour charger l'historique Bybit</div>
            <div>2. Clique sur "Lancer Backtest" pour valider ta stratégie LFR</div>
          </div>
        )}

        {results && (
          <>
            {/* Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <StatCard label="Bougies 4h analysées" value={results.totalBars} />
              <StatCard label="Sweeps détectés" value={results.totalSweeps} />
              <StatCard label="Période" value={new Date(results.generatedAt).toLocaleDateString('fr-FR')} />
              <StatCard
                label="Edge L seul"
                value={`${results.L.winRate}%`}
                sub="Win rate sweep sans filtre"
                color={colorWR(results.L.winRate)}
              />
            </div>

            {/* Phases LFR */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Validation par phase — L → LF → LFR
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                <PhaseBlock title="L seul (Sweep uniquement)" stats={results.L} color="var(--accent-yellow)" />
                <PhaseBlock title="L+F (Sweep + Flow)" stats={results.LF} color="#a78bfa" />
                <PhaseBlock title="L+F+R complet (≥4/5)" stats={results.LFR} color="var(--accent-green)" />
              </div>
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--bg-border)', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                💡 Si L seul &lt; 55% → la base de la stratégie n'a pas d'edge statistique. Si LFR &gt; L → les filtres F et R apportent de la valeur réelle.
              </div>
            </div>

            {/* Win rate par score */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Win Rate par Score 0–5
              </div>
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
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                💡 Si le score 4 et 5 n'ont pas un win rate significativement supérieur au score 2-3, le seuil 4/5 n'est pas optimal.
              </div>
            </div>

            {/* Filtres Funding & OI */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Funding comme filtre
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'Funding extrême (|f| > 0.08%)', data: results.fundingFilter.withExtreme },
                    { label: 'Funding neutre', data: results.fundingFilter.withoutExtreme },
                  ].map(({ label, data }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'monospace' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{data.trades}T</span>
                        <span style={{ color: colorWR(data.winRate), fontWeight: 700 }}>{data.winRate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  💡 Signal natif crypto — si le funding extrême améliore le WR, c'est ton meilleur filtre.
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  OI Expansion comme filtre
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'Avec expansion OI pendant sweep', data: results.oiFilter.withExpansion },
                    { label: 'Sans expansion OI', data: results.oiFilter.withoutExpansion },
                  ].map(({ label, data }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'monospace' }}>
                        <span style={{ color: 'var(--text-muted)' }}>{data.trades}T</span>
                        <span style={{ color: colorWR(data.winRate), fontWeight: 700 }}>{data.winRate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  💡 Si OI expansion n'améliore pas le WR → ce critère est du bruit, retire-le.
                </div>
              </div>
            </div>

            {/* Distribution R */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Distribution des R
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 120 }}>
                {results.rDistribution.map(({ bucket, count }) => (
                  <div key={bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{count}</div>
                    <div style={{
                      width: '100%',
                      height: `${Math.round((count / maxRDist) * 90)}px`,
                      background: bucket.startsWith('+') ? 'var(--accent-green)' : bucket === '0R' ? 'var(--accent-yellow)' : 'var(--accent-red)',
                      borderRadius: '4px 4px 0 0',
                      minHeight: 4,
                    }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{bucket}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Poids suggérés */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Poids suggérés (calibrés sur tes données)
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Lift de win rate apporté par chaque critère — remplace l'équipondération actuelle (1pt chacun)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {Object.entries(results.suggestedWeights).map(([key, val]) => (
                  <div key={key} style={{ textAlign: 'center', padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--bg-border)' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: (val as number) > 0.05 ? 'var(--accent-green)' : 'var(--accent-yellow)' }}>
                      +{((val as number) * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {key.replace('_', ' ')}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                💡 Un lift &gt;5% = critère qui apporte un edge réel. Un lift &lt;2% = critère à retirer ou reconsidérer.
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
