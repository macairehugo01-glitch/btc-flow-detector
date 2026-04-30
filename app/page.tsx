'use client'

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
