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
  getSessionStats,
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
  klines: Array<{ open: number; high: number; low: number; close: number }>
  vwap: Array<{ vwap: number }>
  cvd: Array<{ delta: number; cvd: number }>
  oi: Array<{ openInterest: number }>
  funding: { rate: number } | null
}): SignalPayload {
  const lastK = args.klines.at(-1)
  const prevK = args.klines.at(-2)
  const prev2K = args.klines.at(-3)

  const lastV = args.vwap.at(-1)
  const prevV = args.vwap.at(-2)

  const lastCvd = args.cvd.at(-1)
  const prevCvd = args.cvd.at(-2)
  const prev2Cvd = args.cvd.at(-3)

  const lastOi = args.oi.at(-1)
  const prevOi = args.oi.at(-2)
  const prev2Oi = args.oi.at(-3)

  if (
    !lastK ||
    !prevK ||
    !prev2K ||
    !lastV ||
    !prevV ||
    !lastCvd ||
    !prevCvd ||
    !prev2Cvd ||
    !lastOi ||
    !prevOi ||
    !prev2Oi
  ) {
    return {
      action: 'STABLE',
      confidence: 1,
      reasons: ['Pas assez de données pour lire un majority trap.'],
      metrics: {
        priceVsVwapPct: 0,
        cvdDelta: 0,
        oiDeltaPct: 0,
        fundingRate: args.funding?.rate ?? 0,
        oiChangeAbs: 0,
      },
    }
  }

  const fundingRate = args.funding?.rate ?? 0

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100
  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiChangeAbs = lastOi.openInterest - prevOi.openInterest
  const oiDeltaPct =
    prevOi.openInterest !== 0
      ? (oiChangeAbs / prevOi.openInterest) * 100
      : 0

  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap

  const crossedAboveVwap = prevK.close <= prevV.vwap && lastK.close > lastV.vwap
  const crossedBelowVwap = prevK.close >= prevV.vwap && lastK.close < lastV.vwap

  const reclaimAboveVwap = prevK.low < prevV.vwap && lastK.close > lastV.vwap
  const rejectBelowVwap = prevK.high > prevV.vwap && lastK.close < lastV.vwap

  const cvdBullNow = lastCvd.delta > 0 && cvdDelta > 0
  const cvdBearNow = lastCvd.delta < 0 && cvdDelta < 0

  const cvdBullDivergence =
    lastK.close <= prevK.close && lastCvd.cvd > prevCvd.cvd

  const cvdBearDivergence =
    lastK.close >= prevK.close && lastCvd.cvd < prevCvd.cvd

  const oiRising = oiDeltaPct > 0.005
  const oiFalling = oiDeltaPct < -0.005

  const oiRisingTwoBars =
    lastOi.openInterest > prevOi.openInterest &&
    prevOi.openInterest >= prev2Oi.openInterest

  const priceMadeDownMove =
    lastK.close < prevK.close || prevK.close < prev2K.close

  const priceMadeUpMove =
    lastK.close > prevK.close || prevK.close > prev2K.close

  const bearishExpansion =
    priceMadeDownMove && oiRisingTwoBars && cvdBearNow

  const bullishExpansion =
    priceMadeUpMove && oiRisingTwoBars && cvdBullNow

  const fundingTooHotLong = fundingRate > 0.001
  const fundingTooHotShort = fundingRate < -0.001

  let buyScore = 0
  let sellScore = 0
  const reasons: string[] = []

  if (aboveVwap) {
    buyScore += 1
    reasons.push('Prix au-dessus de la VWAP.')
  }

  if (crossedAboveVwap || reclaimAboveVwap) {
    buyScore += 2
    reasons.push('Reprise / reclaim de la VWAP.')
  }

  if (cvdBullNow) {
    buyScore += 1
    reasons.push('CVD haussier sur la dernière jambe.')
  }

  if (cvdBullDivergence) {
    buyScore += 2
    reasons.push('Divergence haussière du CVD : pression vendeuse absorbée.')
  }

  if (oiRising) {
    buyScore += 1
    reasons.push('Open interest en hausse : nouvelles positions entrent.')
  }

  if (oiFalling && aboveVwap) {
    buyScore += 1
    reasons.push('OI en baisse avec reprise haussière : probable short covering.')
  }

  if (bearishExpansion && crossedAboveVwap) {
    buyScore += 2
    reasons.push('Trap short probable après expansion vendeuse puis reprise VWAP.')
  }

  if (fundingTooHotLong) {
    buyScore -= 1
    reasons.push('Funding trop chaud côté long.')
  }

  if (belowVwap) {
    sellScore += 1
    reasons.push('Prix sous la VWAP.')
  }

  if (crossedBelowVwap || rejectBelowVwap) {
    sellScore += 2
    reasons.push('Rejet / cassure sous la VWAP.')
  }

  if (cvdBearNow) {
    sellScore += 1
    reasons.push('CVD baissier sur la dernière jambe.')
  }

  if (cvdBearDivergence) {
    sellScore += 2
    reasons.push('Divergence baissière du CVD : pression acheteuse absorbée.')
  }

  if (oiRising) {
    sellScore += 1
    reasons.push('Open interest en hausse : nouvelles positions entrent.')
  }

  if (oiFalling && belowVwap) {
    sellScore += 1
    reasons.push('OI en baisse avec faiblesse du prix : probable long liquidation.')
  }

  if (bullishExpansion && crossedBelowVwap) {
    sellScore += 2
    reasons.push('Trap long probable après expansion haussière puis perte VWAP.')
  }

  if (fundingTooHotShort) {
    sellScore -= 1
    reasons.push('Funding trop chaud côté short.')
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

  return {
    action: 'STABLE',
    confidence: 2,
    reasons: reasons.length ? reasons : ['Pas de majority trap net.'],
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
  !hasRecentDuplicate(signal.action, safeTimeframe, Date.now())
) {
  createSetup({
    timestamp: Date.now(),
    timeframe: safeTimeframe,
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
