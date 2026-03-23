'use client'

import { useMarketStore } from '@/store/useMarketStore'
import { BarChart2, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { analyzeOI } from '@/lib/indicators'

export function OIStatsPanel() {
  const { oi, ticker } = useMarketStore()

  const analysis = analyzeOI(oi)

  const trendConfig = {
    building: { color: 'var(--accent-green)', icon: <TrendingUp size={14} />, label: 'BUILD-UP' },
    unwinding: { color: 'var(--accent-red)', icon: <TrendingDown size={14} />, label: 'UNWIND' },
    stable: { color: 'var(--text-muted)', icon: <Minus size={14} />, label: 'STABLE' },
  }

  const cfg = trendConfig[analysis.trend]

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={14} style={{ color: 'var(--accent-blue)' }} />
          <span className="text-xs font-mono uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Open Interest
          </span>
        </div>
        <span
          className="text-xs font-mono font-bold px-2 py-0.5 rounded flex items-center gap-1"
          style={{ color: cfg.color, background: `${cfg.color}15` }}
        >
          {cfg.icon}
          {cfg.label}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="OI Actuel"
          value={analysis.current > 0
            ? `${(analysis.current / 1000).toFixed(1)}K BTC`
            : '—'
          }
          color="var(--text-primary)"
        />
        <StatCard
          label="Var. 1h"
          value={analysis.current > 0
            ? `${analysis.change1h >= 0 ? '+' : ''}${analysis.change1h.toFixed(2)}%`
            : '—'
          }
          color={analysis.change1h > 0 ? 'var(--accent-green)' : analysis.change1h < 0 ? 'var(--accent-red)' : 'var(--text-muted)'}
        />
        <StatCard
          label="Var. 4h"
          value={analysis.current > 0
            ? `${analysis.change4h >= 0 ? '+' : ''}${analysis.change4h.toFixed(2)}%`
            : '—'
          }
          color={analysis.change4h > 0 ? 'var(--accent-green)' : analysis.change4h < 0 ? 'var(--accent-red)' : 'var(--text-muted)'}
        />
        <StatCard
          label="Tendance récente"
          value={analysis.recentTrend === 'up' ? '↑ Hausse' : analysis.recentTrend === 'down' ? '↓ Baisse' : '→ Stable'}
          color={analysis.recentTrend === 'up' ? 'var(--accent-green)' : analysis.recentTrend === 'down' ? 'var(--accent-red)' : 'var(--text-muted)'}
        />
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--bg-border)' }}
    >
      <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="font-mono font-bold text-sm" style={{ color }}>{value}</div>
    </div>
  )
}
