'use client'
import { useMarketStore } from './useMarketStore'
import type { StoredSetup } from '@/types'

const STATE_SHORT: Record<string, string> = {
  majority_trap_short: 'Trap Short',
  bullish_reset_long:  'Reset Long',
  continuation_long:   'Continuation',
  neutral:             'Neutre',
}

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function SetupHistory() {
  const { setupHistory } = useMarketStore()

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)' }}>⏱ Historique des Setups</span>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', background: 'var(--bg-border)', borderRadius: 4, padding: '2px 8px' }}>{setupHistory.length}</span>
      </div>

      {setupHistory.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Aucun setup enregistré — les signaux actifs apparaîtront ici
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['Heure', 'Setup', 'Signal', 'Score', 'Entrée', 'SL', 'TP'].map(h => (
                  <th key={h} style={{ textAlign: 'left', paddingBottom: 8, paddingRight: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {setupHistory.map(s => <SetupRow key={s.id} setup={s} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SetupRow({ setup }: { setup: StoredSetup }) {
  const isLong = setup.signal === 'long'
  const sigColor = isLong ? 'var(--accent-green)' : 'var(--accent-red)'
  const scoreColor = setup.score >= 6 ? 'var(--accent-green)' : setup.score >= 4 ? 'var(--accent-yellow)' : 'var(--text-muted)'

  return (
    <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
      <td style={{ padding: '8px 12px 8px 0', color: 'var(--text-muted)' }}>{fmt(setup.timestamp)}</td>
      <td style={{ paddingRight: 12, color: 'var(--text-secondary)' }}>{STATE_SHORT[setup.marketState]}</td>
      <td style={{ paddingRight: 12, color: sigColor, fontWeight: 700 }}>{isLong ? '▲' : '▼'} {setup.signal.toUpperCase()}</td>
      <td style={{ paddingRight: 12, color: scoreColor, fontWeight: 700 }}>{setup.score}</td>
      <td style={{ paddingRight: 12, color: 'var(--accent-blue)' }}>${setup.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
      <td style={{ paddingRight: 12, color: 'var(--accent-red)' }}>${setup.stopLoss.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
      <td style={{ color: 'var(--accent-green)' }}>${setup.takeProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
    </tr>
  )
}
