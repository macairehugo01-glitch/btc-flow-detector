type Timeframe = '1m' | '5m' | '15m' | '1h'

type CvdBar = {
  time: string | number
  cvd: number
  delta: number
}

type OIBar = {
  time: string | number
  openInterest: number
}

type KlineBar = {
  time: string | number
  open: number
  high: number
  low: number
  close: number
}

type VWAPBar = {
  time: string | number
  vwap: number
}

type StoredSetup = {
  id: string
  timestamp: number
  marketState: string
  signal: 'long' | 'short'
  score: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
}

type Thresholds = {
  mode?: string
}

type MarketStore = {
  cvd: CvdBar[]
  oi: OIBar[]
  klines: KlineBar[]
  vwap: VWAPBar[]
  setupHistory: StoredSetup[]
  error: string | null
  isLoading: boolean
  ticker: { price: number; change24h: number; volume24h: number } | null
  timeframe: Timeframe
  isConnected: boolean
  thresholds: Thresholds
  setTimeframe: (tf: Timeframe) => void
  setThresholds: (t: Partial<Thresholds>) => void
}

export function useMarketStore(): MarketStore {
  return {
    cvd: [],
    oi: [],
    klines: [],
    vwap: [],
    setupHistory: [],
    error: null,
    isLoading: false,
    ticker: null,
    timeframe: '5m',
    isConnected: false,
    thresholds: {},
    setTimeframe: () => {},
    setThresholds: () => {},
  }
}
