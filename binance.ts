const BYBIT_BASE = 'https://api.bybit.com'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

type BybitKlineRow = [string, string, string, string, string, string, string]
type BybitApiResponse<T> = {
  retCode: number
  retMsg: string
  result: T
}

type BybitKlineResult = {
  category: string
  symbol: string
  list: BybitKlineRow[]
}

type BybitTrade = {
  T: number
  p: string
  v: string
  S: 'Buy' | 'Sell'
}

type BybitTradeResult = {
  category: string
  list: BybitTrade[]
}

type BybitOIItem = {
  openInterest: string
  timestamp: string
}

type BybitOIResult = {
  category: string
  symbol: string
  list: BybitOIItem[]
  nextPageCursor?: string
}

type BybitFundingItem = {
  symbol: string
  fundingRate: string
  fundingRateTimestamp: string
}

type BybitFundingResult = {
  category: string
  list: BybitFundingItem[]
}

type Kline = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type AggTrade = {
  time: number
  price: number
  quantity: number
  isBuyerMaker: boolean
}

type OIBar = {
  time: number
  openInterest: number
}

type TickerData = {
  price: number
  change24h: number
  volume24h: number
}

type FundingData = {
  rate: number
  nextFundingTime: number
}

async function httpJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

function mapTimeframeToBybit(tf: string): string {
  switch (tf) {
    case '1m':
      return '1'
    case '5m':
      return '5'
    case '15m':
      return '15'
    case '1h':
      return '60'
    default:
      return '5'
  }
}

function mapOIInterval(tf: string): string {
  switch (tf) {
    case '1m':
      return '5min'
    case '5m':
      return '5min'
    case '15m':
      return '15min'
    case '1h':
      return '1h'
    default:
      return '5min'
  }
}

export async function fetchKlines(timeframe: string, limit: number): Promise<Kline[]> {
  const interval = mapTimeframeToBybit(timeframe)

  const data = await httpJson<BybitApiResponse<BybitKlineResult>>(
    `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  )

  if (data.retCode !== 0) {
    throw new Error(`Bybit kline error: ${data.retMsg}`)
  }

  return [...data.result.list]
    .reverse()
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }))
}

export async function fetchAggTrades(limit: number): Promise<AggTrade[]> {
  const capped = Math.min(Math.max(limit, 1), 1000)

  const data = await httpJson<BybitApiResponse<BybitTradeResult>>(
    `${BYBIT_BASE}/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=${capped}`
  )

  if (data.retCode !== 0) {
    throw new Error(`Bybit trade error: ${data.retMsg}`)
  }

  return [...data.result.list]
    .reverse()
    .map((t) => ({
      time: Math.floor(Number(t.T) / 1000),
      price: Number(t.p),
      quantity: Number(t.v),
      isBuyerMaker: t.S === 'Sell',
    }))
}

export async function fetchOIHistory(period: string, limit: number): Promise<OIBar[]> {
  const intervalTime = mapOIInterval(period)
  const capped = Math.min(Math.max(limit, 1), 200)

  const data = await httpJson<BybitApiResponse<BybitOIResult>>(
    `${BYBIT_BASE}/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=${intervalTime}&limit=${capped}`
  )

  if (data.retCode !== 0) {
    throw new Error(`Bybit open interest error: ${data.retMsg}`)
  }

  return [...data.result.list]
    .reverse()
    .map((item) => ({
      time: Math.floor(Number(item.timestamp) / 1000),
      openInterest: Number(item.openInterest),
    }))
}

export async function fetchTicker(): Promise<TickerData> {
  try {
    const data = await httpJson<BybitApiResponse<{ list: Array<{
      symbol: string
      lastPrice: string
      price24hPcnt: string
      volume24h: string
    }> }>>(
      `${BYBIT_BASE}/v5/market/tickers?category=linear&symbol=BTCUSDT`
    )

    if (data.retCode !== 0 || !data.result.list?.length) {
      throw new Error(`Bybit ticker error: ${data.retMsg}`)
    }

    const item = data.result.list[0]

    return {
      price: Number(item.lastPrice),
      change24h: Number(item.price24hPcnt) * 100,
      volume24h: Number(item.volume24h),
    }
  } catch {
    const cg = await httpJson<Record<string, {
      usd: number
      usd_24h_change: number
      usd_24h_vol: number
    }>>(
      `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
    )

    const btc = cg.bitcoin

    return {
      price: Number(btc?.usd ?? 0),
      change24h: Number(btc?.usd_24h_change ?? 0),
      volume24h: Number(btc?.usd_24h_vol ?? 0),
    }
  }
}

export async function fetchFundingRate(): Promise<FundingData> {
  const data = await httpJson<BybitApiResponse<BybitFundingResult>>(
    `${BYBIT_BASE}/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1`
  )

  if (data.retCode !== 0 || !data.result.list?.length) {
    throw new Error(`Bybit funding error: ${data.retMsg}`)
  }

  const item = data.result.list[0]
  const fundingTs = Number(item.fundingRateTimestamp)

  return {
    rate: Number(item.fundingRate),
    nextFundingTime: fundingTs + 8 * 60 * 60 * 1000,
  }
}
