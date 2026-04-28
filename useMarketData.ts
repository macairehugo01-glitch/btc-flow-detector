'use client'

import { create } from 'zustand'

export type Timeframe = '1m' | '5m' | '15m' | '1h'

export type KlineBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type VWAPBar = {
  time: number
  vwap: number
}

export type CVDBar = {
  time: number
  delta: number
  cvd: number
}

export type OIBar = {
  time: number
  openInterest: number
}

export type StoredSetup = {
  id: string
  timestamp: number
  closedAt?: number

  session: 'Asia' | 'London' | 'New York'
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
  hourBucket: string

  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number

  signalType:
    | 'continuation_long'
    | 'continuation_short'
    | 'breakout'
    | 'bullish_retest'
    | 'bearish_retest'
    | 'majority_trap_long'
    | 'majority_trap_short'
    | 'bullish_reset'
    | 'bearish_reset'
    | 'neutral'

  marketRegime: 'trend' | 'range' | 'breakout' | 'reversal'
  vwapSide: 'above' | 'below'
  vwapDistancePct: number
  volatilityBucket: 'low' | 'medium' | 'high'

  entryPrice: number
  stopLoss: number
  takeProfit: number
  rr: number
  riskPercent: number

  status: 'open' | 'win' | 'loss'
  exitPrice?: number
  rMultiple?: number
  drawdownR?: number
  durationMinutes?: number

  referenceBarKey: string
}

export type SetupStats = {
  total: number
  wins: number
  losses: number
  open: number
  winrate: number
}

export type SessionStats = {
  session: 'Asia' | 'London' | 'New York'
  total: number
  wins: number
  losses: number
  open: number
  winrate: number
}

export type Thresholds = {
  mode: 'aggressive' | 'strict'
}

export type TradeSignal = {
  action: 'BUY' | 'SELL' | 'STABLE'
  confidence: number
  signalType:
    | 'continuation_long'
    | 'continuation_short'
    | 'breakout'
    | 'bullish_retest'
    | 'bearish_retest'
    | 'majority_trap_long'
    | 'majority_trap_short'
    | 'bullish_reset'
    | 'bearish_reset'
    | 'neutral'
  marketRegime: 'trend' | 'range' | 'breakout' | 'reversal'
  volatilityBucket: 'low' | 'medium' | 'high'
  reasons: string[]
  vwap: number
  sweepAge?: number
  metrics: {
    priceVsVwapPct: number
    cvdDelta: number
    oiDeltaPct: number
    fundingRate: number
    oiChangeAbs: number
    distanceFromVwapPct: number
  }
}

type MarketDataPayload = {
  klines?: KlineBar[]
  vwap?: VWAPBar[]
  cvd?: CVDBar[]
  oi?: OIBar[]
  setupHistory?: StoredSetup[]
  setupStats?: SetupStats
  sessionStats?: SessionStats[]
  ticker?: { price: number; change24h: number; volume24h: number } | null
  funding?: { rate: number; nextFundingTime: number } | null
  signal?: TradeSignal | null
  lastUpdate?: number | null
}

type MarketStore = {
  klines: KlineBar[]
  vwap: VWAPBar[]
  cvd: CVDBar[]
  oi: OIBar[]
  setupHistory: StoredSetup[]
  setupStats: SetupStats
  sessionStats: SessionStats[]

  ticker: { price: number; change24h: number; volume24h: number } | null
  funding: { rate: number; nextFundingTime: number } | null
  signal: TradeSignal | null
  lastUpdate: number | null

  timeframe: Timeframe
  isConnected: boolean
  isLoading: boolean
  error: string | null

  thresholds: Thresholds

  setTimeframe: (tf: Timeframe) => void
  setThresholds: (t: Partial<Thresholds>) => void
  setMarketData: (data: MarketDataPayload) => void
  setError: (error: string | null) => void
  setLoading: (value: boolean) => void
  setConnected: (value: boolean) => void
}

export const useMarketStore = create<MarketStore>((set) => ({
  klines: [],
  vwap: [],
  cvd: [],
  oi: [],
  setupHistory: [],
  setupStats: {
    total: 0,
    wins: 0,
    losses: 0,
    open: 0,
    winrate: 0,
  },
  sessionStats: [],

  ticker: null,
  funding: null,
  signal: null,
  lastUpdate: null,

  timeframe: '5m',
  isConnected: false,
  isLoading: true,
  error: null,

  thresholds: {
    mode: 'aggressive',
  },

  setTimeframe: (timeframe) => set({ timeframe }),
  setThresholds: (t) =>
    set((state) => ({
      thresholds: {
        ...state.thresholds,
        ...t,
      },
    })),
  setMarketData: (data) =>
    set((state) => ({
      ...state,
      ...data,
      // Garder les anciennes valeurs si les nouvelles sont null
      // évite les crashes entre deux fetches du setInterval
      ticker: data.ticker ?? state.ticker,
      signal: data.signal ?? state.signal,
      funding: data.funding ?? state.funding,
    })),
  setError: (error) => set({ error }),
  setLoading: (isLoading) => set({ isLoading }),
  setConnected: (isConnected) => set({ isConnected }),
}))
