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
  signalType:
    | 'continuation_long'
    | 'continuation_short'
    | 'breakout'
    | 'bullish_retest'
    | 'bearish_retest'
    | 'neutral'
  marketRegime: 'trend' | 'range' | 'breakout' | 'reversal'
  volatilityBucket: 'low' | 'medium' | 'high'
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

function getVolatilityBucket(
  klines: Array<{ high: number; low: number; close: number }>
): 'low' | 'medium' | 'high' {
  const sample = klines.slice(-10)
  if (!sample.length) return 'medium'

  const avgRangePct =
    sample.reduce((sum, k) => sum + ((k.high - k.low) / k.close) * 100, 0) /
    sample.length

  if (avgRangePct < 0.35) return 'low'
  if (avgRangePct < 1) return 'medium'
  return 'high'
}

function getMarketRegime(
  klines: Array<{ high: number; low: number; close: number }>
): 'trend' | 'range' | 'breakout' | 'reversal' {
  const sample = klines.slice(-12)
  if (sample.length < 4) return 'range'

  const highs = sample.map((k) => k.high)
  const lows = sample.map((k) => k.low)
  const closes = sample.map((k) => k.close)

  const maxHigh = Math.max(...highs)
  const minLow = Math.min(...lows)
  const rangePct = ((maxHigh - minLow) / closes.at(-1)!) * 100

  const last = closes.at(-1)!
  const prev = closes.at(-2)!
  const prev2 = closes.at(-3)!

  if (last > prev && prev > prev2 && rangePct > 1.2) return 'trend'
  if (last < prev && prev < prev2 && rangePct > 1.2) return 'trend'

  if (last > maxHigh * 0.998 || last < minLow * 1.002) return 'breakout'

  if (
    (last > prev && prev < prev2) ||
    (last < prev && prev > prev2)
  ) {
    return 'reversal'
  }

  return 'range'
}

function isValidSignalType(signalType: SignalPayload['signalType']) {
  return [
    'continuation_long',
    'continuation_short',
    'breakout',
    'bullish_retest',
    'bearish_retest',
  ].includes(signalType)
}

function isValidVwapDistance(
  signalType: SignalPayload['signalType'],
  distancePct: number
) {
  const d = Math.abs(distancePct)

  if (signalType === 'bullish_retest' || signalType === 'bearish_retest') {
    return d >= 0.02 && d <= 0.08
  }

  return d >= 0.05 && d <= 0.18
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

  const lastOi = args.oi.at(-1)
  const prevOi = args.oi.at(-2)

  const marketRegime = getMarketRegime(args.klines)
  const volatilityBucket = getVolatilityBucket(args.klines)

  if (
    !lastK ||
    !prevK ||
    !prev2K ||
    !lastV ||
    !prevV ||
    !lastCvd ||
    !prevCvd ||
    !lastOi ||
    !prevOi
  ) {
    return {
      action: 'STABLE',
      confidence: 1,
      signalType: 'neutral',
      marketRegime,
      volatilityBucket,
      reasons: ['Pas assez de données pour lire un signal.'],
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

  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiChangeAbs = lastOi.openInterest - prevOi.openInterest
  const oiDeltaPct =
    prevOi.openInterest !== 0
      ? (oiChangeAbs / prevOi.openInterest) * 100
      : 0

  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap

  const reclaimAboveVwap = prevK.low < prevV.vwap && lastK.close > lastV.vwap
  const rejectBelowVwap = prevK.high > prevV.vwap && lastK.close < lastV.vwap

  const cvdBullNow = lastCvd.delta > 0 && cvdDelta > 0
  const cvdBearNow = lastCvd.delta < 0 && cvdDelta < 0

  const oiRising = oiDeltaPct > 0.005

  let buyScore = 0
  let sellScore = 0
  const reasons: string[] = []
  let signalType: SignalPayload['signalType'] = 'neutral'

  if (aboveVwap) {
    buyScore += 1
    reasons.push('Prix au-dessus de la VWAP.')
  }

  if (belowVwap) {
    sellScore += 1
    reasons.push('Prix sous la VWAP.')
  }

  if (aboveVwap && cvdBullNow && oiRising) {
    buyScore += 3
    signalType = 'continuation_long'
    reasons.push('Continuation long : VWAP + CVD + OI alignés.')
  }

  if (belowVwap && cvdBearNow && oiRising) {
    sellScore += 3
    signalType = 'continuation_short'
    reasons.push('Continuation short : VWAP + CVD + OI alignés.')
  }

  if (
    marketRegime === 'breakout' &&
    ((aboveVwap && lastK.close > prevK.high) ||
      (belowVwap && lastK.close < prevK.low))
  ) {
    if (aboveVwap) {
      buyScore += 3
      signalType = 'breakout'
      reasons.push('Breakout haussier confirmé.')
    }

    if (belowVwap) {
      sellScore += 3
      signalType = 'breakout'
      reasons.push('Breakout baissier confirmé.')
    }
  }

  if (aboveVwap && reclaimAboveVwap && cvdBullNow) {
    buyScore += 3
    signalType = 'bullish_retest'
    reasons.push('Bullish retest de la VWAP.')
  }

  if (belowVwap && rejectBelowVwap && cvdBearNow) {
    sellScore += 3
    signalType = 'bearish_retest'
    reasons.push('Bearish retest de la VWAP.')
  }

  if (!isValidSignalType(signalType)) {
    return {
      action: 'STABLE',
      confidence: 1,
      signalType: 'neutral',
      marketRegime,
      volatilityBucket,
      reasons: ['Signal type non valide.'],
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

  if (!isValidVwapDistance(signalType, priceVsVwapPct)) {
    return {
      action: 'STABLE',
      confidence: 1,
      signalType,
      marketRegime,
      volatilityBucket,
      reasons: ['Distance VWAP non valide pour ce signal type.'],
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

  if (
    (signalType === 'continuation_long' || signalType === 'bullish_retest') &&
    !aboveVwap
  ) {
    return {
      action: 'STABLE',
      confidence: 1,
      signalType,
      marketRegime,
      volatilityBucket,
      reasons: ['BUY interdit sous VWAP.'],
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

  if (
    (signalType === 'continuation_short' || signalType === 'bearish_retest') &&
    !belowVwap
  ) {
    return {
      action: 'STABLE',
      confidence: 1,
      signalType,
      marketRegime,
      volatilityBucket,
      reasons: ['SELL interdit au-dessus VWAP.'],
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

  if (buyScore >= 5 && buyScore > sellScore) {
    return {
      action: 'BUY',
      confidence: 5,
      signalType,
      marketRegime,
      volatilityBucket,
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

  if (sellScore >= 5 && sellScore > buyScore) {
    return {
      action: 'SELL',
      confidence: 5,
      signalType,
      marketRegime,
      volatilityBucket,
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
      signalType,
      marketRegime,
      volatilityBucket,
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
      signalType,
      marketRegime,
      volatilityBucket,
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
    signalType: 'neutral',
    marketRegime,
    volatilityBucket,
    reasons: reasons.length ? reasons : ['Pas de signal propre.'],
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
            signalType: signal.signalType,
            marketRegime: signal.marketRegime,
            vwapDistancePct: signal.metrics.distanceFromVwapPct,
            volatilityBucket: signal.volatilityBucket,
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
          signal.signalType !== 'neutral' &&
          isValidSignalType(signal.signalType) &&
          isValidVwapDistance(signal.signalType, signal.metrics.priceVsVwapPct) &&
          lastReverseBarKey !== referenceBarKey

        if (canReverse) {
          reversePosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action,
            confidence: signal.confidence,
            entryPrice: ticker.price,
            referenceBarKey,
            signalType: signal.signalType,
            marketRegime: signal.marketRegime,
            vwapDistancePct: signal.metrics.distanceFromVwapPct,
            volatilityBucket: signal.volatilityBucket,
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
