'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Kline, DeltaBar, OISnapshot, VWAPPoint, PatternResult, StoredSetup, Timeframe, ThresholdConfig } from '@/types'
import { DEFAULT_THRESHOLDS } from '@/types'

interface Store {
  klines: Kline[]
  vwap: VWAPPoint[]
  cvd: DeltaBar[]
  oi: OISnapshot[]
  pattern: PatternResult | null
  ticker: { price: number; change24h: number; volume24h: number } | null
  funding: { rate: number; nextFundingTime: number } | null
  lastUpdate: number | null
  timeframe: Timeframe
  isLoading: boolean
  error: string | null
  isConnected: boolean
  setupHistory: StoredSetup[]
  thresholds: ThresholdConfig
  setTimeframe: (tf: Timeframe) => void
  setMarketData: (data: Partial<Store>) => void
  setSetupHistory: (s: StoredSetup[]) => void
  setThresholds: (t: Partial<ThresholdConfig>) => void
  setError: (e: string | null) => void
  setConnected: (v: boolean) => void
}

export const useMarketStore = create<Store>()(
  persist(
    (set) => ({
      klines: [], vwap: [], cvd: [], oi: [], pattern: null,
      ticker: null, funding: null, lastUpdate: null,
      timeframe: '5m', isLoading: false, error: null, isConnected: false,
      setupHistory: [], thresholds: DEFAULT_THRESHOLDS,
      setTimeframe: (tf) => set({ timeframe: tf }),
      setMarketData: (data) => set(s => ({ ...s, ...data })),
      setSetupHistory: (setupHistory) => set({ setupHistory }),
      setThresholds: (t) => set(s => ({ thresholds: { ...s.thresholds, ...t } })),
      setError: (error) => set({ error }),
      setConnected: (isConnected) => set({ isConnected }),
    }),
    { name: 'btc-flow-prefs', partialize: s => ({ timeframe: s.timeframe, thresholds: s.thresholds }) }
  )
)
