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
import { loadOIBuffer, saveOIBuffer } from '../../../journalPersistence'

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
  vwap: number
  metrics: {
    priceVsVwapPct: number
    cvdDelta: number
    oiDeltaPct: number
    fundingRate: number
    oiChangeAbs: number
    distanceFromVwapPct: number
  }
}

// ─── OI BUFFER persisté sur disque ──────────────────────────────────────────
const MAX_OI_POINTS = 500
let oiSessionBuffer: OIBar[] = loadOIBuffer()

function pushOiSnapshot(snapshot: OIBar) {
  const last = oiSessionBuffer.at(-1)
  if (!last) {
    oiSessionBuffer.push(snapshot)
    saveOIBuffer(oiSessionBuffer)
    return
  }
  if (snapshot.time !== last.time || snapshot.openInterest !== last.openInterest) {
    oiSessionBuffer.push(snapshot)
    while (oiSessionBuffer.length > MAX_OI_POINTS) oiSessionBuffer.shift()
    saveOIBuffer(oiSessionBuffer)
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
    return { time: k.time, openInterest: matched.openInterest }
  })
}

// ─── WEEKEND FILTER ──────────────────────────────────────────────────────────

/**
 * Pas de trades le weekend (Sam + Dim UTC).
 * BTC trade 24/7 mais la liquidité institutionnelle est absente le weekend
 * → sweeps peu fiables, beaucoup de faux signaux.
 */
function isWeekend(): boolean {
  const day = new Date().getUTCDay()
  return day === 0 || day === 6 // 0 = Dimanche, 6 = Samedi
}

// ─── VOLATILITY & REGIME ─────────────────────────────────────────────────────

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
  const last = closes.at(-1)!
  const prev = closes.at(-2)!
  const prev2 = closes.at(-3)!
  const rangePct = ((maxHigh - minLow) / last) * 100
  if (last > prev && prev > prev2 && rangePct > 1.2) return 'trend'
  if (last < prev && prev < prev2 && rangePct > 1.2) return 'trend'
  if (last > maxHigh * 0.998 || last < minLow * 1.002) return 'breakout'
  if ((last > prev && prev < prev2) || (last < prev && prev > prev2)) return 'reversal'
  return 'range'
}

// ─── HTF BIAS (1h) ───────────────────────────────────────────────────────────

/**
 * Biais HTF basé sur la position du prix vs VWAP 1h.
 * On utilise les klines 5m disponibles pour approximer le biais 1h
 * en regardant les 12 dernières bougies 5m (= 1h).
 */
function getHTFBias(
  klines: Array<{ close: number }>,
  vwap: Array<{ vwap: number }>
): 'bullish' | 'bearish' | 'neutral' {
  // Moyenne des 12 dernières clôtures (= 1h sur 5m)
  const sample = klines.slice(-12)
  const vwapSample = vwap.slice(-12)
  if (sample.length < 6 || vwapSample.length < 6) return 'neutral'

  const avgClose = sample.reduce((s, k) => s + k.close, 0) / sample.length
  const avgVwap = vwapSample.reduce((s, v) => s + v.vwap, 0) / vwapSample.length

  const diff = ((avgClose - avgVwap) / avgVwap) * 100
  if (diff > 0.05) return 'bullish'
  if (diff < -0.05) return 'bearish'
  return 'neutral'
}

// ─── LFR HELPERS ─────────────────────────────────────────────────────────────

/**
 * Qualité du sweep : le wick doit représenter > 60% de la bougie.
 * Filtre les faux sweeps sur petites bougies sans wick significatif.
 */
function hasSweepWickQuality(
  candle: { open: number; high: number; low: number; close: number },
  direction: 'high' | 'low'
): boolean {
  const bodySize = Math.abs(candle.close - candle.open)
  const totalSize = candle.high - candle.low
  if (totalSize === 0) return false

  if (direction === 'high') {
    const upperWick = candle.high - Math.max(candle.open, candle.close)
    return upperWick / totalSize > 0.6
  } else {
    const lowerWick = Math.min(candle.open, candle.close) - candle.low
    return lowerWick / totalSize > 0.6
  }
}

/**
 * Sweep haute confirmé sur bougie FERMÉE avec qualité de wick.
 */
function detectHighSweep(
  klines: Array<{ high: number; low: number; close: number; open: number }>
): boolean {
  const lookback = klines.slice(-52, -2)
  if (lookback.length < 10) return false
  const structureHigh = Math.max(...lookback.map((k) => k.high))
  const lastClosed = klines.at(-2)!
  const swept = lastClosed.high > structureHigh && lastClosed.close < structureHigh
  if (!swept) return false
  return hasSweepWickQuality(lastClosed, 'high')
}

/**
 * Sweep basse confirmé sur bougie FERMÉE avec qualité de wick.
 */
function detectLowSweep(
  klines: Array<{ high: number; low: number; close: number; open: number }>
): boolean {
  const lookback = klines.slice(-52, -2)
  if (lookback.length < 10) return false
  const structureLow = Math.min(...lookback.map((k) => k.low))
  const lastClosed = klines.at(-2)!
  const swept = lastClosed.low < structureLow && lastClosed.close > structureLow
  if (!swept) return false
  return hasSweepWickQuality(lastClosed, 'low')
}

/**
 * Volume du sweep anormalement élevé (> 1.5x la moyenne des 20 dernières bougies).
 * Signature des liquidations de stops institutionnels.
 */
function hasSweepVolume(
  klines: Array<{ volume: number }>
): boolean {
  const sample = klines.slice(-22, -2)
  if (sample.length < 10) return true // pas assez de données → on ne bloque pas
  const avgVolume = sample.reduce((s, k) => s + k.volume, 0) / sample.length
  const sweepCandle = klines.at(-2)!
  return sweepCandle.volume > avgVolume * 1.5
}

/**
 * Chute rapide d'OI = liquidations massives de stops.
 * OI baisse de > 0.1% sur 2 bougies.
 */
function hasOILiquidationDrop(oi: OIBar[]): boolean {
  if (oi.length < 3) return false
  const recent = oi.slice(-3)
  const oiStart = recent[0].openInterest
  const oiEnd = recent[recent.length - 1].openInterest
  const changePct = ((oiEnd - oiStart) / oiStart) * 100
  return changePct < -0.1
}

function oiStagningOrFalling(oi: OIBar[], lookbackBars = 5): boolean {
  if (oi.length < lookbackBars + 1) return false
  const recent = oi.slice(-(lookbackBars + 1))
  const oiStart = recent[0].openInterest
  const oiEnd = recent[recent.length - 1].openInterest
  const changePct = ((oiEnd - oiStart) / oiStart) * 100
  return changePct <= 0.01
}

function detectVwapReclaim(
  klines: Array<{ close: number }>,
  vwap: Array<{ vwap: number }>
): boolean {
  const lastK = klines.at(-1)
  const prevK = klines.at(-2)
  const lastV = vwap.at(-1)
  const prevV = vwap.at(-2)
  if (!lastK || !prevK || !lastV || !prevV) return false
  return prevK.close < prevV.vwap && lastK.close > lastV.vwap
}

function detectVwapReject(
  klines: Array<{ close: number }>,
  vwap: Array<{ vwap: number }>
): boolean {
  const lastK = klines.at(-1)
  const prevK = klines.at(-2)
  const lastV = vwap.at(-1)
  const prevV = vwap.at(-2)
  if (!lastK || !prevK || !lastV || !prevV) return false
  return prevK.close > prevV.vwap && lastK.close < lastV.vwap
}

function detectHL(klines: Array<{ low: number }>): boolean {
  const last = klines.at(-1)
  const prev = klines.at(-3)
  if (!last || !prev) return false
  return last.low > prev.low
}

function detectLH(klines: Array<{ high: number }>): boolean {
  const last = klines.at(-1)
  const prev = klines.at(-3)
  if (!last || !prev) return false
  return last.high < prev.high
}

// ─── SCORE LFR 0–5 ───────────────────────────────────────────────────────────

function computeSignal(args: {
  klines: Array<{ open: number; high: number; low: number; close: number; volume: number }>
  vwap: Array<{ vwap: number }>
  cvd: Array<{ delta: number; cvd: number }>
  oi: OIBar[]
  funding: { rate: number } | null
}): SignalPayload {
  const lastK = args.klines.at(-1)
  const prevK = args.klines.at(-2)
  const lastV = args.vwap.at(-1)
  const lastCvd = args.cvd.at(-1)
  const prevCvd = args.cvd.at(-2)
  const lastOi = args.oi.at(-1)

  const marketRegime = getMarketRegime(args.klines)
  const volatilityBucket = getVolatilityBucket(args.klines)
  const fundingRate = args.funding?.rate ?? 0
  const currentVwap = lastV?.vwap ?? 0

  const stable: SignalPayload = {
    action: 'STABLE', confidence: 1, signalType: 'neutral',
    marketRegime, volatilityBucket, vwap: currentVwap,
    reasons: ['Pas assez de données.'],
    metrics: { priceVsVwapPct: 0, cvdDelta: 0, oiDeltaPct: 0, fundingRate, oiChangeAbs: 0, distanceFromVwapPct: 0 },
  }

  if (!lastK || !prevK || !lastV || !lastCvd || !prevCvd || !lastOi) return stable

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100
  const distanceFromVwapPct = Math.abs(priceVsVwapPct)
  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiChangeAbs = args.oi.length > 1
    ? lastOi.openInterest - args.oi[args.oi.length - 2].openInterest : 0
  const oiDeltaPct = args.oi.length > 1 && args.oi[args.oi.length - 2].openInterest !== 0
    ? (oiChangeAbs / args.oi[args.oi.length - 2].openInterest) * 100 : 0

  const metrics = { priceVsVwapPct, cvdDelta, oiDeltaPct, fundingRate, oiChangeAbs, distanceFromVwapPct }

  const htfBias = getHTFBias(args.klines, args.vwap)
  const highSweep = detectHighSweep(args.klines)
  const lowSweep = detectLowSweep(args.klines)
  const sweepVolumeOk = hasSweepVolume(args.klines)
  const oiLiquidated = hasOILiquidationDrop(args.oi)
  const oiDone = oiStagningOrFalling(args.oi, 5)
  const vwapReclaim = detectVwapReclaim(args.klines, args.vwap)
  const vwapReject = detectVwapReject(args.klines, args.vwap)
  const hlStructure = detectHL(args.klines)
  const lhStructure = detectLH(args.klines)
  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap
  const cvdNonStable = Math.abs(cvdDelta) > 0

  // ── SETUP A+ SHORT ──
  // Filtré si biais HTF haussier (on évite de shorter un trend long)
  if (htfBias !== 'bullish') {
    let score = 0
    const reasons: string[] = []

    if (highSweep)                          { score += 1; reasons.push('L: Sweep liquidité haute (bougie fermée, wick >60%).') }
    if (sweepVolumeOk)                      { score += 1; reasons.push('F: Volume sweep > 1.5x moyenne (liquidations stops).') }
    if (oiLiquidated || cvdNonStable && lastCvd.delta > 0) {
      score += 1
      reasons.push(oiLiquidated
        ? 'F: Chute OI rapide = liquidations massives détectées.'
        : 'F: CVD agressif haussier (piège institutionnel).')
    }
    if (vwapReject || belowVwap)            { score += 1; reasons.push('R: Rejet / retour sous VWAP confirmé.') }
    if (oiDone && lhStructure)              { score += 1; reasons.push('R: OI stagne + structure LH (divergence flux-prix).') }

    if (score >= 4) {
      return {
        action: 'SELL', confidence: score,
        signalType: 'bearish_retest',
        marketRegime, volatilityBucket, vwap: lastV.vwap, reasons, metrics,
      }
    }
  }

  // ── SETUP A+ LONG ──
  // Filtré si biais HTF baissier
  if (htfBias !== 'bearish') {
    let score = 0
    const reasons: string[] = []

    if (lowSweep)                           { score += 1; reasons.push('L: Sweep liquidité basse (bougie fermée, wick >60%).') }
    if (sweepVolumeOk)                      { score += 1; reasons.push('F: Volume sweep > 1.5x moyenne (liquidations stops).') }
    if (oiLiquidated || cvdNonStable && lastCvd.delta < 0) {
      score += 1
      reasons.push(oiLiquidated
        ? 'F: Chute OI rapide = liquidations massives détectées.'
        : 'F: CVD agressif baissier (short squeeze potentiel).')
    }
    if (vwapReclaim || aboveVwap)           { score += 1; reasons.push('R: Reclaim VWAP confirmé.') }
    if (oiDone && hlStructure)              { score += 1; reasons.push('R: OI stagne + structure HL (shorts ferment).') }

    if (score >= 4) {
      return {
        action: 'BUY', confidence: score,
        signalType: 'bullish_retest',
        marketRegime, volatilityBucket, vwap: lastV.vwap, reasons, metrics,
      }
    }
  }

  return {
    action: 'STABLE', confidence: 1, signalType: 'neutral',
    marketRegime, volatilityBucket, vwap: currentVwap,
    reasons: ['Score LFR insuffisant (< 4/5).'],
    metrics,
  }
}

function isValidSignalType(signalType: SignalPayload['signalType']) {
  return ['bullish_retest', 'bearish_retest'].includes(signalType)
}

export async function GET(req: NextRequest) {
  const timeframe = (req.nextUrl.searchParams.get('timeframe') ?? '5m') as Timeframe
  const safeTimeframe: Timeframe = ['1m', '5m', '15m', '1h'].includes(timeframe)
    ? timeframe
    : '5m'

  try {
    const [klines, trades, oiSnapshot, ticker, funding] = await Promise.all([
      fetchKlines(safeTimeframe, 200),
      fetchAggTrades(500),
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

    const bullishStructureBreak = !!lastK && !!prevK && lastK.close > prevK.high
    const bearishStructureBreak = !!lastK && !!prevK && lastK.close < prevK.low

    const referenceBarKey = `${safeTimeframe}-${lastK?.time ?? 0}`

    // ── FILTRE WEEKEND ──
    const weekend = isWeekend()

    if (!weekend && ticker && (signal.action === 'BUY' || signal.action === 'SELL')) {
      if (!currentPosition) {
        if (
          signal.confidence >= 4 &&
          !hasRecentDuplicate(signal.action, safeTimeframe, Date.now())
        ) {
          console.log('[TRADE] openPosition appelé:', signal.action, ticker.price)
          await openPosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action,
            confidence: signal.confidence,
            entryPrice: ticker.price,
            vwap: signal.vwap,
            referenceBarKey,
            signalType: signal.signalType,
            marketRegime: signal.marketRegime,
            vwapDistancePct: signal.metrics.distanceFromVwapPct,
            volatilityBucket: signal.volatilityBucket,
          })
        }
      } else if (currentPosition.action !== signal.action) {
        const structureOk =
          signal.action === 'BUY' ? bullishStructureBreak : bearishStructureBreak

        const canReverse =
          signal.confidence >= 5 &&
          signal.confidence > currentPosition.confidence &&
          structureOk &&
          isValidSignalType(signal.signalType) &&
          lastReverseBarKey !== referenceBarKey

        if (canReverse) {
          console.log('[TRADE] reversePosition appelé:', signal.action, ticker.price)
          await reversePosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action,
            confidence: signal.confidence,
            entryPrice: ticker.price,
            vwap: signal.vwap,
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
      weekend,
      currentPosition: getCurrentPosition(),
      setupHistory: getRecentSetups(),
      setupStats: getStats(),
      sessionStats: getSessionStats(),
      lastUpdate: Date.now(),
      timeframe: safeTimeframe,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown API route error'
    return NextResponse.json(
      {
        error: message,
        klines: [], vwap: [], cvd: [], oi: [],
        ticker: null, funding: null, signal: null,
        weekend: isWeekend(),
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
