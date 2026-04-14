'use client'

import { useEffect, useState } from 'react'

type MacroSeriesPoint = {
  label: string
  value: number | null
  previous: number | null
  change: number | null
  unit: string
  bias: 'bullish' | 'bearish' | 'neutral'
  interpretation: string
}

type MacroContextResponse = {
  dxy: MacroSeriesPoint | null
  vix: MacroSeriesPoint | null
  us10y: MacroSeriesPoint | null
  macroScore: number
  macroBias: 'RISK-ON' | 'RISK-OFF' | 'NEUTRAL'
  lastUpdate: number
}

export function useMacroContext() {
  const [data, setData] = useState<MacroContextResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const res = await fetch('/api/macro-context', { cache: 'no-store' })
        const payload = await res.json()

        if (!res.ok) {
          throw new Error(payload?.error || 'Failed to load macro context')
        }

        if (!cancelled) {
          setData(payload)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown macro error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    const timer = setInterval(load, 60000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return { data, loading, error }
}
