import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines, fetchAggTrades, fetchOIHistory, fetchTicker, fetchFundingRate } from '../../../binance'
import { calculateVWAP, calculateCVD } from '../../../indicators'
import { saveSetup } from '../../../store'

export const dynamic = 'force-dynamic'

const DEFAULT_THRESHOLDS = {
  mode: 'aggressive',
}

type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

function detectPattern(
  resolvedKlines: any[],
  cvd: any,
  resolvedOI: any[],
  vwap: any,
  config: any
) {
  return {
    signal: 'neutral',
    confidence: 0,
    mode: config.mode,
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const timeframe = (searchParams.get('timeframe') ?? '5m') as Timeframe
  const mode = searchParams.get('mode') === 'strict' ? 'strict' : 'aggressive'

  try {
    const [klines, trades, oiHistory, ticker, funding] = await Promise.allSettled([
      fetchKlines(timeframe, 200),
      fetchAggTrades(500),
      fetchOIHistory('5m', 96),
      fetchTicker(),
      fetchFundingRate(),
    ])

    const resolvedKlines = klines.status === 'fulfilled' ? klines.value : []
    const resolvedTrades = trades.status === 'fulfilled' ? trades.value : []
    const resolvedOI = oiHistory.status === 'fulfilled' ? oiHistory.value : []

    const vwap = calculateVWAP(resolvedKlines, 100)
    const cvd = calculateCVD(resolvedTrades, resolvedKlines)
    const config = { ...DEFAULT_THRESHOLDS, mode }
    const pattern = detectPattern(resolvedKlines, cvd, resolvedOI, vwap, config)

    try {
      saveSetup(pattern)
    } catch {}

    return NextResponse.json(
      {
        klines: resolvedKlines,
        vwap,
        cvd,
        oi: resolvedOI,
        pattern,
        lastUpdate: Date.now(),
        timeframe,
        ticker: ticker.status === 'fulfilled' ? ticker.value : null,
        funding: funding.status === 'fulfilled' ? funding.value : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
