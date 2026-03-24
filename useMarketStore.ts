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

type MarketStore = {
  cvd: CvdBar[]
  oi: OIBar[]
  klines: KlineBar[]
  vwap: VWAPBar[]
  setupHistory: StoredSetup[]
  error: string | null
  isLoading: boolean
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
  }
}
