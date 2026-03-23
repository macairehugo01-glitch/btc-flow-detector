/**
 * app/api/market/route.ts
 * Main API endpoint — returns all market data + pattern result
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines, fetchAggTrades, fetchOIHistory, fetchTicker, fetchFundingRate } from '@/lib/binance'
import { calculateVWAP, calculateCVD } from '@/lib/indicators'
import { detectPattern } from '@/lib/patterns'
import { saveSetup } from '@/lib/db'
import { DEFAULT_THRESHOLDS } from '@/types'
import type { Timeframe, MarketDataResponse } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const timeframe = (searchParams.get('timeframe') ?? '5m') as Timeframe
  const mode = searchParams.get('mode') === 'strict' ? 'strict' : 'aggressive'

  try {
    // Parallel fetch for performance
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

    // Calculate derived indicators
    const vwap = calculateVWAP(resolvedKlines, 100)
    const cvd = calculateCVD(resolvedTrades, resolvedKlines)

    // Run pattern engine
    const config = { ...DEFAULT_THRESHOLDS, mode }
    const pattern = detectPattern(resolvedKlines, cvd, resolvedOI, vwap, config)

    // Persist to SQLite if actionable signal
    try {
      saveSetup(pattern)
    } catch (dbErr) {
      console.error('DB save error:', dbErr)
    }

    const response: MarketDataResponse & {
      ticker?: { price: number; change24h: number; volume24h: number }
      funding?: { rate: number; nextFundingTime: number } | null
    } = {
      klines: resolvedKlines,
      vwap,
      cvd,
      oi: resolvedOI,
      pattern,
      lastUpdate: Date.now(),
      timeframe,
      ticker: ticker.status === 'fulfilled' ? ticker.value : undefined,
      funding: funding.status === 'fulfilled' ? funding.value : null,
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    console.error('Market API error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch market data', details: String(err) },
      { status: 500 }
    )
  }
}
