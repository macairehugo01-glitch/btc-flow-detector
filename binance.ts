const BYBIT = 'https://api.bybit.com'
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'

type Kline = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  takerBuyVolume: number
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

function mapTimeframeToBybit(tf: string): string {
  switch (tf) {
    case '1m': return '1'
    case '5m': return '5'
    case '15m': return '15'
    case '1h': return '60'
    default: return '5'
  }
}

export async function fetchKlines(timeframe: string, limit: number): Promise<Kline[]> {
  const interval = mapTimeframeToBybit(timeframe)

  const data = await httpJson<{
    retCode: number
    retMsg: string
    result: {
      category: string
      symbol: string
      list: string[][]
    }
  }>(
    `${BYBIT}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${interval}&limit=${limit}`
  )

  if (data.retCode !== 0) {
    throw new Error(`Bybit klines error: ${data.retMsg}`)
  }

  const klines = [...data.result.list].reverse().map((k) => {
    const open = Number(k[1])
    const high = Number(k[2])
    const low = Number(k[3])
    const close = Number(k[4])
    const volume = Number(k[5])
    const takerBuyVolume = close >= open ? volume * 0.6 : volume * 0.4

    return {
      time: Math.floor(Number(k[0]) / 1000),
      open,
      high,
      low,
      close,
      volume,
      takerBuyVolume,
    }
  })

  return klines
}

export async function fetchAggTrades(_limit: number): Promise<AggTrade[]> {
  try {
    const data = await httpJson<{
      retCode: number
      result: {
        list: {
          execId: string
          symbol: string
          price: string
          size: string
          side: 'Buy' | 'Sell'
          time: string
          isBlockTrade: boolean
        }[]
      }
    }>(
      `${BYBIT}/v5/market/recent-trade?category=linear&symbol=BTCUSDT&limit=100`
    )

    if (data.retCode !== 0) return []

    return [...data.result.list]
      .reverse()
      .map((t) => ({
        time: Number(t.time),
        price: Number(t.price),
        quantity: Number(t.size),
        isBuyerMaker: t.side === 'Sell',
      }))
  } catch {
    return []
  }
}

/**
 * OI snapshot actuel — utilise limit=1 sur la liste pour avoir le dernier point.
 * L'API Bybit retourne une liste même avec limit=1.
 */
export async function fetchCurrentOI(): Promise<OIBar> {
  const data = await httpJson<{
    retCode: number
    retMsg: string
    result: {
      symbol: string
      category: string
      list: {
        openInterest: string
        timestamp: string
      }[]
    }
  }>(
    `${BYBIT}/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=5min&limit=1`
  )

  if (data.retCode !== 0 || !data.result?.list?.length) {
    throw new Error(`Bybit OI error: ${data.retMsg}`)
  }

  const item = data.result.list[0]
  return {
    time: Math.floor(Number(item.timestamp) / 1000),
    openInterest: Number(item.openInterest),
  }
}

/**
 * Historique OI Bybit — jusqu'à 200 points.
 * intervalTime : 5min, 15min, 30min, 1h, 4h, 1d
 */
export async function fetchOIHistory(period: string = '5min', limit: number = 200): Promise<OIBar[]> {
  try {
    const data = await httpJson<{
      retCode: number
      retMsg: string
      result: {
        symbol: string
        category: string
        list: {
          openInterest: string
          timestamp: string
        }[]
      }
    }>(
      `${BYBIT}/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=${period}&limit=${limit}`
    )

    if (data.retCode !== 0 || !data.result?.list?.length) {
      throw new Error(`Bybit OI history error: ${data.retMsg}`)
    }

    return [...data.result.list]
      .reverse()
      .map((d) => ({
        time: Math.floor(Number(d.timestamp) / 1000),
        openInterest: Number(d.openInterest),
      }))
  } catch (err) {
    console.error('[OI] fetchOIHistory failed:', err)
    const current = await fetchCurrentOI()
    return [current]
  }
}

export async function fetchTicker(): Promise<TickerData> {
  try {
    const data = await httpJson<{
      retCode: number
      retMsg: string
      result: {
        list: {
          symbol: string
          lastPrice: string
          price24hPcnt: string
          volume24h: string
        }[]
      }
    }>(
      `${BYBIT}/v5/market/tickers?category=linear&symbol=BTCUSDT`
    )

    if (data.retCode !== 0 || !data.result?.list?.length) {
      throw new Error(`Bybit ticker error: ${data.retMsg}`)
    }

    const item = data.result.list[0]
    return {
      price: Number(item.lastPrice),
      change24h: Number(item.price24hPcnt) * 100,
      volume24h: Number(item.volume24h),
    }
  } catch {
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
      retCode: number
      retMsg: string
      result: {
        list: {
          symbol: string
          fundingRate: string
          fundingRateTimestamp: string
        }[]
      }
    }>(
      `${BYBIT}/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1`
    )

    if (data.retCode !== 0 || !data.result?.list?.length) {
      throw new Error(`Bybit funding error: ${data.retMsg}`)
    }

    const item = data.result.list[0]
    const fundingTime = Number(item.fundingRateTimestamp)
    return {
      rate: Number(item.fundingRate),
      nextFundingTime: fundingTime + 8 * 60 * 60 * 1000,
    }
  } catch (err) {
    console.error('[Funding] Bybit failed:', err)
    return { rate: 0, nextFundingTime: Date.now() + 8 * 60 * 60 * 1000 }
  }
}
