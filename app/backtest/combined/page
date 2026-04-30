'use client'

import { useState } from 'react'

type SlotStats = {
  slot: string
  trades: number
  wins: number
  winRate: number
  avgR: number
  expectancy: number
  tradesPerYear: number
}

type CombinedResults = {
  generatedAt: string
  missing: string[]
  slots: SlotStats[]
  combined: {
    totalTrades: number
    wins: number
    winRate: number
    avgR: number
    expectancy: number
    tradesPerYear: number
    tradesPerMonth: number
    simulation: {
      capital: number
      riskPct: number
      riskPerTrade: number
      annualProfit: number
      annualReturn: number
    }
  }
  bySession: { session: string; trades: number; winRate: number }[]
}

function colorWR(wr: number) {
  if (wr >= 70) return 'var(--accent-green)'
  if (wr >= 55) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}

function SlotCard({ s }: { s: SlotStats }) {
  const color = s.slot.includes('BTC') ? '#f7931a' : '#627eea'
  const tf = s.slot.includes('1h') ? '1H' : '15M'
  return (
    <div style={{
      background: 'var(--bg-card)', border: `1px solid ${color}44`,
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15, color }}>
          {s.slot.replace('-', ' ')}
        </div>
        <div style={{ fontSize: 11, background: `${color}22`, color, padding: '3px 8px', borderRadius: 6, fontFamily: 'monospace' }}>
          {tf}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Trades/an</div>
        <div style={{ fontWeight: 700 }}>{s.tradesPerYear}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Win Rate</div>
        <div style={{ fontWeight: 700, color: colorWR(s.winRate) }}>{s.winRate}%</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Avg R</div>
        <div style={{ fontWeight: 700, color: s.avgR >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{s.avgR}R</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Expectancy</div>
        <div style={{ fontWeight: 700, color: s.expectancy >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{s.expectancy}R/t</div>
      </div>
    </div>
  )
}

export default function BacktestCombinedPage() {
  const [results, setResults] = useState<CombinedResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/backtest/combined')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace' }}>Backtest Combiné</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              4 slots simultanés — BTC 1h · BTC 15m · ETH 1h · ETH 15m — Score 4/5 uniquement
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <a href="/backtest" style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace', textDecoration: 'none' }}>
              ← Backtest simple
            </a>
            <button onClick={run} disabled={loading} style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: 'var(--accent-green)', color: '#000',
              fontFamily: 'monospace', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>
              {loading ? '⏳ Calcul...' : '▶ Lancer Backtest Combiné'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.3)', color: 'var(--accent-red)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {/* Prérequis */}
        {!results && !loading && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, fontFamily: 'monospace' }}>Prérequis — Données nécessaires</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {['BTC 1h', 'BTC 15m', 'ETH 1h', 'ETH 15m'].map(slot => (
                <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 13, fontFamily: 'monospace' }}>
                  <span style={{ color: 'var(--accent-yellow)' }}>→</span>
                  <span>Collecter <strong>{slot}</strong> sur /backtest</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              Les slots avec données manquantes seront ignorés dans le calcul combiné.
            </div>
          </div>
        )}

        {results && (
          <>
            {/* Manquants */}
            {results.missing.length > 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,211,75,0.08)', border: '1px solid rgba(255,211,75,0.3)', color: 'var(--accent-yellow)', fontSize: 13, fontFamily: 'monospace' }}>
                ⚠ Slots manquants (données non collectées) : {results.missing.join(', ')}
              </div>
            )}

            {/* Stats par slot */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontFamily: 'monospace' }}>
                Performance par slot
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                {results.slots.map(s => <SlotCard key={s.slot} s={s} />)}
              </div>
            </div>

            {/* Stats combinées */}
            <div style={{ background: 'var(--bg-card)', border: '2px solid var(--accent-green)', borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-green)', marginBottom: 20, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Performance Combinée — 4 Slots
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                {[
                  { label: 'Total Trades/an', value: results.combined.tradesPerYear, sub: `${results.combined.tradesPerMonth}/mois` },
                  { label: 'Win Rate Global', value: `${results.combined.winRate}%`, color: colorWR(results.combined.winRate) },
                  { label: 'Avg R', value: `${results.combined.avgR}R`, color: results.combined.avgR >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' },
                  { label: 'Expectancy', value: `${results.combined.expectancy}R/t`, color: results.combined.expectancy >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} style={{ textAlign: 'center', padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 10 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: color ?? 'var(--text-primary)' }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>{label}</div>
                    {sub && <div style={{ fontSize: 11, color: 'var(--accent-yellow)', marginTop: 2 }}>{sub}</div>}
                  </div>
                ))}
              </div>

              {/* Simulation rendement */}
              <div style={{ borderTop: '1px solid var(--bg-border)', paddingTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16, fontFamily: 'monospace' }}>
                  Simulation Rendement — Capital 10 000€ · Risque 2%/trade
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <div style={{ padding: 16, background: 'rgba(0,212,168,0.06)', borderRadius: 10, border: '1px solid rgba(0,212,168,0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-green)' }}>
                      {results.combined.simulation.annualProfit.toLocaleString('fr-FR')}€
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>PROFIT ANNUEL ESTIMÉ</div>
                  </div>
                  <div style={{ padding: 16, background: 'rgba(0,212,168,0.06)', borderRadius: 10, border: '1px solid rgba(0,212,168,0.2)', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-green)' }}>
                      {results.combined.simulation.annualReturn}%
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>RENDEMENT ANNUEL</div>
                  </div>
                  <div style={{ padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--bg-border)', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent-yellow)' }}>
                      {results.combined.simulation.riskPerTrade}€
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>RISQUE / TRADE</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  ⚠ Simulation basée sur les résultats historiques — pas une garantie de performance future
                </div>
              </div>
            </div>

            {/* Par session */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontFamily: 'monospace' }}>
                Performance par session (combinée)
              </div>
              {results.bySession.map(s => (
                <div key={s.session} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{s.session}</span>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'monospace' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{s.trades} trades</span>
                    <span style={{ color: colorWR(s.winRate), fontWeight: 700 }}>{s.winRate}%</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
