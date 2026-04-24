const BINANCE_FUTURES = 'https://fapi.binance.com'
const OKX_BASE = 'https://www.okx.com'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

type Kline = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  takerBuyVolume: number // volume acheteur (taker buy) — pour CVD
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
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

function mapTimeframeToBinance(tf: string): string {
  switch (tf) {
    case '1m': return '1m'
    case '5m': return '5m'
    case '15m': return '15m'
    case '1h': return '1h'
    default: return '5m'
  }
}

/**
 * Klines Binance Futures BTCUSDT.
 * Colonnes retournées :
 * [0] openTime, [1] open, [2] high, [3] low, [4] close,
 * [5] volume, [6] closeTime, [7] quoteVolume, [8] trades,
 * [9] takerBuyBaseVolume, [10] takerBuyQuoteVolume
 *
 * takerBuyBaseVolume [9] = volume acheteur → utilisé pour CVD
 */
export async function fetchKlines(timeframe: string, limit: number): Promise<Kline[]> {
  const interval = mapTimeframeToBinance(timeframe)

  const data = await httpJson<(string | number)[][]>(
    `${BINANCE_FUTURES}/fapi/v1/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  )

  return data.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    takerBuyVolume: Number(k[9]),
  }))
}

/**
 * AggTrades Binance Futures — gardé pour compatibilité mais plus utilisé pour CVD.
 * Le CVD est maintenant calculé depuis les klines (takerBuyVolume).
 */
export async function fetchAggTrades(_limit: number): Promise<AggTrade[]> {
  try {
    const data = await httpJson<{
      a: number
      p: string
      q: string
      T: number
      m: boolean
    }[]>(
      `${BINANCE_FUTURES}/fapi/v1/aggTrades?symbol=BTCUSDT&limit=100`
    )

    return data
      .map((t) => ({
        time: t.T, // ms
        price: Number(t.p),
        quantity: Number(t.q),
        isBuyerMaker: t.m,
      }))
      .sort((a, b) => a.time - b.time)
  } catch {
    return []
  }
}

/**
 * OI historique Binance Futures — gratuit, jusqu'à 500 points.
 * period : 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d
 */
export async function fetchCurrentOI(): Promise<OIBar> {
  const data = await httpJson<{
    symbol: string
    openInterest: string
    time: number
  }>(
    `${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=BTCUSDT`
  )

  return {
    time: Math.floor(data.time / 1000),
    openInterest: Number(data.openInterest),
  }
}

/**
 * Historique OI Binance Futures — 200 points sur la période demandée.
 * Utilisé pour remplir le buffer OI dès le démarrage.
 */
export async function fetchOIHistory(period: string = '5m', limit: number = 200): Promise<OIBar[]> {
  try {
    const data = await httpJson<{
      symbol: string
      sumOpenInterest: string
      sumOpenInterestValue: string
      timestamp: number
    }[]>(
      `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=BTCUSDT&period=${period}&limit=${limit}`
    )

    return data.map((d) => ({
      time: Math.floor(d.timestamp / 1000),
      openInterest: Number(d.sumOpenInterest),
    }))
  } catch {
    const current = await fetchCurrentOI()
    return [current]
  }
}

export async function fetchTicker(): Promise<TickerData> {
  try {
    const data = await httpJson<{
      symbol: string
      lastPrice: string
      priceChangePercent: string
      volume: string
    }>(
      `${BINANCE_FUTURES}/fapi/v1/ticker/24hr?symbol=BTCUSDT`
    )

    return {
      price: Number(data.lastPrice),
      change24h: Number(data.priceChangePercent),
      volume24h: Number(data.volume),
    }
  } catch {
    // Fallback OKX
    try {
      const data = await httpJson<{
        code: string
        data: { last: string; vol24h: string; open24h: string }[]
      }>(
        `${OKX_BASE}/api/v5/market/ticker?instId=BTC-USDT-SWAP`
      )

      if (data.code === '0' && data.data.length) {
        const item = data.data[0]
        const last = Number(item.last)
        const open24h = Number(item.open24h ?? 0)
        return {
          price: last,
          change24h: open24h > 0 ? ((last - open24h) / open24h) * 100 : 0,
          volume24h: Number(item.vol24h),
        }
      }
    } catch {}

    // Fallback CoinGecko
    const cg = await httpJson<
      Record<string, { usd: number; usd_24h_change: number; usd_24h_vol: number }>
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
  try {
    const data = await httpJson<{
      symbol: string
      fundingRate: string
      fundingTime: number
      nextFundingTime: number
    }[]>(
      `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1`
    )

    if (!data.length) throw new Error('No funding data')

    const item = data[0]
    return {
      rate: Number(item.fundingRate),
      nextFundingTime: item.nextFundingTime ?? item.fundingTime + 8 * 60 * 60 * 1000,
    }
  } catch {
    // Fallback OKX
    const data = await httpJson<{
      code: string
      data: { fundingRate: string; fundingTime: string; nextFundingTime?: string }[]
    }>(
      `${OKX_BASE}/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP&limit=1`
    )

    if (data.code !== '0' || !data.data.length) {
      throw new Error('OKX funding error')
    }

    const item = data.data[0]
    const fundingTime = Number(item.fundingTime)
    return {
      rate: Number(item.fundingRate),
      nextFundingTime: item.nextFundingTime
        ? Number(item.nextFundingTime)
        : fundingTime + 8 * 60 * 60 * 1000,
    }
  }
}
