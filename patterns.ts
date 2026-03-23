'use client'

import { useMarketStore } from '@/store/useMarketStore'
import { CheckCircle, XCircle, List } from 'lucide-react'
import type { MarketConditions } from '@/types'

const CONDITION_LABELS: Record<keyof MarketConditions, { label: string; desc: string; group: string }> = {
  vwapBias:               { label: 'VWAP Bias Haussier',     desc: 'Prix au-dessus de la VWAP',            group: 'VWAP' },
  oiBuildUp:              { label: 'OI Build-Up',            desc: 'Open Interest en hausse significative', group: 'OI' },
  oiUnwind:               { label: 'OI Unwind',              desc: 'Open Interest en baisse',               group: 'OI' },
  oiStabilizing:          { label: 'OI Stabilisation',       desc: 'OI se stabilise après un mouvement',   group: 'OI' },
  cvdUp:                  { label: 'CVD Haussier',           desc: 'Delta cumulatif positif',               group: 'CVD' },
  cvdDown:                { label: 'CVD Baissier',           desc: 'Delta cumulatif négatif',               group: 'CVD' },
  cvdFlipBullish:         { label: 'CVD Flip Haussier',      desc: 'CVD retourné de bas vers haut',         group: 'CVD' },
  cvdFlipBearish:         { label: 'CVD Flip Baissier',      desc: 'CVD retourné de haut vers bas',         group: 'CVD' },
  impulseUp:              { label: 'Impulsion Haussière',    desc: 'Mouvement brusque récent à la hausse',  group: 'Prix' },
  impulseDown:            { label: 'Impulsion Baissière',    desc: 'Mouvement brusque récent à la baisse',  group: 'Prix' },
  consolidationBelowVWAP: { label: 'Consolidation < VWAP',  desc: 'Range serré sous la VWAP',              group: 'Prix' },
  consolidationAboveVWAP: { label: 'Consolidation > VWAP',  desc: 'Range serré au-dessus VWAP',            group: 'Prix' },
}

const GROUP_COLORS: Record<string, string> = {
  VWAP: 'var(--accent-purple)',
  OI:   'var(--accent-blue)',
  CVD:  'var(--accent-yellow)',
  Prix: 'var(--accent-green)',
}

export function ConditionsChecklist() {
  const { pattern } = useMarketStore()
  const conditions = pattern?.conditions

  // Group conditions
  const groups = ['VWAP', 'OI', 'CVD', 'Prix']
  const grouped = groups.map(group => ({
    group,
    color: GROUP_COLORS[group],
    items: (Object.entries(CONDITION_LABELS) as [keyof MarketConditions, typeof CONDITION_LABELS[keyof MarketConditions]][])
      .filter(([, v]) => v.group === group),
  }))

  const trueCount = conditions
    ? Object.values(conditions).filter(Boolean).length
    : 0
  const totalCount = Object.keys(CONDITION_LABELS).length

  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <List size={14} style={{ color: 'var(--accent-blue)' }} />
          <span className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Conditions
          </span>
        </div>
        <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: 'var(--bg-border)', color: 'var(--text-secondary)' }}>
          {trueCount}/{totalCount} actives
        </span>
      </div>

      {/* Groups */}
      <div className="flex flex-col gap-4">
        {grouped.map(({ group, color, items }) => (
          <div key={group}>
            <div
              className="text-xs font-mono font-semibold mb-2 flex items-center gap-1.5"
              style={{ color }}
            >
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
              {group}
            </div>
            <div className="flex flex-col gap-1.5">
              {items.map(([key, meta]) => {
                const isActive = conditions?.[key] ?? false
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg px-3 py-2 transition-all"
                    style={{
                      background: isActive ? `${color}10` : 'var(--bg-secondary)',
                      border: `1px solid ${isActive ? `${color}25` : 'transparent'}`,
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive
                        ? <CheckCircle size={13} style={{ color, flexShrink: 0 }} />
                        : <XCircle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      }
                      <div className="min-w-0">
                        <div
                          className="text-xs font-medium truncate"
                          style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
                        >
                          {meta.label}
                        </div>
                      </div>
                    </div>
                    <span
                      className="text-xs font-mono ml-2 shrink-0 font-bold"
                      style={{ color: isActive ? color : 'var(--text-muted)' }}
                    >
                      {isActive ? 'OK' : 'NO'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
