'use client'

import { Header } from '../index'
import StatsBar from '../StatsBar'
import { CVDChart } from '../CVDChart'
import { OIChart, SettingsPanel } from '../SettingsPanel'
import { PriceChart } from '../SignalPanel'
import { SetupHistory } from '../SetupHistory'
import OIStatsPanel from '../OIStatsPanel'
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
            Chargement des données Binance...
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
            <PriceChart />
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
            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--bg-border)',
                borderRadius: 12,
                padding: 16,
              }}
            >
              Signal Panel
            </div>

            <OIStatsPanel />

            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--bg-border)',
                borderRadius: 12,
                padding: 16,
              }}
            >
              Conditions Checklist
            </div>

            <SettingsPanel />
          </div>
        </div>
      </div>
    </main>
  )
}
