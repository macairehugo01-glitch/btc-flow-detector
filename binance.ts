const BINANCE_FUTURES_BASE = 'https://fapi.binance.com'

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

async function binanceFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BINANCE_FUTURES_BASE}${path}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Binance API error ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

export async function fetchKlines(timeframe: string, limit: number): Promise<Kline[]> {
  const data = await binanceFetch<any[]>(
    `/fapi/v1/klines?symbol=BTCUSDT&interval=${encodeURIComponent(timeframe)}&limit=${limit}`
  )

  return data.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

export async function fetchAggTrades(limit: number): Promise<AggTrade[]> {
  const data = await binanceFetch<any[]>(
    `/fapi/v1/aggTrades?symbol=BTCUSDT&limit=${limit}`
  )

  return data.map((t) => ({
    time: Math.floor(Number(t.T) / 1000),
    price: Number(t.p),
    quantity: Number(t.q),
    isBuyerMaker: Boolean(t.m),
  }))
}

export async function fetchOIHistory(period: string, limit: number): Promise<OIBar[]> {
  const data = await binanceFetch<any[]>(
    `/futures/data/openInterestHist?symbol=BTCUSDT&period=${encodeURIComponent(period)}&limit=${limit}`
  )

  return data.map((item) => ({
    time: Math.floor(Number(item.timestamp) / 1000),
    openInterest: Number(item.sumOpenInterest),
  }))
}

export async function fetchTicker(): Promise<TickerData> {
  const data = await binanceFetch<any>(
    `/fapi/v1/ticker/24hr?symbol=BTCUSDT`
  )

  return {
    price: Number(data.lastPrice),
    change24h: Number(data.priceChangePercent),
    volume24h: Number(data.volume),
  }
}

export async function fetchFundingRate(): Promise<FundingData> {
  const premium = await binanceFetch<any>(
    `/fapi/v1/premiumIndex?symbol=BTCUSDT`
  )

  return {
    rate: Number(premium.lastFundingRate),
    nextFundingTime: Number(premium.nextFundingTime),
  }
}
