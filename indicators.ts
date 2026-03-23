'use client'

import { useMarketStore } from '@/store/useMarketStore'
import { Clock, TrendingUp, TrendingDown } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { StoredSetup } from '@/types'

const STATE_SHORT: Record<string, string> = {
  majority_trap_short: 'Trap Short',
  bullish_reset_long:  'Reset Long',
  continuation_long:   'Continuation',
  neutral:             'Neutre',
}

export function SetupHistory() {
  const { setupHistory } = useMarketStore()

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clock size={14} style={{ color: 'var(--accent-purple)' }} />
        <span className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Historique des Setups
        </span>
        <span className="ml-auto text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
          {setupHistory.length}
        </span>
      </div>

      {setupHistory.length === 0 ? (
        <div className="text-center py-6">
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Aucun setup enregistré encore
          </div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Les signaux actifs seront stockés ici
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
                {['Heure', 'Setup', 'Signal', 'Score', 'Entrée', 'SL', 'TP'].map(h => (
                  <th
                    key={h}
                    className="pb-2 text-left pr-3 font-medium"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {setupHistory.map((setup) => (
                <SetupRow key={setup.id} setup={setup} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SetupRow({ setup }: { setup: StoredSetup }) {
  const isLong = setup.signal === 'long'
  const signalColor = isLong ? 'var(--accent-green)' : 'var(--accent-red)'
  const time = format(new Date(setup.timestamp * 1000), 'HH:mm:ss', { locale: fr })

  return (
    <tr
      className="border-b transition-colors hover:bg-[var(--bg-hover)]"
      style={{ borderColor: 'var(--bg-border)' }}
    >
      <td className="py-2 pr-3" style={{ color: 'var(--text-muted)' }}>
        {time}
      </td>
      <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>
        {STATE_SHORT[setup.marketState] ?? setup.marketState}
      </td>
      <td className="py-2 pr-3">
        <span
          className="flex items-center gap-1 font-bold"
          style={{ color: signalColor }}
        >
          {isLong ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {setup.signal.toUpperCase()}
        </span>
      </td>
      <td className="py-2 pr-3">
        <ScoreBadge score={setup.score} />
      </td>
      <td className="py-2 pr-3" style={{ color: 'var(--accent-blue)' }}>
        ${setup.entryPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </td>
      <td className="py-2 pr-3" style={{ color: 'var(--accent-red)' }}>
        ${setup.stopLoss.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </td>
      <td className="py-2" style={{ color: 'var(--accent-green)' }}>
        ${setup.takeProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}
      </td>
    </tr>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 6 ? 'var(--accent-green)' : score >= 4 ? 'var(--accent-yellow)' : 'var(--text-muted)'
  return (
    <span className="font-bold" style={{ color }}>
      {score}
    </span>
  )
}
