'use client'

import { useState } from 'react'
import { useMarketStore } from '@/store/useMarketStore'
import { Settings, ChevronDown, ChevronUp } from 'lucide-react'

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const { thresholds, setThresholds } = useMarketStore()

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)' }}
    >
      {/* Toggle header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ color: 'var(--text-secondary)' }}
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Settings size={14} />
          <span className="text-xs font-mono uppercase tracking-widest">Paramètres</span>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div
          className="px-4 pb-4 flex flex-col gap-4 border-t"
          style={{ borderColor: 'var(--bg-border)' }}
        >
          <div className="pt-3 grid grid-cols-1 gap-3">
            <SliderField
              label="OI Build-Up seuil (%)"
              value={thresholds.oiBuildUpThresholdPct}
              min={0.1} max={2} step={0.1}
              onChange={v => setThresholds({ oiBuildUpThresholdPct: v })}
            />
            <SliderField
              label="Impulsion min (%)"
              value={thresholds.impulseMinPct}
              min={0.1} max={2} step={0.1}
              onChange={v => setThresholds({ impulseMinPct: v })}
            />
            <SliderField
              label="Consolidation max range (%)"
              value={thresholds.consolidationMaxPct}
              min={0.05} max={0.5} step={0.05}
              onChange={v => setThresholds({ consolidationMaxPct: v })}
            />
            <SliderField
              label="Score minimum signal fort"
              value={thresholds.minScoreStrong}
              min={3} max={10} step={1}
              onChange={v => setThresholds({ minScoreStrong: v })}
            />
            <SliderField
              label="Score minimum signal moyen"
              value={thresholds.minScoreMedium}
              min={2} max={8} step={1}
              onChange={v => setThresholds({ minScoreMedium: v })}
            />
          </div>

          <button
            className="text-xs font-mono px-3 py-1.5 rounded border transition-colors text-left"
            style={{
              borderColor: 'var(--bg-border)',
              color: 'var(--text-muted)',
            }}
            onClick={() => setThresholds({
              oiBuildUpThresholdPct: 0.5,
              impulseMinPct: 0.3,
              consolidationMaxPct: 0.15,
              minScoreStrong: 6,
              minScoreMedium: 4,
            })}
          >
            ↺ Reset par défaut
          </button>
        </div>
      )}
    </div>
  )
}

function SliderField({
  label, value, min, max, step, onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent-yellow)' }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--accent-green) 0%, var(--accent-green) ${((value - min) / (max - min)) * 100}%, var(--bg-border) ${((value - min) / (max - min)) * 100}%, var(--bg-border) 100%)`,
          accentColor: 'var(--accent-green)',
        }}
      />
    </div>
  )
}
