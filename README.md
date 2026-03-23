'use client'

import { useMarketStore } from '@/store/useMarketStore'
import { TrendingUp, TrendingDown, Minus, Zap } from 'lucide-react'
import type { PatternResult } from '@/types'

const STATE_LABELS: Record<string, string> = {
  majority_trap_short: 'Majority Trap Short',
  bullish_reset_long: 'Bullish Reset Long',
  continuation_long: 'Continuation Long',
  neutral: 'Neutre',
}

const STATE_DESC: Record<string, string> = {
  majority_trap_short: 'Distribution sous VWAP — piège haussier actif',
  bullish_reset_long: 'Reset après liquidation — reprise en cours',
  continuation_long: 'Momentum haussier propre — continuation probable',
  neutral: 'Pas de setup clair détecté',
}

export function SignalPanel() {
  const { pattern, isLoading } = useMarketStore()

  if (isLoading && !pattern) {
    return <SignalPanelSkeleton />
  }

  if (!pattern) return <SignalPanelEmpty />

  return <SignalPanelContent pattern={pattern} />
}

function SignalPanelContent({ pattern }: { pattern: PatternResult }) {
  const signalConfig = {
    long: {
      icon: <TrendingUp size={28} />,
      label: 'LONG',
      color: 'var(--accent-green)',
      bg: 'rgba(0, 212, 168, 0.08)',
      border: 'rgba(0, 212, 168, 0.3)',
    },
    short: {
      icon: <TrendingDown size={28} />,
      label: 'SHORT',
      color: 'var(--accent-red)',
      bg: 'rgba(255, 71, 87, 0.08)',
      border: 'rgba(255, 71, 87, 0.3)',
    },
    none: {
      icon: <Minus size={28} />,
      label: 'NEUTRE',
      color: 'var(--text-muted)',
      bg: 'rgba(74, 85, 104, 0.08)',
      border: 'rgba(74, 85, 104, 0.2)',
    },
  }

  const cfg = signalConfig[pattern.signal]
  const scorePercent = Math.round((pattern.score / pattern.maxScore) * 100)

  const confidenceColor =
    pattern.confidence === 'strong' ? 'var(--accent-green)' :
    pattern.confidence === 'medium' ? 'var(--accent-yellow)' :
    'var(--text-muted)'

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${pattern.signal !== 'none' ? cfg.border : 'var(--bg-border)'}`,
        boxShadow: pattern.signal !== 'none' ? `0 0 20px ${cfg.bg}` : 'none',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} style={{ color: 'var(--accent-yellow)' }} />
          <span className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Signal Panel
          </span>
        </div>
        {pattern.confidence !== 'none' && (
          <span
            className="text-xs px-2 py-0.5 rounded font-mono font-medium"
            style={{ color: confidenceColor, background: `${confidenceColor}15`, border: `1px solid ${confidenceColor}30` }}
          >
            {pattern.confidence === 'strong' ? '★ FORT' :
             pattern.confidence === 'medium' ? '◆ MOYEN' : '◇ FAIBLE'}
          </span>
        )}
      </div>

      {/* Setup name */}
      <div>
        <div className="text-xs font-mono uppercase" style={{ color: 'var(--text-muted)' }}>
          Setup détecté
        </div>
        <div className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
          {STATE_LABELS[pattern.marketState]}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          {STATE_DESC[pattern.marketState]}
        </div>
      </div>

      {/* Signal */}
      <div
        className="flex items-center gap-3 rounded-lg px-4 py-3"
        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
      >
        <span style={{ color: cfg.color }} className={pattern.signal !== 'none' ? 'signal-active' : ''}>
          {cfg.icon}
        </span>
        <div>
          <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            Signal
          </div>
          <div className="text-2xl font-mono font-bold tracking-widest" style={{ color: cfg.color }}>
            {cfg.label}
          </div>
        </div>
      </div>

      {/* Score bar */}
      <div>
        <div className="flex justify-between text-xs font-mono mb-2">
          <span style={{ color: 'var(--text-muted)' }}>Score de validation</span>
          <span style={{ color: 'var(--text-primary)' }}>
            {pattern.score}/{pattern.maxScore}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-border)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${scorePercent}%`,
              background: scorePercent >= 60
                ? 'var(--accent-green)'
                : scorePercent >= 40
                ? 'var(--accent-yellow)'
                : 'var(--text-muted)',
            }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1.5 font-mono">
          <span style={{ color: 'var(--text-muted)' }}>Faible</span>
          <span style={{ color: 'var(--text-muted)' }}>Moyen</span>
          <span style={{ color: 'var(--text-muted)' }}>Fort</span>
        </div>
      </div>

      {/* Entry / SL / TP */}
      {pattern.signal !== 'none' && pattern.entryPrice && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Entrée', value: pattern.entryPrice, color: 'var(--accent-blue)' },
            { label: 'Stop Loss', value: pattern.stopLoss, color: 'var(--accent-red)' },
            { label: 'Take Profit', value: pattern.takeProfit, color: 'var(--accent-green)' },
          ].map(item => (
            <div
              key={item.label}
              className="rounded-lg px-2 py-2 text-center"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)' }}
            >
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}</div>
              <div className="font-mono text-sm font-medium mt-0.5" style={{ color: item.color }}>
                ${item.value?.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SignalPanelSkeleton() {
  return (
    <div className="rounded-xl p-5 flex flex-col gap-4 animate-pulse" style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}>
      <div className="h-4 w-24 rounded" style={{ background: 'var(--bg-border)' }} />
      <div className="h-8 w-40 rounded" style={{ background: 'var(--bg-border)' }} />
      <div className="h-16 rounded-lg" style={{ background: 'var(--bg-border)' }} />
      <div className="h-8 rounded" style={{ background: 'var(--bg-border)' }} />
    </div>
  )
}

function SignalPanelEmpty() {
  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}>
      <div className="text-center py-8">
        <Minus size={32} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>En attente de données...</div>
      </div>
    </div>
  )
}
