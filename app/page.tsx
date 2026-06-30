'use client'
import { useEffect, useState } from 'react'
import { Header } from '../index'
import StatsBar from '../StatsBar'
import { CVDChart } from '../CVDChart'
import { OIChart, SettingsPanel } from '../SettingsPanel'
import { PriceChart } from '../SignalPanel'
import { SetupHistory } from '../SetupHistory'
import OIStatsPanel from '../OIStatsPanel'
import TradeSignalPanel from '../TradeSignalPanel'
import ConditionsChecklist from '../ConditionsChecklist'
import AnalyticsPanel from '../AnalyticsPanel'
import { useMarketData } from '../useMarketData'
import { useMarketStore } from '../useMarketStore'

// ─────────────────────────────────────────────────────────────────────────
// PANNEAU V2 — moteur cloche d'OI + VWAP + Dow theory, BTC/ETH/SOL en M15.
// Volontairement AUTONOME : son propre fetch + state, ne dépend pas de
// useMarketData/useMarketStore (logique v1, jamais étendue à v2). XRP est
// absent par design (edge inversé sous ce filtre, voir analyse du
// 30/06/2026) — ne pas l'ajouter ici sans une analyse dédiée.
// ─────────────────────────────────────────────────────────────────────────

type V2SlotSignal = {
  action: 'BUY' | 'SELL' | 'STABLE'
  reasons: string[]
  vwap: number
  dailyRegime: 'up' | 'down' | 'undefined'
  pendingTrigger: { crossTime: number; direction: 'up' | 'down'; barsWaited: number; consecutiveCount: number } | null
}

type V2Position = {
  setupId: string
  slot: string
  action: 'BUY' | 'SELL'
  entryPrice: number
  stopLoss: number
  takeProfit: number
  openedAt: number
  timeframe: string
} | null

type V2Response = {
  slotSignals: Record<string, V2SlotSignal>
  allPositions: Record<string, V2Position>
  lastUpdate: number
  engine: string
  error?: string
}

const V2_POLL_MS = 10_000
const V2_SLOTS = ['BTC-15m-v2', 'ETH-15m-v2', 'SOL-15m-v2']

function v2RegimeColor(regime: string) {
  if (regime === 'up') return '#2ed573'
  if (regime === 'down') return '#ff4757'
  return '#888'
}

function v2ActionColor(action: string) {
  if (action === 'BUY') return '#2ed573'
  if (action === 'SELL') return '#ff4757'
  return '#888'
}

function V2Panel() {
  const [data, setData] = useState<V2Response | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/squeeze-v2', { cache: 'no-store' })
        const json: V2Response = await res.json()
        if (cancelled) return
        if (json.error) setError(json.error)
        else { setData(json); setError(null) }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur réseau')
      }
    }
    poll()
    const interval = setInterval(poll, V2_POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return (
    <div style={{ border: '1px solid var(--bg-border)', borderRadius: 10, padding: 16, background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 12, color: 'var(--text-primary)' }}>
        Moteur V2 — Cloche d'OI + Dow theory (BTC/ETH/SOL, M15)
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#ff4757', marginBottom: 8 }}>⚠ {error}</div>
      )}
      {!data && !error && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chargement...</div>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {V2_SLOTS.map(slot => {
            const sig = data.slotSignals?.[slot]
            const pos = data.allPositions?.[slot]
            if (!sig) return null
            return (
              <div key={slot} style={{ borderTop: '1px solid var(--bg-border)', paddingTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ fontWeight: 'bold' }}>{slot}</span>
                  <span style={{ color: v2RegimeColor(sig.dailyRegime) }}>régime : {sig.dailyRegime}</span>
                </div>
                <div style={{ fontSize: 12, color: v2ActionColor(sig.action) }}>{sig.action}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {sig.reasons.map((r, i) => <div key={i}>{r}</div>)}
                </div>
                {sig.pendingTrigger && (
                  <div style={{ fontSize: 11, color: '#ffa502', marginTop: 4 }}>
                    Trigger {sig.pendingTrigger.direction === 'up' ? 'SELL' : 'BUY'} en attente —
                    {' '}{sig.pendingTrigger.consecutiveCount}/2 confirmées,
                    {' '}{sig.pendingTrigger.barsWaited}/8 bougies
                  </div>
                )}
                {pos && (
                  <div style={{ fontSize: 11, marginTop: 4, color: v2ActionColor(pos.action) }}>
                    Position ouverte : {pos.action} @ {pos.entryPrice}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

export default function Page() {
  const { refresh } = useMarketData()
  const { error, isLoading, ticker, signal } = useMarketStore()
  const isReady = !isLoading && ticker !== null && signal !== null
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Header onRefresh={refresh} />
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.3)', color: 'var(--accent-red)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}
        {!isReady && (
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>
            Chargement des données marché...
          </div>
        )}
        {isReady && (
          <>
            <StatsBar />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 16, alignItems: 'start' }}>
              {/* Colonne principale */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <PriceChart />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <OIChart />
                  <CVDChart />
                </div>
                <SetupHistory />
                <AnalyticsPanel />
              </div>
              {/* Colonne droite */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <TradeSignalPanel />
                <OIStatsPanel />
                <ConditionsChecklist />
                <SettingsPanel />
                {/* Nouveau — moteur v2, bloc autonome, voir plus haut */}
                <V2Panel />
              </div>
            </div>
            {/* Liens backtest */}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', paddingBottom: 24 }}>
              <a href="/backtest" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>
                📊 Backtest simple
              </a>
              <a href="/backtest/combined" style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--bg-border)', background: 'var(--bg-card)', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, textDecoration: 'none' }}>
                📊 Backtest combiné 4 slots
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
