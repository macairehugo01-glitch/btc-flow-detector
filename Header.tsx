'use client'
import { useEffect, useRef } from 'react'
import { useMarketStore } from '@/store/useMarketStore'
import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'

export function CVDChart() {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const line = useRef<ISeriesApi<'Line'> | null>(null)
  const hist = useRef<ISeriesApi<'Histogram'> | null>(null)
  const { cvd } = useMarketStore()

  useEffect(() => {
    if (!ref.current) return
    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8892a4', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
      grid: { vertLines: { color: '#1e2130', style: LineStyle.Dotted }, horzLines: { color: '#1e2130', style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: '#1e2130' },
      timeScale: { borderColor: '#1e2130', timeVisible: true },
    })
    line.current = c.addLineSeries({ color: '#ffd43b', lineWidth: 2, title: 'CVD', priceLineVisible: false })
    hist.current = c.addHistogramSeries({ priceScaleId: 'delta', lastValueVisible: false, priceLineVisible: false })
    c.priceScale('delta').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, borderVisible: false })
    chart.current = c
    const obs = new ResizeObserver(() => { if (ref.current) c.applyOptions({ width: ref.current.clientWidth }) })
    obs.observe(ref.current)
    return () => { obs.disconnect(); c.remove() }
  }, [])

  useEffect(() => {
    if (!line.current || !hist.current || !cvd.length) return
    line.current.setData(cvd.map(b => ({ time: b.time as Time, value: b.cvd })))
    hist.current.setData(cvd.map(b => ({ time: b.time as Time, value: b.delta, color: b.delta >= 0 ? 'rgba(0,212,168,0.6)' : 'rgba(255,71,87,0.6)' })))
  }, [cvd])

  const latest = cvd.at(-1)
  const prev = cvd.at(-2)
  const trend = latest && prev ? (latest.cvd > prev.cvd ? '▲' : '▼') : '—'
  const trendColor = latest && prev ? (latest.cvd > prev.cvd ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)'

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--bg-border)' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>CVD — Cumulative Volume Delta</span>
        {latest && <span style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700, color: trendColor }}>{trend} {latest.cvd.toFixed(1)}</span>}
      </div>
      <div ref={ref} style={{ width: '100%', height: 160 }} />
    </div>
  )
}
