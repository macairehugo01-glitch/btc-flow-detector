const OKX_BASE = 'https://www.okx.com'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

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

type OkxResponse<T> = {
  code: string
  msg: string
  data: T[]
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

function mapTimeframeToOkx(tf: string): string {
  switch (tf) {
    case '1m':
      return '1m'
    case '5m':
      return '5m'
    case '15m':
      return '15m'
    case '1h':
      return '1H'
    default:
      return '5m'
  }
}

export async function fetchKlines(timeframe: string, limit: number): Promise<Kline[]> {
  const bar = mapTimeframeToOkx(timeframe)

  const data = await httpJson<OkxResponse<string[]>>(
    `${OKX_BASE}/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=${encodeURIComponent(bar)}&limit=${limit}`
  )

  if (data.code !== '0') {
    throw new Error(`OKX candles error: ${data.msg}`)
  }

  return [...data.data]
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
  const capped = Math.min(Math.max(limit, 1), 100)

  const data = await httpJson<
    OkxResponse<{
      instId: string
      tradeId: string
      px: string
      sz: string
      side: 'buy' | 'sell'
      ts: string
    }>
  >(
    `${OKX_BASE}/api/v5/market/trades?instId=BTC-USDT-SWAP&limit=${capped}`
  )

  if (data.code !== '0') {
    throw new Error(`OKX trades error: ${data.msg}`)
  }

  return [...data.data]
    .reverse()
    .map((t) => ({
      time: Math.floor(Number(t.ts) / 1000),
      price: Number(t.px),
      quantity: Number(t.sz),
      isBuyerMaker: t.side === 'sell',
    }))
}

/**
 * OKX fournit un endpoint public d'open interest snapshot.
 * Pour garder ton UI compatible, on reconstruit une série plate
 * de longueur "limit" avec la même valeur d'OI et des timestamps récents.
 */
export async function fetchOIHistory(period: string, limit: number): Promise<OIBar[]> {
  const data = await httpJson<
    OkxResponse<{
      instId: string
      instType: string
      oi: string
      oiCcy?: string
      oiUsd?: string
      ts: string
    }>
  >(
    `${OKX_BASE}/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP`
  )

  if (data.code !== '0' || !data.data.length) {
    throw new Error(`OKX open interest error: ${data.msg}`)
  }

  const item = data.data[0]
  const oi = Number(item.oi)
  const endTs = Math.floor(Number(item.ts) / 1000)

  let step = 300
  if (period === '15m') step = 900
  if (period === '1h') step = 3600

  return Array.from({ length: limit }, (_, i) => {
    const indexFromEnd = limit - 1 - i
    return {
      time: endTs - indexFromEnd * step,
      openInterest: oi,
    }
  })
}

export async function fetchTicker(): Promise<TickerData> {
  try {
    const data = await httpJson<
      OkxResponse<{
        instId: string
        last: string
        vol24h: string
        open24h?: string
        sodUtc0?: string
      }>
    >(
      `${OKX_BASE}/api/v5/market/ticker?instId=BTC-USDT-SWAP`
    )

    if (data.code !== '0' || !data.data.length) {
      throw new Error(`OKX ticker error: ${data.msg}`)
    }

    const item = data.data[0]
    const last = Number(item.last)
    const open24h = Number(item.open24h ?? item.sodUtc0 ?? 0)
    const change24h = open24h > 0 ? ((last - open24h) / open24h) * 100 : 0

    return {
      price: last,
      change24h,
      volume24h: Number(item.vol24h),
    }
  } catch {
    const cg = await httpJson<
      Record<
        string,
        {
          usd: number
          usd_24h_change: number
          usd_24h_vol: number
        }
      >
    >(
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
  const data = await httpJson<
    OkxResponse<{
      instId: string
      fundingRate: string
      fundingTime: string
      nextFundingTime?: string
    }>
  >(
    `${OKX_BASE}/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=1`
  )

  if (data.code !== '0' || !data.data.length) {
    throw new Error(`OKX funding error: ${data.msg}`)
  }

  const item = data.data[0]
  const fundingTime = Number(item.fundingTime)
  const nextFundingTime =
    item.nextFundingTime != null
      ? Number(item.nextFundingTime)
      : fundingTime + 8 * 60 * 60 * 1000

  return {
    rate: Number(item.fundingRate),
    nextFundingTime,
  }
}
