import { Header } from '../index'
import StatsBar from '../StatsBar'
import { CVDChart } from '../CVDChart'
import { OIChart } from '../SettingsPanel'
import { PriceChart } from '../SignalPanel'
import { SetupHistory } from '../SetupHistory'
import OIStatsPanel from '../OIStatsPanel'
import { SettingsPanel } from '../SettingsPanel'

export default function Page() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 16 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Header onRefresh={() => {}} />
        <StatsBar />
        <PriceChart />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <OIChart />
          <CVDChart />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <SetupHistory />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>Signal Panel</div>
            <OIStatsPanel />
            <div>Conditions Checklist</div>
            <SettingsPanel />
          </div>
        </div>
      </div>
    </main>
  )
}
