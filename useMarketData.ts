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
      setError(null)
      const res = await fetch(`/api/cvd?timeframe=${encodeURIComponent(timeframe)}`, {
        method: 'GET',
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch market data')
      }
      // setMarketData AVANT setLoading(false) pour que isReady
      // ne devienne true qu'une fois les données réellement présentes
      setMarketData({
        klines: data.klines ?? [],
        vwap: data.vwap ?? [],
        cvd: data.cvd ?? [],
        oi: data.oi ?? [],
        ticker: data.ticker ?? null,
        funding: data.funding ?? null,
        signal: data.signal ?? null,
        setupHistory: data.setupHistory ?? [],
        setupStats: data.setupStats ?? {
          total: 0,
          wins: 0,
          losses: 0,
          open: 0,
          winrate: 0,
        },
        sessionStats: data.sessionStats ?? [],
        lastUpdate: data.lastUpdate ?? Date.now(),
      })
      setConnected(true)
      setLoading(false) // ← après setMarketData, pas dans finally
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown data loading error'
      setError(message)
      setConnected(false)
      setLoading(false) // ← aussi en cas d'erreur pour débloquer l'UI
    }
  }, [timeframe, setConnected, setError, setLoading, setMarketData])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  return { refresh }
}
