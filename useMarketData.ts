'use client'

import { useCallback, useEffect } from 'react'
import { useMarketStore } from './useMarketStore'

export function useMarketData() {
  const timeframe = useMarketStore((s) => s.timeframe)
  const setMarketData = useMarketStore((s) => s.setMarketData)
  const setError = useMarketStore((s) => s.setError)
  const setLoading = useMarketStore((s) => s.setLoading)
  const setConnected = useMarketStore((s) => s.setConnected)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const res = await fetch(`/api/cvd?timeframe=${encodeURIComponent(timeframe)}`, {
        method: 'GET',
        cache: 'no-store',
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to fetch market data')
      }

      const data = await res.json()

      setMarketData({
        klines: data.klines ?? [],
        vwap: data.vwap ?? [],
        cvd: data.cvd ?? [],
        oi: data.oi ?? [],
        ticker: data.ticker ?? null,
        funding: data.funding ?? null,
        lastUpdate: data.lastUpdate ?? Date.now(),
        setupHistory: data.setupHistory ?? [],
      })

      setConnected(true)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown data loading error'
      setError(message)
      setConnected(false)
    } finally {
      setLoading(false)
    }
  }, [timeframe, setConnected, setError, setLoading, setMarketData])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  return { refresh }
}
