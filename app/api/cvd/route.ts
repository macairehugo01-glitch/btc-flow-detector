import { NextRequest, NextResponse } from 'next/server'
import {
  fetchKlines,
  fetchAggTrades,
  fetchCurrentOI,
  fetchOIHistory,
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
  isInCooldown,
  openPosition,
  reversePosition,
} from '../../../store'
import {
  loadOIBuffer,
  saveOIBuffer,
  loadSweepState,
  saveSweepState,
  type SweepState,
} from '../../../journalPersistence'

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
  sweepAge?: number // minutes depuis le sweep
  metrics: {
    priceVsVwapPct: number
    cvdDelta: number
    oiDeltaPct: number
    fundingRate: number
    oiChangeAbs: number
    distanceFromVwapPct: number
  }
}

// ─── OI BUFFER ───────────────────────────────────────────────────────────────
const MAX_OI_POINTS = 500
let oiSessionBuffer: OIBar[] = loadOIBuffer()
let oiHistoryLoaded = false

async function initOIBufferIfNeeded() {
  if (oiHistoryLoaded) return
  oiHistoryLoaded = true
  if (oiSessionBuffer.length >= 10) return
  try {
    const history = await fetchOIHistory('5min', 200)
    if (history.length > 1) {
      const existing = new Set(oiSessionBuffer.map((p) => p.time))
      for (const point of history) {
        if (!existing.has(point.time)) oiSessionBuffer.push(point)
      }
      oiSessionBuffer.sort((a, b) => a.time - b.time)
      while (oiSessionBuffer.length > MAX_OI_POINTS) oiSessionBuffer.shift()
      saveOIBuffer(oiSessionBuffer)
    }
  } catch (err) {
    console.error('[OI] Failed to load history:', err)
  }
}

function pushOiSnapshot(snapshot: OIBar) {
  const last = oiSessionBuffer.at(-1)
  if (!last) { oiSessionBuffer.push(snapshot); saveOIBuffer(oiSessionBuffer); return }
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

// ─── SWEEP STATE (persisté 6h) ────────────────────────────────────────────────
let currentSweep: SweepState = loadSweepState()
const SWEEP_TTL_MS = 6 * 60 * 60 * 1000

function isSweepValid(): boolean {
  if (!currentSweep) return false
  if (Date.now() - currentSweep.detectedAt > SWEEP_TTL_MS) {
    currentSweep = null
    saveSweepState(null)
    return false
  }
  return true
}

// ─── WEEKEND ─────────────────────────────────────────────────────────────────
function isWeekend(): boolean {
  const day = new Date().getUTCDay()
  return day === 0 || day === 6
}

// ─── VOLATILITY & REGIME ─────────────────────────────────────────────────────
function getVolatilityBucket(
  klines: Array<{ high: number; low: number; close: number }>
): 'low' | 'medium' | 'high' {
  const sample = klines.slice(-10)
  if (!sample.length) return 'medium'
  const avgRangePct =
    sample.reduce((sum, k) => sum + ((k.high - k.low) / k.close) * 100, 0) / sample.length
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

// ─── HTF BIAS ────────────────────────────────────────────────────────────────
function getHTFBias(
  klines: Array<{ close: number }>,
  vwap: Array<{ vwap: number }>
): 'bullish' | 'bearish' | 'neutral' {
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

// ─── PHASE 1 : DÉTECTION SWEEP (L + F) ───────────────────────────────────────

function getAvgVolume(
  klines: Array<{ volume: number }>,
  sweepIndex: number
): number {
  const lookback = klines.slice(Math.max(0, sweepIndex - 20), sweepIndex)
  if (lookback.length < 5) return 0
  return lookback.reduce((s, k) => s + k.volume, 0) / lookback.length
}

function hasSweepWickQuality(
  candle: { open: number; high: number; low: number; close: number },
  direction: 'high' | 'low',
  volumeMultiplier: number = 1 // ratio volume/moyenne pour adapter le seuil wick
): boolean {
  const totalSize = candle.high - candle.low
  if (totalSize === 0) return false

  // Seuil wick adaptatif :
  // - Volume normal (1-3x) → seuil strict 60%
  // - Volume extrême (>3x) → seuil assoupli 30% car le volume lui-même confirme l'événement
  const wickThreshold = volumeMultiplier >= 3 ? 0.3 : 0.6

  if (direction === 'high') {
    const upperWick = candle.high - Math.max(candle.open, candle.close)
    return upperWick / totalSize > wickThreshold
  } else {
    const lowerWick = Math.min(candle.open, candle.close) - candle.low
    return lowerWick / totalSize > wickThreshold
  }
}

function hasSweepVolume(
  klines: Array<{ volume: number }>,
  sweepIndex: number
): boolean {
  const avg = getAvgVolume(klines, sweepIndex)
  if (avg === 0) return true
  return klines[sweepIndex].volume > avg * 1.5
}

/**
 * PHASE 1 : Scanne les 50 dernières bougies pour détecter un nouveau sweep.
 * Si un sweep plus récent est trouvé, il remplace l'ancien.
 */
function detectAndUpdateSweep(
  klines: Array<{ time: number; high: number; low: number; close: number; open: number; volume: number }>,
  oi: OIBar[],
  cvd: Array<{ cvd: number }>
): void {
  // Structure = les 40 bougies AVANT la fenêtre de scan
  // Scan = les 10 dernières bougies fermées
  // Séparation stricte pour éviter que la bougie sweep soit dans sa propre structure
  const allClosed = klines.slice(0, -1) // toutes les bougies fermées
  if (allClosed.length < 20) return

  // Scanner toutes les bougies disponibles en cherchant le sweep le plus récent
  // Le TTL de 6h sur disque assure que les vieux sweeps expirent
  // On exclut les 5 premières bougies pour avoir une structure de référence
  if (allClosed.length < 10) return

  for (let i = allClosed.length - 1; i >= 5; i--) {
    const candle = allClosed[i]
    const candleIndex = i // index direct dans allClosed = klines sans la courante

    // Structure = les bougies AVANT cette bougie (au moins 5)
    const structureKlines = allClosed.slice(Math.max(0, i - 80), i)
    if (structureKlines.length < 5) continue

    const structureHigh = Math.max(...structureKlines.map((k) => k.high))
    const structureLow = Math.min(...structureKlines.map((k) => k.low))

    // Sweep haussier (piège → signal SELL futur)
    const isHighSweep = candle.high > structureHigh && candle.close < structureHigh
    const avgVolHigh = getAvgVolume(klines, candleIndex)
    const volMultHigh = avgVolHigh > 0 ? klines[candleIndex].volume / avgVolHigh : 1
    if (isHighSweep && hasSweepWickQuality(candle, 'high', volMultHigh) && hasSweepVolume(klines, candleIndex)) {
      // Ignorer les sweeps trop vieux (> TTL)
      if (Date.now() - candle.time * 1000 > SWEEP_TTL_MS) { continue }
      // Vérifier que ce sweep est plus récent que l'actuel
      if (!currentSweep || candle.time * 1000 > currentSweep.detectedAt) {
        const oiAtSweep = oi.find(o => o.time <= candle.time)?.openInterest ?? 0
        const cvdAtSweep = cvd[Math.min(candleIndex, cvd.length - 1)]?.cvd ?? 0
        currentSweep = {
          direction: 'high',
          detectedAt: candle.time * 1000,
          structureLevel: structureHigh,
          sweepHigh: candle.high,
          sweepLow: candle.low,
          oiAtSweep,
          cvdAtSweep,
        }
        saveSweepState(currentSweep)
        console.log('[SWEEP] Nouveau sweep HIGH détecté à', new Date(currentSweep.detectedAt).toISOString())
      }
      break
    }

    // Sweep baissier (piège → signal BUY futur)
    const isLowSweep = candle.low < structureLow && candle.close > structureLow
    const avgVolLow = getAvgVolume(klines, candleIndex)
    const volMultLow = avgVolLow > 0 ? klines[candleIndex].volume / avgVolLow : 1
    if (isLowSweep && hasSweepWickQuality(candle, 'low', volMultLow) && hasSweepVolume(klines, candleIndex)) {
      // Ignorer les sweeps trop vieux (> TTL)
      if (Date.now() - candle.time * 1000 > SWEEP_TTL_MS) { continue }
      if (!currentSweep || candle.time * 1000 > currentSweep.detectedAt) {
        const oiAtSweep = oi.find(o => o.time <= candle.time)?.openInterest ?? 0
        const cvdAtSweep = cvd[Math.min(candleIndex, cvd.length - 1)]?.cvd ?? 0
        currentSweep = {
          direction: 'low',
          detectedAt: candle.time * 1000,
          structureLevel: structureLow,
          sweepHigh: candle.high,
          sweepLow: candle.low,
          oiAtSweep,
          cvdAtSweep,
        }
        saveSweepState(currentSweep)
        console.log('[SWEEP] Nouveau sweep LOW détecté à', new Date(currentSweep.detectedAt).toISOString())
      }
      break
    }
  }
}

// ─── PHASE 2 : CONFIRMATION (R) + ENTRÉE ─────────────────────────────────────

function oiStagningOrFalling(oi: OIBar[], lookbackBars = 5): boolean {
  if (oi.length < lookbackBars + 1) return false
  const recent = oi.slice(-(lookbackBars + 1))
  const changePct = ((recent[recent.length - 1].openInterest - recent[0].openInterest) / recent[0].openInterest) * 100
  return changePct <= 0.01
}

function hasOILiquidationDrop(oi: OIBar[]): boolean {
  if (oi.length < 3) return false
  const recent = oi.slice(-3)
  const changePct = ((recent[2].openInterest - recent[0].openInterest) / recent[0].openInterest) * 100
  return changePct < -0.1
}

function detectVwapReject(klines: Array<{ close: number }>, vwap: Array<{ vwap: number }>): boolean {
  const lastK = klines.at(-1); const prevK = klines.at(-2)
  const lastV = vwap.at(-1); const prevV = vwap.at(-2)
  if (!lastK || !prevK || !lastV || !prevV) return false
  return prevK.close > prevV.vwap && lastK.close < lastV.vwap
}

function detectVwapReclaim(klines: Array<{ close: number }>, vwap: Array<{ vwap: number }>): boolean {
  const lastK = klines.at(-1); const prevK = klines.at(-2)
  const lastV = vwap.at(-1); const prevV = vwap.at(-2)
  if (!lastK || !prevK || !lastV || !prevV) return false
  return prevK.close < prevV.vwap && lastK.close > lastV.vwap
}

function detectLH(klines: Array<{ high: number }>): boolean {
  const last = klines.at(-1); const prev = klines.at(-3)
  if (!last || !prev) return false
  return last.high < prev.high
}

function detectHL(klines: Array<{ low: number }>): boolean {
  const last = klines.at(-1); const prev = klines.at(-3)
  if (!last || !prev) return false
  return last.low > prev.low
}

function isFundingBlocked(fundingRate: number, action: 'BUY' | 'SELL'): boolean {
  if (action === 'BUY' && fundingRate > 0.0005) return true
  if (action === 'SELL' && fundingRate < -0.0005) return true
  return false
}

function isVwapDistanceValid(distancePct: number): boolean {
  return distancePct <= 0.3
}

// ─── COMPUTE SIGNAL (3 phases) ────────────────────────────────────────────────

function computeSignal(args: {
  klines: Array<{ open: number; high: number; low: number; close: number; volume: number }>
  vwap: Array<{ vwap: number }>
  cvd: Array<{ delta: number; cvd: number }>
  oi: OIBar[]
  funding: { rate: number } | null
}): SignalPayload {
  const lastK = args.klines.at(-1)
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

  if (!lastK || !lastV || !lastCvd || !prevCvd || !lastOi) return stable

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100
  const distanceFromVwapPct = Math.abs(priceVsVwapPct)
  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const oiChangeAbs = args.oi.length > 1 ? lastOi.openInterest - args.oi[args.oi.length - 2].openInterest : 0
  const oiDeltaPct = args.oi.length > 1 && args.oi[args.oi.length - 2].openInterest !== 0
    ? (oiChangeAbs / args.oi[args.oi.length - 2].openInterest) * 100 : 0

  const metrics = { priceVsVwapPct, cvdDelta, oiDeltaPct, fundingRate, oiChangeAbs, distanceFromVwapPct }
  const htfBias = getHTFBias(args.klines, args.vwap)
  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap
  const vwapReject = detectVwapReject(args.klines, args.vwap)
  const vwapReclaim = detectVwapReclaim(args.klines, args.vwap)
  const oiDone = oiStagningOrFalling(args.oi, 5)
  const oiLiquidated = hasOILiquidationDrop(args.oi)
  const lhStructure = detectLH(args.klines)
  const hlStructure = detectHL(args.klines)
  const cvdNonStable = Math.abs(cvdDelta) > 0

  // ── PHASE 2 : Si sweep valide en mémoire → scorer la confirmation (R) ──
  if (isSweepValid() && currentSweep) {
    const sweepAgeMin = (Date.now() - currentSweep.detectedAt) / 1000 / 60

    // ── SETUP SHORT : sweep HIGH mémorisé ──
    if (currentSweep.direction === 'high' && htfBias !== 'bullish') {
      let score = 0
      const reasons: string[] = []

      // L (1pt) : sweep détecté et mémorisé
      score += 1
      reasons.push(`L: Sweep HIGH mémorisé (il y a ${sweepAgeMin.toFixed(0)} min).`)

      // F (1pt) : OI expansion PENDANT le sweep (nouvelles positions = piège institutionnel)
      const oiBeforeSweep = oiSessionBuffer.find(o => o.time < (currentSweep!.detectedAt / 1000) - 300)?.openInterest ?? 0
      const oiExpandedDuringSweep = oiBeforeSweep > 0 && currentSweep.oiAtSweep > oiBeforeSweep * 1.0002
      if (oiExpandedDuringSweep) {
        score += 1
        reasons.push('F: OI ↑ pendant le sweep (piège institutionnel confirmé).')
      }

      // F (1pt) : CVD non-stable (agression détectée)
      if (cvdNonStable) {
        score += 1
        reasons.push(lastCvd.delta < 0 ? 'F: CVD baissier (vendeurs agressifs).' : 'F: CVD non-stable (agression détectée).')
      }

      // R (1pt) : rejet VWAP + OI stagne/baisse (divergence flux-prix = shorts débouclent)
      if ((vwapReject || belowVwap) && (oiDone || oiLiquidated)) {
        score += 1
        reasons.push('R: Rejet VWAP + OI stagne/↓ (divergence flux-prix confirmée).')
      }

      // R (1pt) : structure LH confirmée
      if (lhStructure) {
        score += 1
        reasons.push('R: Structure LH confirmée.')
      }

      if (score >= 4) {
        return {
          action: 'SELL', confidence: score,
          signalType: 'bearish_retest',
          marketRegime, volatilityBucket, vwap: lastV.vwap,
          sweepAge: sweepAgeMin, reasons, metrics,
        }
      }

      return {
        action: 'STABLE', confidence: score, signalType: 'neutral',
        marketRegime, volatilityBucket, vwap: lastV.vwap,
        sweepAge: sweepAgeMin,
        reasons: [`Score LFR insuffisant (${score}/5) — sweep HIGH actif depuis ${sweepAgeMin.toFixed(0)} min.`],
        metrics,
      }
    }

    // ── SETUP LONG : sweep LOW mémorisé ──
    if (currentSweep.direction === 'low' && htfBias !== 'bearish') {
      let score = 0
      const reasons: string[] = []

      // L (1pt) : sweep détecté et mémorisé
      score += 1
      reasons.push(`L: Sweep LOW mémorisé (il y a ${sweepAgeMin.toFixed(0)} min).`)

      // F (1pt) : OI expansion PENDANT le sweep (nouvelles positions = short squeeze potentiel)
      const oiBeforeSweepL = oiSessionBuffer.find(o => o.time < (currentSweep!.detectedAt / 1000) - 300)?.openInterest ?? 0
      const oiExpandedDuringSweepL = oiBeforeSweepL > 0 && currentSweep.oiAtSweep > oiBeforeSweepL * 1.0002
      if (oiExpandedDuringSweepL) {
        score += 1
        reasons.push('F: OI ↑ pendant le sweep (short squeeze potentiel confirmé).')
      }

      // F (1pt) : CVD non-stable (agression détectée)
      if (cvdNonStable) {
        score += 1
        reasons.push(lastCvd.delta > 0 ? 'F: CVD haussier (acheteurs agressifs).' : 'F: CVD non-stable (agression détectée).')
      }

      // R (1pt) : reclaim VWAP + OI stagne/baisse (shorts ferment)
      if ((vwapReclaim || aboveVwap) && (oiDone || oiLiquidated)) {
        score += 1
        reasons.push('R: Reclaim VWAP + OI stagne/↓ (shorts ferment, divergence confirmée).')
      }

      // R (1pt) : structure HL confirmée
      if (hlStructure) {
        score += 1
        reasons.push('R: Structure HL confirmée.')
      }

      if (score >= 4) {
        return {
          action: 'BUY', confidence: score,
          signalType: 'bullish_retest',
          marketRegime, volatilityBucket, vwap: lastV.vwap,
          sweepAge: sweepAgeMin, reasons, metrics,
        }
      }

      return {
        action: 'STABLE', confidence: score, signalType: 'neutral',
        marketRegime, volatilityBucket, vwap: lastV.vwap,
        sweepAge: sweepAgeMin,
        reasons: [`Score LFR insuffisant (${score}/5) — sweep LOW actif depuis ${sweepAgeMin.toFixed(0)} min.`],
        metrics,
      }
    }
  }

  return {
    action: 'STABLE', confidence: 1, signalType: 'neutral',
    marketRegime, volatilityBucket, vwap: currentVwap,
    reasons: ['Aucun sweep actif en mémoire.'],
    metrics,
  }
}

function isValidSignalType(signalType: SignalPayload['signalType']) {
  return ['bullish_retest', 'bearish_retest'].includes(signalType)
}

export async function GET(req: NextRequest) {
  const timeframe = (req.nextUrl.searchParams.get('timeframe') ?? '5m') as Timeframe
  const safeTimeframe: Timeframe = ['1m', '5m', '15m', '1h'].includes(timeframe) ? timeframe : '5m'

  try {
    await initOIBufferIfNeeded()

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

    // PHASE 1 : détecter et mémoriser les sweeps récents
    detectAndUpdateSweep(klines, oi, cvd)

    // PHASE 2 : scorer la confirmation
    const signal = computeSignal({ klines, vwap, cvd, oi, funding })

    const currentPosition = getCurrentPosition()
    const lastReverseBarKey = getLastReverseBarKey()
    const lastK = klines.at(-1)
    const prevK = klines.at(-2)
    const bullishStructureBreak = !!lastK && !!prevK && lastK.close > prevK.high
    const bearishStructureBreak = !!lastK && !!prevK && lastK.close < prevK.low
    const referenceBarKey = `${safeTimeframe}-${lastK?.time ?? 0}`

    const weekend = isWeekend()
    const cooldown = isInCooldown(safeTimeframe)
    const fundingBlocked = signal.action !== 'STABLE'
      ? isFundingBlocked(signal.metrics.fundingRate, signal.action as 'BUY' | 'SELL')
      : false
    const vwapDistanceOk = isVwapDistanceValid(signal.metrics.distanceFromVwapPct)

    const canTrade = !weekend && !cooldown && !fundingBlocked && vwapDistanceOk && signal.action !== 'STABLE'

    if (canTrade && ticker) {
      if (!currentPosition) {
        if (signal.confidence >= 4 && !hasRecentDuplicate(signal.action as 'BUY' | 'SELL', safeTimeframe, Date.now())) {
          console.log('[TRADE] openPosition:', signal.action, ticker.price)
          await openPosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action as 'BUY' | 'SELL',
            confidence: signal.confidence,
            entryPrice: ticker.price,
            vwap: signal.vwap,
            referenceBarKey,
            signalType: signal.signalType,
            marketRegime: signal.marketRegime,
            vwapDistancePct: signal.metrics.distanceFromVwapPct,
            volatilityBucket: signal.volatilityBucket,
          })
          // Reset sweep après entrée
          currentSweep = null
          saveSweepState(null)
        }
      } else if (currentPosition.action !== signal.action) {
        const structureOk = signal.action === 'BUY' ? bullishStructureBreak : bearishStructureBreak
        const canReverse =
          signal.confidence >= 5 &&
          signal.confidence > currentPosition.confidence &&
          structureOk &&
          isValidSignalType(signal.signalType) &&
          lastReverseBarKey !== referenceBarKey

        if (canReverse) {
          console.log('[TRADE] reversePosition:', signal.action, ticker.price)
          await reversePosition({
            timestamp: Date.now(),
            timeframe: safeTimeframe,
            action: signal.action as 'BUY' | 'SELL',
            confidence: signal.confidence,
            entryPrice: ticker.price,
            vwap: signal.vwap,
            referenceBarKey,
            signalType: signal.signalType,
            marketRegime: signal.marketRegime,
            vwapDistancePct: signal.metrics.distanceFromVwapPct,
            volatilityBucket: signal.volatilityBucket,
          })
          currentSweep = null
          saveSweepState(null)
        }
      }
    }

    return NextResponse.json({
      klines, vwap, cvd, oi, ticker, funding, signal,
      weekend, cooldown, fundingBlocked, vwapDistanceOk,
      oiBufferSize: oiSessionBuffer.length,
      activeSweep: currentSweep ? {
        direction: currentSweep.direction,
        ageMinutes: Math.round((Date.now() - currentSweep.detectedAt) / 1000 / 60),
        structureLevel: currentSweep.structureLevel,
      } : null,
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
        weekend: isWeekend(), cooldown: false, fundingBlocked: false, vwapDistanceOk: true,
        oiBufferSize: oiSessionBuffer.length,
        activeSweep: null,
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
