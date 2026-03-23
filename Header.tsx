/**
 * hooks/useMarketData.ts
 * Polls the market API and keeps the store updated
 */

'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useMarketStore } from '@/store/useMarketStore'
import type { Timeframe } from '@/types'

const REFRESH_INTERVAL_MS = 10_000  // 10 seconds

export function useMarketData() {
  const {
    timeframe,
    thresholds,
    setMarketData,
    setSetupHistory,
    setError,
    setConnected,
  } = useMarketStore()

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    // Cancel previous request if still pending
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const params = new URLSearchParams({
        timeframe,
        mode: thresholds.mode,
      })

      const [marketRes, setupsRes] = await Promise.allSettled([
        fetch(`/api/market?${params}`, {
          signal: abortRef.current.signal,
          cache: 'no-store',
        }),
        fetch('/api/setups', {
          signal: abortRef.current.signal,
          cache: 'no-store',
        }),
      ])

      if (marketRes.status === 'fulfilled' && marketRes.value.ok) {
        const data = await marketRes.value.json()
        setMarketData({
          klines: data.klines ?? [],
          vwap: data.vwap ?? [],
          cvd: data.cvd ?? [],
          oi: data.oi ?? [],
          pattern: data.pattern ?? null,
          ticker: data.ticker ?? null,
          funding: data.funding ?? null,
          lastUpdate: data.lastUpdate ?? Date.now(),
          isLoading: false,
          error: null,
        })
        setConnected(true)
        setError(null)
      }

      if (setupsRes.status === 'fulfilled' && setupsRes.value.ok) {
        const data = await setupsRes.value.json()
        setSetupHistory(data.setups ?? [])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return

      console.error('Fetch error:', err)
      setConnected(false)
      setError('Connexion Binance perdue — nouvelle tentative...')
    }
  }, [timeframe, thresholds.mode, setMarketData, setSetupHistory, setError, setConnected])

  useEffect(() => {
    // Initial fetch immediately
    setMarketData({ isLoading: true })
    fetchData()

    // Set up interval
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      abortRef.current?.abort()
    }
  }, [fetchData, setMarketData])

  // Expose manual refresh
  return { refresh: fetchData }
}
