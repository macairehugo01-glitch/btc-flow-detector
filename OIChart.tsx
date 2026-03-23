'use client'

import { useMarketData } from '@/hooks/useMarketData'
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
import { useMarketStore } from '@/store/useMarketStore'
import { AlertCircle } from 'lucide-react'

export default function DashboardPage() {
  const { refresh } = useMarketData()
  const { error, isLoading } = useMarketStore()

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <Header onRefresh={refresh} />

      <main className="flex-1 max-w-[1800px] mx-auto w-full px-4 py-4 flex flex-col gap-4">
        {/* Error banner */}
        {error && (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
            style={{
              background: 'rgba(255, 71, 87, 0.08)',
              border: '1px solid rgba(255, 71, 87, 0.3)',
              color: 'var(--accent-red)',
            }}
          >
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse" />
            Chargement des données Binance...
          </div>
        )}

        {/* Stats bar */}
        <StatsBar />

        {/* Main grid */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
          {/* Left column — charts */}
          <div className="flex flex-col gap-4">
            {/* Price chart */}
            <PriceChart />

            {/* OI + CVD side by side on large screens */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <OIChart />
              <CVDChart />
            </div>

            {/* Setup history */}
            <SetupHistory />
          </div>

          {/* Right column — signal + conditions + settings */}
          <div className="flex flex-col gap-4">
            <SignalPanel />
            <OIStatsPanel />
            <ConditionsChecklist />
            <SettingsPanel />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        className="text-center py-3 text-xs font-mono border-t"
        style={{ borderColor: 'var(--bg-border)', color: 'var(--text-muted)' }}
      >
        BTC Flow Detector — Données Binance Futures — Refresh auto 10s — Not financial advice
      </footer>
    </div>
  )
}
