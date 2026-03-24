type CvdBar = {
  time: string | number
  cvd: number
  delta: number
}

type OIBar = {
  time: string | number
  openInterest: number
}

type MarketStore = {
  cvd: CvdBar[]
  oi: OIBar[]
  setupHistory: any[]
}

export function useMarketStore(): MarketStore {
  return {
    cvd: [],
    oi: [],
    setupHistory: [],
  }
}
