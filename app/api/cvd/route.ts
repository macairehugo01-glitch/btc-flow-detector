import { NextRequest, NextResponse } from 'next/server'
import {
  fetchKlines,
  fetchAggTrades,
  fetchCurrentOI,
  fetchTicker,
  fetchFundingRate,
} from '../../../binance'
import { calculateVWAP, calculateCVD } from '../../../indicators'
import type { Timeframe } from '../../../useMarketStore'
import {
  createSetup,
  evaluateOpenSetups,
  getRecentSetups,
  getStats,
  hasRecentDuplicate,
} from '../../../store'

export const dynamic = 'force-dynamic'

type OIBar = {
  time: number
  openInterest: number
}

type SignalPayload = {
  action: 'BUY' | 'SELL' | 'STABLE'
  confidence: number
  reasons: string[]
  metrics: {
    priceVsVwapPct: number
    cvdDelta: number
    oiDeltaPct: number
    fundingRate: number
    oiChangeAbs: number
  }
}

const oiSessionBuffer: OIBar[] = []
const MAX_OI_POINTS = 500

function pushOiSnapshot(snapshot: OIBar) {
  const last = oiSessionBuffer.at(-1)

  if (!last) {
    oiSessionBuffer.push(snapshot)
    return
  }

  if (
    snapshot.time !== last.time ||
    snapshot.openInterest !== last.openInterest
  ) {
    oiSessionBuffer.push(snapshot)
  }

  while (oiSessionBuffer.length > MAX_OI_POINTS) {
    oiSessionBuffer.shift()
  }
}

function buildOiSeriesForKlines(klines: Array<{ time: number }>): OIBar[] {
  if (!klines.length || !oiSessionBuffer.length) return []

  return klines.map((k) => {
    let matched = oiSessionBuffer[0]

    for (const point of oiSessionBuffer) {
      if (point.time <= k.time) matched = point
      else break
    }

    return {
      time: k.time,
      openInterest: matched.openInterest,
    }
  })
}

  if (buyScore >= 5 && buyScore > sellScore + 1) {
    return {
      action: 'BUY',
      confidence: 5,
      reasons,
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
      },
    }
  }

  if (sellScore >= 5 && sellScore > buyScore + 1) {
    return {
      action: 'SELL',
      confidence: 5,
      reasons,
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
      },
    }
  }

  if (buyScore >= 4 && buyScore > sellScore) {
    return {
      action: 'BUY',
      confidence: 4,
      reasons,
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
      },
    }
  }

  if (sellScore >= 4 && sellScore > buyScore) {
    return {
      action: 'SELL',
      confidence: 4,
      reasons,
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
      },
    }
  }

  if (buyScore >= 3 && buyScore > sellScore) {
    return {
      action: 'BUY',
      confidence: 3,
      reasons,
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
      },
    }
  }

  if (sellScore >= 3 && sellScore > buyScore) {
    return {
      action: 'SELL',
      confidence: 3,
      reasons,
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
      },
    }
  }
export async function GET(req: NextRequest) {
  const timeframe = (req.nextUrl.searchParams.get('timeframe') ?? '5m') as Timeframe
  const safeTimeframe: Timeframe = ['1m', '5m', '15m', '1h'].includes(timeframe)
    ? timeframe
    : '5m'

  try {
    const [klines, trades, oiSnapshot, ticker, funding] = await Promise.all([
      fetchKlines(safeTimeframe, 200),
      fetchAggTrades(100),
      fetchCurrentOI(),
      fetchTicker(),
      fetchFundingRate(),
    ])

    pushOiSnapshot(oiSnapshot)

    const vwap = calculateVWAP(klines, 200)
    const cvd = calculateCVD(trades, klines)
    const oi = buildOiSeriesForKlines(klines)
    const signal = computeSignal({ klines, vwap, cvd, oi, funding })

  if (
  ticker &&
  (signal.action === 'BUY' || signal.action === 'SELL') &&
  signal.confidence >= 4 &&
  !hasRecentDuplicate(signal.action, Date.now())
) {
      createSetup({
        timestamp: Date.now(),
        action: signal.action,
        confidence: signal.confidence,
        entryPrice: ticker.price,
      })
    }

    evaluateOpenSetups(klines)

    return NextResponse.json({
      klines,
      vwap,
      cvd,
      oi,
      ticker,
      funding,
      signal,
      setupHistory: getRecentSetups(),
      setupStats: getStats(),
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
        signal: null,
        setupHistory: getRecentSetups(),
        setupStats: getStats(),
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
