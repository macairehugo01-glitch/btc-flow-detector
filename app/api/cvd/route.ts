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
  evaluateOpenSetups,
  getRecentSetups,
  getStats,
  getSessionStats,
  getCurrentPosition,
  getLastReverseBarKey,
  hasRecentDuplicate,
  openPosition,
  reversePosition,
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
    distanceFromVwapPct: number
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
        distanceFromVwapPct: 0,
      },
    }
  }

  const fundingRate = args.funding?.rate ?? 0

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100
  const distanceFromVwapPct = Math.abs(priceVsVwapPct)
  const closeEnoughToVwap = distanceFromVwapPct <= 1

  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiChangeAbs = lastOi.openInterest - prevOi.openInterest
  const oiDeltaPct =
    prevOi.openInterest !== 0
      ? (oiChangeAbs / prevOi.openInterest) * 100
      : 0

  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap

  const crossedAboveVwap =
    prevK.close <= prevV.vwap && lastK.close > lastV.vwap
  const crossedBelowVwap =
    prevK.close >= prevV.vwap && lastK.close < lastV.vwap

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

  if (!closeEnoughToVwap) {
    return {
      action: 'STABLE',
      confidence: 1,
      reasons: ['Prix trop éloigné de la VWAP (> 1%).'],
      metrics: {
        priceVsVwapPct,
        cvdDelta,
        oiDeltaPct,
        fundingRate,
        oiChangeAbs,
        distanceFromVwapPct,
      },
    }
  }

  if (aboveVwap) {
    buyScore += 1
    reasons.push('Prix au-dessus de la VWAP.')
  } else {
    buyScore = -999
  }

  if (belowVwap) {
    sellScore += 1
    reasons.push('Prix sous la VWAP.')
  } else {
    sellScore = -999
  }

  if (crossedAboveVwap || reclaimAboveVwap) {
    buyScore += 2
    reasons.push('Reprise / reclaim de la VWAP.')
  }

  if (crossedBelowVwap || rejectBelowVwap) {
    sellScore += 2
    reasons.push('Rejet / cassure sous la VWAP.')
  }

  if (cvdBullNow) {
    buyScore += 1
    reasons.push('CVD haussier sur la dernière jambe.')
  }

  if (cvdBearNow) {
    sellScore += 1
    reasons.push('CVD baissier sur la dernière jambe.')
  }

  if (cvdBullDivergence) {
    buyScore += 2
    reasons.push('Divergence haussière du CVD.')
  }

  if (cvdBearDivergence) {
    sellScore += 2
    reasons.push('Divergence baissière du CVD.')
  }

  if (oiRising) {
    if (aboveVwap) {
      buyScore += 1
      reasons.push('OI en hausse dans un contexte haussier.')
    }

    if (belowVwap) {
      sellScore += 1
      reasons.push('OI en hausse dans un contexte baissier.')
    }
  }

  if (oiFalling && aboveVwap) {
    buyScore += 1
    reasons.push('OI en baisse avec reprise haussière : short covering possible.')
  }

  if (oiFalling && belowVwap) {
    sellScore += 1
    reasons.push('OI en baisse avec faiblesse : long liquidation possible.')
  }

  if (bearishExpansion && crossedAboveVwap) {
    buyScore += 2
    reasons.push('Trap short probable après expansion vendeuse puis reprise VWAP.')
  }

  if (bullishExpansion && crossedBelowVwap) {
    sellScore += 2
    reasons.push('Trap long probable après expansion haussière puis perte VWAP.')
  }

  if (fundingTooHotLong) {
    buyScore -= 1
    reasons.push('Funding trop chaud côté long.')
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
        distanceFromVwapPct,
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
        distanceFromVwapPct,
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
        distanceFromVwapPct,
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
        distanceFromVwapPct,
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
        distanceFromVwapPct,
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
        distanceFromVwapPct,
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
      distanceFromVwapPct,
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

    evaluateOpenSetups(klines)

    const signal = computeSignal({ klines, vwap, cvd, oi, funding })

    const currentPosition = getCurrentPosition()
    const lastReverseBarKey = getLastReverseBarKey()

    const lastK = klines.at(-1)
    const prevK = klines.at(-2)

    const bullishStructureBreak =
      !!lastK && !!prevK && lastK.close > prevK.high

    const bearishStructureBreak =
      !!lastK && !!prevK && lastK.close < prevK.low

    const referenceBarKey = `${safeTimeframe}-${lastK?.time ?? 0}`

    if (ticker && (signal.action === 'BUY' || signal.action === 'SELL')) {
      if (!currentPosition) {
        if (
          signal.confidence >= 4 &&
          !hasRecentDuplicate(signal.action, safeTimeframe, Date.now())
        ) {
          openPosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action,
            confidence: signal.confidence,
            entryPrice: ticker.price,
            referenceBarKey,
          })
        }
      } else if (currentPosition.action !== signal.action) {
        const structureOk =
          signal.action === 'BUY'
            ? bullishStructureBreak
            : bearishStructureBreak

        const canReverse =
          signal.confidence >= 5 &&
          signal.confidence > currentPosition.confidence &&
          structureOk &&
          lastReverseBarKey !== referenceBarKey

        if (canReverse) {
          reversePosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action,
            confidence: signal.confidence,
            entryPrice: ticker.price,
            referenceBarKey,
          })
        }
      }
    }

    return NextResponse.json({
      klines,
      vwap,
      cvd,
      oi,
      ticker,
      funding,
      signal,
      currentPosition: getCurrentPosition(),
      setupHistory: getRecentSetups(),
      setupStats: getStats(),
      sessionStats: getSessionStats(),
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
        currentPosition: getCurrentPosition(),
        setupHistory: getRecentSetups(),
        setupStats: getStats(),
        sessionStats: getSessionStats(),
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
