import { NextRequest, NextResponse } from 'next/server'
import {
  fetchKlines,
  fetchAggTrades,
  fetchOIHistory,
  fetchTicker,
  fetchFundingRate,
} from '../../../binance'
import { calculateVWAP, calculateCVD } from '../../../indicators'
import type { Timeframe } from '../../../useMarketStore'

export const dynamic = 'force-dynamic'

const OI_PERIOD_BY_TIMEFRAME: Record<Timeframe, string> = {
  '1m': '5m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
}

export async function GET(req: NextRequest) {
  const timeframe = (req.nextUrl.searchParams.get('timeframe') ?? '5m') as Timeframe
  const safeTimeframe: Timeframe = ['1m', '5m', '15m', '1h'].includes(timeframe)
    ? timeframe
    : '5m'

  try {
    const [klines, trades, oi, ticker, funding] = await Promise.all([
      fetchKlines(safeTimeframe, 200),
      fetchAggTrades(500),
      fetchOIHistory(OI_PERIOD_BY_TIMEFRAME[safeTimeframe], 96),
      fetchTicker(),
      fetchFundingRate(),
    ])

    const vwap = calculateVWAP(klines, 200)
    const cvd = calculateCVD(trades, klines)

    return NextResponse.json({
      klines,
      vwap,
      cvd,
      oi,
      ticker,
      funding,
      setupHistory: [],
      lastUpdate: Date.now(),
      timeframe: safeTimeframe,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown API route error'

    return NextResponse.json(
      {
        error: message,
        klines: [],
        vwap: [],
        cvd: [],
        oi: [],
        ticker: null,
        funding: null,
        setupHistory: [],
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
