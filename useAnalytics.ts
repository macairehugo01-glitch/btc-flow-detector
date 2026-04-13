'use client'

import { useEffect, useState } from 'react'

export type AnalyticsRow = {
  label: string
  trades: number
  wins: number
  losses: number
  open: number
  winrate: number
  rTotal: number
  expectancy: number
  profitFactor: number
  avgDurationMin: number
  avgDrawdownR: number
}

export type AnalyticsSnapshot = {
  overview: AnalyticsRow
  byHour: AnalyticsRow[]
  bySession: AnalyticsRow[]
  byDirection: AnalyticsRow[]
  byTimeframe: AnalyticsRow[]
  byConfidence: AnalyticsRow[]
  byDuration: AnalyticsRow[]
  byVWAPDistance: AnalyticsRow[]
  byRegime: AnalyticsRow[]
  byWeekday: AnalyticsRow[]
  bySignalType: AnalyticsRow[]
  equityCurve: Array<{
    index: number
    cumulativeR: number
    tradeId: string
    timestamp: number
  }>
  drawdown: {
    maxDrawdownR: number
    currentDrawdownR: number
  }
  streaks: {
    maxWinStreak: number
    maxLossStreak: number
    currentWinStreak: number
    currentLossStreak: number
  }
  heatmap: Array<{
    weekday: string
    hourBucket: string
    trades: number
    expectancy: number
    rTotal: number
  }>
}

export function useAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const res = await fetch('/api/analytics', { cache: 'no-store' })
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load analytics')
        }

        if (!cancelled) {
          setAnalytics(data.analytics ?? null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown analytics error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    const timer = setInterval(load, 30000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return { analytics, loading, error }
}
