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

function computeSignal(args: {
  klines: Array<{ close: number }>
  vwap: Array<{ vwap: number }>
  cvd: Array<{ delta: number; cvd: number }>
  oi: Array<{ openInterest: number }>
  funding: { rate: number } | null
}): SignalPayload {
  const lastK = args.klines.at(-1)
  const lastV = args.vwap.at(-1)
  const lastCvd = args.cvd.at(-1)
  const prevCvd = args.cvd.at(-2)
  const lastOi = args.oi.at(-1)
  const prevOi = args.oi.at(-2)

  if (!lastK || !lastV || !lastCvd || !prevCvd || !lastOi || !prevOi) {
    return {
      action: 'STABLE',
      confidence: 1,
      reasons: ['Pas assez de données.'],
      metrics: {
        priceVsVwapPct: 0,
        cvdDelta: 0,
        oiDeltaPct: 0,
        fundingRate: args.funding?.rate ?? 0,
        oiChangeAbs: 0,
      },
    }
  }

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100
  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiChangeAbs = lastOi.openInterest - prevOi.openInterest
  const oiDeltaPct =
    prevOi.openInterest !== 0
      ? (oiChangeAbs / prevOi.openInterest) * 100
      : 0
  const fundingRate = args.funding?.rate ?? 0

  const aboveVwap = priceVsVwapPct > 0
  const belowVwap = priceVsVwapPct < 0
  const strongAboveVwap = priceVsVwapPct > 0.15
  const strongBelowVwap = priceVsVwapPct < -0.15

  const cvdBullish = cvdDelta > 0
  const cvdBearish = cvdDelta < 0

  const oiRising = oiDeltaPct > 0.005
  const oiFalling = oiDeltaPct < -0.005

  const reasons: string[] = []
  let buyScore = 0
  let sellScore = 0

  if (aboveVwap) {
    buyScore += 1
    reasons.push('Prix au-dessus de la VWAP.')
  }
  if (belowVwap) {
    sellScore += 1
    reasons.push('Prix sous la VWAP.')
  }

  if (strongAboveVwap) buyScore += 1
  if (strongBelowVwap) sellScore += 1

  if (cvdBullish) {
    buyScore += 1
    reasons.push('CVD positif.')
  }
  if (cvdBearish) {
    sellScore += 1
    reasons.push('CVD négatif.')
  }

  if (oiRising && aboveVwap && cvdBullish) {
    buyScore += 2
    reasons.push("OI en hausse avec participation haussière.")
  }

  if (oiRising && belowVwap && cvdBearish) {
    sellScore += 2
    reasons.push("OI en hausse avec participation vendeuse.")
  }

  if (oiFalling) {
    reasons.push("OI en baisse : plutôt fermeture de positions.")
  }

  if (fundingRate > 0.001) {
    buyScore -= 1
    reasons.push('Funding trop chaud côté long.')
  }

  if (fundingRate < -0.001) {
    sellScore -= 1
    reasons.push('Funding trop chaud côté short.')
  }

  if (buyScore >= 5 && buyScore > sellScore) {
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

  if (sellScore >= 5 && sellScore > buyScore) {
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

  return {
    action: 'STABLE',
    confidence: 2,
    reasons: reasons.length ? reasons : ['Marché mixte, pas de setup net.'],
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
      signal.confidence === 5 &&
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
