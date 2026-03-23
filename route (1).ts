/**
 * store/useMarketStore.ts
 * Global state management with Zustand
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Kline,
  DeltaBar,
  OISnapshot,
  VWAPPoint,
  PatternResult,
  StoredSetup,
  Timeframe,
  ThresholdConfig,
} from '@/types'
import { DEFAULT_THRESHOLDS } from '@/types'

interface TickerData {
  price: number
  change24h: number
  volume24h: number
}

interface FundingData {
  rate: number
  nextFundingTime: number
}

interface MarketStore {
  // Market data
  klines: Kline[]
  vwap: VWAPPoint[]
  cvd: DeltaBar[]
  oi: OISnapshot[]
  pattern: PatternResult | null
  ticker: TickerData | null
  funding: FundingData | null
  lastUpdate: number | null

  // UI state
  timeframe: Timeframe
  isLoading: boolean
  error: string | null
  isConnected: boolean

  // History
  setupHistory: StoredSetup[]

  // Settings (persisted)
  thresholds: ThresholdConfig
  activeConditionFilters: Partial<Record<string, boolean>>

  // Actions
  setTimeframe: (tf: Timeframe) => void
  setMarketData: (data: Partial<MarketStore>) => void
  setSetupHistory: (setups: StoredSetup[]) => void
  setThresholds: (t: Partial<ThresholdConfig>) => void
  toggleConditionFilter: (key: string) => void
  setError: (err: string | null) => void
  setConnected: (v: boolean) => void
}

export const useMarketStore = create<MarketStore>()(
  persist(
    (set) => ({
      // Initial state
      klines: [],
      vwap: [],
      cvd: [],
      oi: [],
      pattern: null,
      ticker: null,
      funding: null,
      lastUpdate: null,

      timeframe: '5m',
      isLoading: false,
      error: null,
      isConnected: false,

      setupHistory: [],

      thresholds: DEFAULT_THRESHOLDS,
      activeConditionFilters: {},

      // Actions
      setTimeframe: (tf) => set({ timeframe: tf }),

      setMarketData: (data) => set(state => ({ ...state, ...data })),

      setSetupHistory: (setups) => set({ setupHistory: setups }),

      setThresholds: (t) => set(state => ({
        thresholds: { ...state.thresholds, ...t }
      })),

      toggleConditionFilter: (key) => set(state => ({
        activeConditionFilters: {
          ...state.activeConditionFilters,
          [key]: !state.activeConditionFilters[key],
        }
      })),

      setError: (err) => set({ error: err }),
      setConnected: (v) => set({ isConnected: v }),
    }),
    {
      name: 'btc-flow-settings',
      partialize: (state) => ({
        timeframe: state.timeframe,
        thresholds: state.thresholds,
        activeConditionFilters: state.activeConditionFilters,
      }),
    }
  )
)
