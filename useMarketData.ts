'use client'
import { useMarketStore } from './store/useMarketStore'
import type { PatternResult } from '@/types'

const STATE_LABELS: Record<string, string> = {
  majority_trap_short: 'Majority Trap Short',
  bullish_reset_long: 'Bullish Reset Long',
  continuation_long: 'Continuation Long',
  neutral: 'Neutre',
}

const S = {
  card: { background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' as const, gap: 16 },
  label: { fontSize: 11, fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'var(--text-muted)' },
}

export function SignalPanel() {
  const { pattern } = useMarketStore()
  if (!pattern) return (
    <div style={S.card}>
      <span style={S.label}>Signal Panel</span>
      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>En attente de données...</div>
    </div>
  )
  return <SignalContent pattern={pattern} />
}

function SignalContent({ pattern }: { pattern: PatternResult }) {
  const cfg = {
    long:  { color: 'var(--accent-green)', bg: 'rgba(0,212,168,0.08)',  border: 'rgba(0,212,168,0.3)',  label: 'LONG ▲' },
    short: { color: 'var(--accent-red)',   bg: 'rgba(255,71,87,0.08)', border: 'rgba(255,71,87,0.3)',  label: 'SHORT ▼' },
    none:  { color: 'var(--text-muted)',   bg: 'rgba(74,85,104,0.08)', border: 'rgba(74,85,104,0.2)',  label: 'NEUTRE —' },
  }[pattern.signal]

  const confColor = pattern.confidence === 'strong' ? 'var(--accent-green)' : pattern.confidence === 'medium' ? 'var(--accent-yellow)' : 'var(--text-muted)'
  const confLabel = pattern.confidence === 'strong' ? '★ FORT' : pattern.confidence === 'medium' ? '◆ MOYEN' : pattern.confidence === 'weak' ? '◇ FAIBLE' : ''
  const scorePercent = Math.round((pattern.score / pattern.maxScore) * 100)
  const barColor = scorePercent >= 60 ? 'var(--accent-green)' : scorePercent >= 40 ? 'var(--accent-yellow)' : 'var(--text-muted)'

  return (
    <div style={{ ...S.card, border: `1px solid ${pattern.signal !== 'none' ? cfg.border : 'var(--bg-border)'}` }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={S.label}>⚡ Signal Panel</span>
        {confLabel && <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, color: confColor, background: `${confColor}18`, border: `1px solid ${confColor}30`, borderRadius: 4, padding: '2px 8px' }}>{confLabel}</span>}
      </div>

      {/* Setup name */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>Setup détecté</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{STATE_LABELS[pattern.marketState]}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{pattern.description}</div>
      </div>

      {/* Signal badge */}
      <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: '12px 16px' }} className={pattern.signal !== 'none' ? 'signal-active' : ''}>
        <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>Signal</div>
        <div style={{ fontSize: 28, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.15em', color: cfg.color, marginTop: 4 }}>{cfg.label}</div>
      </div>

      {/* Score bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontFamily: 'monospace', marginBottom: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>Score de validation</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{pattern.score}/{pattern.maxScore}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${scorePercent}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Entry / SL / TP */}
      {pattern.signal !== 'none' && pattern.entryPrice && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            { label: 'Entrée', value: pattern.entryPrice, color: 'var(--accent-blue)' },
            { label: 'Stop Loss', value: pattern.stopLoss, color: 'var(--accent-red)' },
            { label: 'Take Profit', value: pattern.takeProfit, color: 'var(--accent-green)' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{item.label}</div>
              <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: item.color, marginTop: 3 }}>
                ${item.value?.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
