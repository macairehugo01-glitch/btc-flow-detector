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

  const sameTime = snapshot.time === last.time
  const sameValue = snapshot.openInterest === last.openInterest

  if (sameTime && sameValue) return

  if (!sameTime || !sameValue) {
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
      if (point.time <= k.time) {
        matched = point
      } else {
        break
      }
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
      reasons: ['Pas assez de données pour confirmer un setup.'],
      metrics: {
        priceVsVwapPct: 0,
        cvdDelta: 0,
        oiDeltaPct: 0,
        fundingRate: args.funding?.rate ?? 0,
      },
    }
  }

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100
  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiDeltaPct =
    prevOi.openInterest !== 0
      ? ((lastOi.openInterest - prevOi.openInterest) / prevOi.openInterest) * 100
      : 0
  const fundingRate = args.funding?.rate ?? 0

  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap
  const cvdBullish = cvdDelta > 0 && lastCvd.delta > 0
  const cvdBearish = cvdDelta < 0 && lastCvd.delta < 0
  const oiRising = oiDeltaPct > 0.01
  const oiFalling = oiDeltaPct < -0.01
  const fundingTooHotLong = fundingRate > 0.0008
  const fundingTooHotShort = fundingRate < -0.0008

  let action: SignalPayload['action'] = 'STABLE'
  let confidence = 1
  const reasons: string[] = []

  if (aboveVwap && cvdBullish && oiRising && !fundingTooHotLong) {
    action = 'BUY'
    confidence = 4
    reasons.push('Prix au-dessus de la VWAP.')
    reasons.push('CVD en hausse avec delta positif.')
    reasons.push("Open interest en hausse : participation qui s'ajoute.")
    reasons.push('Funding pas trop extrême côté long.')
  } else if (belowVwap && cvdBearish && oiRising && !fundingTooHotShort) {
    action = 'SELL'
    confidence = 4
    reasons.push('Prix sous la VWAP.')
    reasons.push('CVD en baisse avec delta négatif.')
    reasons.push("Open interest en hausse : nouvelles positions vendeuses probables.")
    reasons.push('Funding pas trop extrême côté short.')
  } else {
    action = 'STABLE'
    confidence = 2

    if (aboveVwap) reasons.push('Prix au-dessus de la VWAP, mais sans vraie confluence.')
    if (belowVwap) reasons.push('Prix sous la VWAP, mais sans vraie confluence.')
    if (oiFalling) reasons.push("Open interest en baisse : plutôt de la fermeture que de l'initiative.")
    if (!cvdBullish && !cvdBearish) reasons.push('CVD neutre ou peu lisible.')
    if (fundingTooHotLong || fundingTooHotShort) reasons.push('Funding extrême : prudence.')
    if (!reasons.length) reasons.push('Marché mixte, pas de setup propre.')
  }

  return {
    action,
    confidence,
    reasons,
    metrics: {
      priceVsVwapPct,
      cvdDelta,
      oiDeltaPct,
      fundingRate,
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

    return NextResponse.json({
      klines,
      vwap,
      cvd,
      oi,
      ticker,
      funding,
      setupHistory: [],
      signal,
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
        signal: {
          action: 'STABLE',
          confidence: 1,
          reasons: ['Erreur de chargement des données.'],
          metrics: {
            priceVsVwapPct: 0,
            cvdDelta: 0,
            oiDeltaPct: 0,
            fundingRate: 0,
          },
        },
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
