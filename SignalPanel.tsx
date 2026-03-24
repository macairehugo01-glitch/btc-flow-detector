'use client'
import { useEffect, useRef, useCallback } from 'react'
import { useMarketStore } from '@/store/useMarketStore'
import { createChart, ColorType, CrosshairMode, LineStyle, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'

export function PriceChart() {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const vwapLine = useRef<ISeriesApi<'Line'> | null>(null)
  const { klines, vwap } = useMarketStore()

  useEffect(() => {
    if (!ref.current) return
    const c = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#8892a4', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: '#1e2130', style: LineStyle.Dotted }, horzLines: { color: '#1e2130', style: LineStyle.Dotted } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4a5568', labelBackgroundColor: '#13151c' }, horzLine: { color: '#4a5568', labelBackgroundColor: '#13151c' } },
      rightPriceScale: { borderColor: '#1e2130' },
      timeScale: { borderColor: '#1e2130', timeVisible: true },
    })
    candles.current = c.addCandlestickSeries({ upColor: '#00d4a8', downColor: '#ff4757', borderUpColor: '#00d4a8', borderDownColor: '#ff4757', wickUpColor: '#00d4a8', wickDownColor: '#ff4757' })
    vwapLine.current = c.addLineSeries({ color: '#ffd43b', lineWidth: 2, lineStyle: LineStyle.Dashed, title: 'VWAP', priceLineVisible: false })
    chart.current = c
    const obs = new ResizeObserver(() => { if (ref.current) c.applyOptions({ width: ref.current.clientWidth }) })
    obs.observe(ref.current)
    return () => { obs.disconnect(); c.remove() }
  }, [])

  useEffect(() => {
    if (!candles.current || !vwapLine.current) return
    if (klines.length) candles.current.setData(klines.map(k => ({ time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close })))
    if (vwap.length) vwapLine.current.setData(vwap.map(v => ({ time: v.time as Time, value: v.vwap })))
  }, [klines, vwap])

  const fit = useCallback(() => chart.current?.timeScale().fitContent(), [])

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--bg-border)' }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>BTCUSDT Perpetual</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--accent-yellow)' }}>— VWAP</span>
          <button onClick={fit} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', background: 'var(--bg-border)', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>Fit</button>
        </div>
      </div>
      <div ref={ref} style={{ width: '100%', height: 320 }} />
    </div>
  )
}
