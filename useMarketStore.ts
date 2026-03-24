type CvdBar = {
  time: string | number
  cvd: number
  delta: number
}

type MarketStore = {
  cvd: CvdBar[]
}

export function useMarketStore(): MarketStore {
  return {
    cvd: [],
  }
}
