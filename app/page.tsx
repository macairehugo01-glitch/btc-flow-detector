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
import EconomicCalendarPanel from '../EconomicCalendarPanel'
import { useMarketData } from '../useMarketData'
import { useMarketStore } from '../useMarketStore'

export default function Page() {
  const { refresh } = useMarketData()
  const { error, isLoading } = useMarketStore()

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Header onRefresh={refresh} />

      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: 'rgba(255,71,87,0.08)',
              border: '1px solid rgba(255,71,87,0.3)',
              color: 'var(--accent-red)',
              fontSize: 13,
            }}
          >
            ⚠ {error}
          </div>
        )}

        {isLoading && (
          <div
            style={{
              fontSize: 12,
              fontFamily: 'monospace',
              color: 'var(--text-muted)',
            }}
          >
            Chargement des données marché...
          </div>
        )}

        <StatsBar />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 320px',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr',
                gap: 16,
                alignItems: 'stretch',
              }}
            >
              <PriceChart />
              <EconomicCalendarPanel />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
              }}
            >
              <OIChart />
              <CVDChart />
            </div>

            <SetupHistory />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <TradeSignalPanel />
            <OIStatsPanel />
            <ConditionsChecklist />
            <SettingsPanel />
          </div>
        </div>
      </div>
    </main>
  )
}
