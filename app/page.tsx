'use client'
import { useMarketData } from '@/hooks/useMarketData'
import { useMarketStore } from '@/store/useMarketStore'
import { Header } from '@/components/Header'
import { StatsBar } from '@/components/StatsBar'
import { PriceChart } from '@/components/charts/PriceChart'
import { OIChart } from '@/components/charts/OIChart'
import { CVDChart } from '@/components/charts/CVDChart'
import { SignalPanel } from '@/components/panels/SignalPanel'
import { ConditionsChecklist } from '@/components/panels/ConditionsChecklist'
import { OIStatsPanel } from '@/components/panels/OIStatsPanel'
import { SetupHistory } from '@/components/panels/SetupHistory'
import { SettingsPanel } from '@/components/panels/SettingsPanel'

export default function Page() {
  const { refresh } = useMarketData()
  const { error, isLoading } = useMarketStore()

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <Header onRefresh={refresh} />

      <main style={{ flex: 1, maxWidth: 1800, margin: '0 auto', width: '100%', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ padding: '8px 16px', borderRadius: 8, background: 'rgba(255,71,87,0.08)', border: '1px solid rgba(255,71,87,0.3)', color: 'var(--accent-red)', fontSize: 13 }}>
            ⚠ {error}
          </div>
        )}

        {isLoading && (
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-green)', display: 'inline-block' }} />
            Chargement des données Binance...
          </div>
        )}

        <StatsBar />

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PriceChart />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <OIChart />
              <CVDChart />
            </div>
            <SetupHistory />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SignalPanel />
            <OIStatsPanel />
            <ConditionsChecklist />
            <SettingsPanel />
          </div>
        </div>
      </main>

      <footer style={{ textAlign: 'center', padding: '12px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', borderTop: '1px solid var(--bg-border)' }}>
        BTC Flow Detector — Données Binance Futures — Refresh auto 10s — Not financial advice
      </footer>
    </div>
  )
}
