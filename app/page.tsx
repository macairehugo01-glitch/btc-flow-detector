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

type Trade = {
  id: string
  slot: string
  action: 'BUY' | 'SELL'
  entryPrice: number
  stopLoss: number
  takeProfit: number
  status: 'open' | 'win' | 'loss'
  rMultiple?: number
  timestamp: number
}

const V1_SLOTS = ['BTC-1h', 'ETH-1h', 'SOL-1h', 'XRP-1h']
const V2_SLOTS = ['BTC-15m-v2', 'ETH-15m-v2', 'SOL-15m-v2']

function statusColor(s: string) {
  if (s === 'win') return '#2ed573'
  if (s === 'loss') return '#ff4757'
  return '#ffa502'
}

function TradeTable({ title, trades }: { title: string; trades: Trade[] }) {
  return (
    <div style={{ border: '1px solid var(--bg-border)', borderRadius: 10, padding: 16, background: 'var(--bg-card)', flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 'bold', marginBottom: 12 }}>{title}</div>
      {trades.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aucun trade encore.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--bg-border)' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Slot</th>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Action</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Entrée</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>SL</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>TP</th>
              <th style={{ textAlign: 'center', padding: '4px 6px' }}>Statut</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>R</th>
              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--bg-border)' }}>
                <td style={{ padding: '4px 6px' }}>{t.slot}</td>
                <td style={{ padding: '4px 6px', color: t.action === 'BUY' ? '#2ed573' : '#ff4757' }}>{t.action}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{t.entryPrice}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: '#ff4757' }}>{t.stopLoss.toFixed(4)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: '#2ed573' }}>{t.takeProfit.toFixed(4)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'center', color: statusColor(t.status) }}>{t.status}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: statusColor(t.status) }}>
                  {t.rMultiple != null ? `${t.rMultiple > 0 ? '+' : ''}${t.rMultiple.toFixed(2)}R` : '—'}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  {new Date(t.timestamp).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function Page() {
  const { refresh } = useMarketData()
  const { error, isLoading, ticker, signal } = useMarketStore()
  const isReady = !isLoading && ticker !== null && signal !== null

  const [v1Trades, setV1Trades] = useState<Trade[]>([])
  const [v2Trades, setV2Trades] = useState<Trade[]>([])

  useEffect(() => {
    async function fetchTrades() {
      try {
        const res = await fetch('/api/cvd', { cache: 'no-store' })
        const json = await res.json()
        const all: Trade[] = json.setupHistory ?? []
        setV1Trades(all.filter(t => V1_SLOTS.includes(t.slot)))
        setV2Trades(all.filter(t => V2_SLOTS.includes(t.slot)))
      } catch {}
    }
    fetchTrades()
    const id = setInterval(fetchTrades, 30_000)
    return () => clearInterval(id)
  }, [])

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <PriceChart />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <OIChart />
                  <CVDChart />
                </div>
                <SetupHistory />
                <AnalyticsPanel />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <TradeSignalPanel />
                <OIStatsPanel />
                <ConditionsChecklist />
                <SettingsPanel />
              </div>
            </div>

            {/* Deux tableaux de trades côte à côte */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'start' }}>
              <TradeTable title="Trades V1 — BTC/ETH/SOL/XRP (H1)" trades={v1Trades} />
              <TradeTable title="Trades V2 — BTC/ETH/SOL (M15)" trades={v2Trades} />
            </div>

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
