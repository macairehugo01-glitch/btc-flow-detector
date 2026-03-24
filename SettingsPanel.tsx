'use client'
import { useEffect, useRef } from 'react'
import { useMarketStore } from './useMarketStore'
import { createChart, ColorType, LineStyle, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'

export function OIChart() {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const line = useRef<ISeriesApi<'Line'> | null>(null)
  const hist = useRef<ISeriesApi<'Histogram'> | null>(null)
  const { oi } = useMarketStore()

  useEffect(() => {
    if (!ref.current) return
    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8892a4', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
      grid: { vertLines: { color: '#1e2130', style: LineStyle.Dotted }, horzLines: { color: '#1e2130', style: LineStyle.Dotted } },
      rightPriceScale: { borderColor: '#1e2130' },
      timeScale: { borderColor: '#1e2130', timeVisible: true },
    })
    line.current = c.addLineSeries({ color: '#4dabf7', lineWidth: 2, title: 'OI', priceLineVisible: false })
    hist.current = c.addHistogramSeries({ priceScaleId: 'delta', lastValueVisible: false, priceLineVisible: false })
    c.priceScale('delta').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false })
    chart.current = c
    const obs = new ResizeObserver(() => { if (ref.current) c.applyOptions({ width: ref.current.clientWidth }) })
    obs.observe(ref.current)
    return () => { obs.disconnect(); c.remove() }
  }, [])

  useEffect(() => {
    if (!line.current || !hist.current || !oi.length) return
    line.current.setData(oi.map(s => ({ time: s.time as Time, value: s.openInterest })))
    hist.current.setData(oi.map((s, i) => {
      const change = i > 0 ? s.openInterest - oi[i-1].openInterest : 0
      return { time: s.time as Time, value: change, color: change >= 0 ? 'rgba(0,212,168,0.5)' : 'rgba(255,71,87,0.5)' }
    }))
  }, [oi])

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bg-border)' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Open Interest</span>
      </div>
      <div ref={ref} style={{ width: '100%', height: 160 }} />
    </div>
  )
}
