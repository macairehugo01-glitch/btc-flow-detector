import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import {
  fetchKlines,
  fetchCurrentOI,
  fetchOIHistory,
  fetchTicker,
  fetchFundingRate,
} from '../../../binance'
import { calculateVWAP, calculateCVD } from '../../../indicators'
import {
  evaluateOpenSetups,
  getRecentSetups,
  getStats,
  getSlotStats,
  getSessionStats,
  getCurrentPosition,
  getAllPositions,
  hasRecentDuplicate,
  isInCooldown,
  openPosition,
  closePosition,
  type SlotKey,
} from '../../../store'
import {
  loadOIBuffer,
  saveOIBuffer,
  loadSweepState,
  saveSweepState,
  type SweepState,
} from '../../../journalPersistence'

export const dynamic = 'force-dynamic'

// ─── CONFIG DES 4 SLOTS ───────────────────────────────────────────────────────

type SlotConfig = {
  slot: SlotKey
  symbol: string
  timeframe: '1h' | '15m'
  bybitInterval: string
  oiInterval: string
  vwapDistanceMax: number  // 0.3% validé par backtest
}

const SLOT_CONFIGS: SlotConfig[] = [
  { slot: 'BTC-1h',  symbol: 'BTCUSDT', timeframe: '1h',  bybitInterval: '60', oiInterval: '1h',    vwapDistanceMax: 0.3 },
  { slot: 'ETH-1h',  symbol: 'ETHUSDT', timeframe: '1h',  bybitInterval: '60', oiInterval: '1h',    vwapDistanceMax: 0.3 },
  { slot: 'BTC-15m', symbol: 'BTCUSDT', timeframe: '15m', bybitInterval: '15', oiInterval: '15min', vwapDistanceMax: 0.5 },
  { slot: 'ETH-15m', symbol: 'ETHUSDT', timeframe: '15m', bybitInterval: '15', oiInterval: '15min', vwapDistanceMax: 0.5 },
]

// ─── OI BUFFERS (un par slot) ─────────────────────────────────────────────────

type OIBar = { time: number; openInterest: number }

const MAX_OI_POINTS = 500
const oiBuffers: Record<SlotKey, OIBar[]> = {
  'BTC-1h':  loadOIBuffer('BTC-1h'),
  'ETH-1h':  loadOIBuffer('ETH-1h'),
  'BTC-15m': loadOIBuffer('BTC-15m'),
  'ETH-15m': loadOIBuffer('ETH-15m'),
}
const oiHistoryLoaded: Record<SlotKey, boolean> = {
  'BTC-1h': false, 'ETH-1h': false, 'BTC-15m': false, 'ETH-15m': false,
}

// ─── SWEEP STATES (un par slot) ───────────────────────────────────────────────

const sweepStates: Record<SlotKey, SweepState> = {
  'BTC-1h':  loadSweepState('BTC-1h'),
  'ETH-1h':  loadSweepState('ETH-1h'),
  'BTC-15m': loadSweepState('BTC-15m'),
  'ETH-15m': loadSweepState('ETH-15m'),
}

const SWEEP_TTL_MS = 2 * 60 * 60 * 1000 // 2h — validé par backtest (fresh = 0-2 bougies 1h)

function isSweepValid(slot: SlotKey): boolean {
  const sweep = sweepStates[slot]
  if (!sweep) return false
  if (Date.now() - sweep.detectedAt > SWEEP_TTL_MS) {
    sweepStates[slot] = null
    saveSweepState(null, slot)
    return false
  }
  return true
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isWeekend(): boolean {
  const day = new Date().getUTCDay()
  return day === 0 || day === 6
}

function getVolatilityBucket(klines: Array<{ high: number; low: number; close: number }>) {
  const sample = klines.slice(-10)
  if (!sample.length) return 'medium'
  const avgRangePct = sample.reduce((sum, k) => sum + ((k.high - k.low) / k.close) * 100, 0) / sample.length
  if (avgRangePct < 0.35) return 'low'
  if (avgRangePct < 1) return 'medium'
  return 'high'
}

function getMarketRegime(klines: Array<{ high: number; low: number; close: number }>) {
  const sample = klines.slice(-12)
  if (sample.length < 4) return 'range'
  const highs = sample.map(k => k.high)
  const lows = sample.map(k => k.low)
  const closes = sample.map(k => k.close)
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

function getAvgVolume(klines: Array<{ volume: number }>, idx: number): number {
  const lookback = klines.slice(Math.max(0, idx - 20), idx)
  if (lookback.length < 5) return 0
  return lookback.reduce((s, k) => s + k.volume, 0) / lookback.length
}

function pushOiSnapshot(slot: SlotKey, snapshot: OIBar) {
  const buf = oiBuffers[slot]
  const last = buf.at(-1)
  if (!last || snapshot.time !== last.time || snapshot.openInterest !== last.openInterest) {
    buf.push(snapshot)
    while (buf.length > MAX_OI_POINTS) buf.shift()
    saveOIBuffer(buf, slot)
  }
}

function buildOiSeriesForKlines(slot: SlotKey, klines: Array<{ time: number }>): OIBar[] {
  const buf = oiBuffers[slot]
  if (!klines.length || !buf.length) return []
  return klines.map(k => {
    let matched = buf[0]
    for (const point of buf) {
      if (point.time <= k.time) matched = point
      else break
    }
    return { time: k.time, openInterest: matched.openInterest }
  })
}

async function initOIBuffer(slot: SlotKey, oiInterval: string) {
  if (oiHistoryLoaded[slot] && oiBuffers[slot].length >= 10) return
  oiHistoryLoaded[slot] = true
  try {
    const history = await fetchOIHistory(oiInterval, 200)
    if (history.length > 1) {
      const existing = new Set(oiBuffers[slot].map(p => p.time))
      for (const point of history) {
        if (!existing.has(point.time)) oiBuffers[slot].push(point)
      }
      oiBuffers[slot].sort((a, b) => a.time - b.time)
      while (oiBuffers[slot].length > MAX_OI_POINTS) oiBuffers[slot].shift()
      saveOIBuffer(oiBuffers[slot], slot)
    }
  } catch (err) {
    console.error(`[OI] Failed to load history for ${slot}:`, err)
    oiHistoryLoaded[slot] = false
  }
}

// ─── DETECTION SWEEP ─────────────────────────────────────────────────────────

function detectAndUpdateSweep(
  slot: SlotKey,
  klines: Array<{ time: number; high: number; low: number; close: number; open: number; volume: number }>,
  oi: OIBar[],
  cvd: Array<{ cvd: number }>
): void {
  const allClosed = klines.slice(0, -1)
  if (allClosed.length < 10) return

  for (let i = allClosed.length - 1; i >= 5; i--) {
    const candle = allClosed[i]
    const structureKlines = allClosed.slice(Math.max(0, i - 80), i)
    if (structureKlines.length < 5) continue

    const structureHigh = Math.max(...structureKlines.map(k => k.high))
    const structureLow = Math.min(...structureKlines.map(k => k.low))

    const avgVol = getAvgVolume(klines, i)
    const volMult = avgVol > 0 ? klines[i].volume / avgVol : 1
    if (volMult < 1.5) continue

    const wickThreshold = volMult >= 3 ? 0.3 : 0.6
    const totalSize = candle.high - candle.low
    if (totalSize === 0) continue

    if (Date.now() - candle.time * 1000 > SWEEP_TTL_MS) continue

    // Sweep HIGH
    const isHighSweep = candle.high > structureHigh && candle.close < structureHigh
    const upperWick = candle.high - Math.max(candle.open, candle.close)
    if (isHighSweep && upperWick / totalSize > wickThreshold) {
      if (!sweepStates[slot] || candle.time * 1000 > sweepStates[slot]!.detectedAt) {
        const oiAtSweep = oi.find(o => o.time <= candle.time)?.openInterest ?? 0
        const cvdAtSweep = cvd[Math.min(i, cvd.length - 1)]?.cvd ?? 0
        sweepStates[slot] = {
          direction: 'high', detectedAt: candle.time * 1000,
          structureLevel: structureHigh,
          sweepHigh: candle.high, sweepLow: candle.low,
          oiAtSweep, cvdAtSweep,
        }
        saveSweepState(sweepStates[slot], slot)
        console.log(`[SWEEP] ${slot} HIGH @ ${new Date(sweepStates[slot]!.detectedAt).toISOString()}`)
      }
      break
    }

    // Sweep LOW
    const isLowSweep = candle.low < structureLow && candle.close > structureLow
    const lowerWick = Math.min(candle.open, candle.close) - candle.low
    if (isLowSweep && lowerWick / totalSize > wickThreshold) {
      if (!sweepStates[slot] || candle.time * 1000 > sweepStates[slot]!.detectedAt) {
        const oiAtSweep = oi.find(o => o.time <= candle.time)?.openInterest ?? 0
        const cvdAtSweep = cvd[Math.min(i, cvd.length - 1)]?.cvd ?? 0
        sweepStates[slot] = {
          direction: 'low', detectedAt: candle.time * 1000,
          structureLevel: structureLow,
          sweepHigh: candle.high, sweepLow: candle.low,
          oiAtSweep, cvdAtSweep,
        }
        saveSweepState(sweepStates[slot], slot)
        console.log(`[SWEEP] ${slot} LOW @ ${new Date(sweepStates[slot]!.detectedAt).toISOString()}`)
      }
      break
    }
  }
}

// ─── SCORING LFR (calibré sur backtest) ──────────────────────────────────────

type SignalResult = {
  action: 'BUY' | 'SELL' | 'STABLE'
  score: number
  reasons: string[]
  vwap: number
  sweepAge?: number
  metrics: {
    priceVsVwapPct: number
    cvdDelta: number
    distanceFromVwapPct: number
    wickDistancePct: number  // distance mèche → VWAP
    fundingRate: number
  }
  marketRegime: string
  volatilityBucket: string
}

function computeSignal(
  slot: SlotKey,
  klines: Array<{ open: number; high: number; low: number; close: number; volume: number }>,
  vwap: Array<{ vwap: number }>,
  cvd: Array<{ delta: number; cvd: number }>,
  funding: { rate: number } | null
): SignalResult {
  const lastK = klines.at(-1)
  const lastV = vwap.at(-1)
  const lastCvd = cvd.at(-1)
  const prevCvd = cvd.at(-2)

  const marketRegime = getMarketRegime(klines)
  const volatilityBucket = getVolatilityBucket(klines)
  const fundingRate = funding?.rate ?? 0
  const currentVwap = lastV?.vwap ?? 0

  const stable: SignalResult = {
    action: 'STABLE', score: 0, reasons: ['Données insuffisantes.'],
    vwap: currentVwap, metrics: { priceVsVwapPct: 0, cvdDelta: 0, distanceFromVwapPct: 0, wickDistancePct: 0, fundingRate },
    marketRegime, volatilityBucket,
  }

  if (!lastK || !lastV || !lastCvd || !prevCvd) return stable

  const sweep = sweepStates[slot]
  if (!isSweepValid(slot) || !sweep) {
    return {
      ...stable,
      reasons: ['Aucun sweep valide (< 2h).'],
    }
  }

  const priceVsVwapPct = ((lastK.close - lastV.vwap) / lastV.vwap) * 100

  // Distance VWAP sur le point de contact intrabar (mèche) pas seulement le close
  // Si la mèche touche la VWAP, la distance est nulle même si le close est plus loin
  const contactPriceSell = lastK.low   // pour SELL : le low s'approche de la VWAP
  const contactPriceBuy  = lastK.high  // pour BUY : le high s'approche de la VWAP
  const distanceFromVwapPct = Math.abs(priceVsVwapPct)

  const cvdDelta = lastCvd.cvd - prevCvd.cvd
  const sweepAgeMin = (Date.now() - sweep.detectedAt) / 1000 / 60

  const aboveVwap = lastK.close > lastV.vwap
  const belowVwap = lastK.close < lastV.vwap

  // Détection rejet/reclaim VWAP — mèche touche + close du bon côté
  const prevK = klines.at(-2)
  const prevV = vwap.at(-2)

  // SELL : mèche basse touche ou passe sous la VWAP ET close reste sous la VWAP
  const vwapReject = (
    contactPriceSell <= lastV.vwap && belowVwap
  ) || (
    !!prevK && !!prevV && prevK.close > prevV.vwap && lastK.close < lastV.vwap
  )

  // BUY : mèche haute touche ou passe au-dessus de la VWAP ET close reste au-dessus
  const vwapReclaim = (
    contactPriceBuy >= lastV.vwap && aboveVwap
  ) || (
    !!prevK && !!prevV && prevK.close < prevV.vwap && lastK.close > lastV.vwap
  )

  // Distance sur la mèche pour le filtre d'entrée
  const distanceSell = Math.abs((contactPriceSell - lastV.vwap) / lastV.vwap) * 100
  const distanceBuy  = Math.abs((contactPriceBuy  - lastV.vwap) / lastV.vwap) * 100

  // Structure LH/HL
  const prev3K = klines.at(-4)
  const lhStructure = !!prev3K && lastK.high < prev3K.high
  const hlStructure = !!prev3K && lastK.low > prev3K.low

  const cvdNonStable = Math.abs(cvdDelta) > 0

  const metrics = {
    priceVsVwapPct,
    cvdDelta,
    distanceFromVwapPct,
    wickDistancePct: sweep.direction === 'high' ? distanceSell : distanceBuy,
    fundingRate,
  }

  // ── SETUP SELL (sweep HIGH) ──
  if (sweep.direction === 'high') {
    let score = 0
    const reasons: string[] = []

    // L (1pt)
    score += 1
    reasons.push(`L: Sweep HIGH (${sweepAgeMin.toFixed(0)}min).`)

    // F CVD (1pt) — OI retiré du scoring (backtest: 0% lift)
    if (cvdNonStable && lastCvd.delta <= 0) {
      score += 1
      reasons.push('F: CVD baissier (vendeurs agressifs).')
    } else if (cvdNonStable) {
      score += 1
      reasons.push('F: CVD non-stable.')
    }

    // R VWAP (2pts) — critère le plus prédictif (+44% lift)
    if (vwapReject || belowVwap) {
      score += 2
      reasons.push('R: Rejet VWAP confirmé (2pts).')
    }

    // R Structure (1pt)
    if (lhStructure) {
      score += 1
      reasons.push('R: Structure LH confirmée.')
    }

    // Score exactement 4/5 — le 5/5 est en retard (validé par backtest)
    if (score === 4) {
      return {
        action: 'SELL', score, reasons,
        vwap: lastV.vwap, sweepAge: sweepAgeMin,
        metrics, marketRegime, volatilityBucket,
      }
    }

    return {
      action: 'STABLE', score, reasons: [`Score ${score}/5 — sweep HIGH actif ${sweepAgeMin.toFixed(0)}min.`],
      vwap: lastV.vwap, sweepAge: sweepAgeMin, metrics, marketRegime, volatilityBucket,
    }
  }

  // ── SETUP BUY (sweep LOW) ──
  if (sweep.direction === 'low') {
    let score = 0
    const reasons: string[] = []

    // L (1pt)
    score += 1
    reasons.push(`L: Sweep LOW (${sweepAgeMin.toFixed(0)}min).`)

    // F CVD (1pt)
    if (cvdNonStable && lastCvd.delta >= 0) {
      score += 1
      reasons.push('F: CVD haussier (acheteurs agressifs).')
    } else if (cvdNonStable) {
      score += 1
      reasons.push('F: CVD non-stable.')
    }

    // R VWAP (2pts)
    if (vwapReclaim || aboveVwap) {
      score += 2
      reasons.push('R: Reclaim VWAP confirmé (2pts).')
    }

    // R Structure (1pt)
    if (hlStructure) {
      score += 1
      reasons.push('R: Structure HL confirmée.')
    }

    // Score exactement 4/5
    if (score === 4) {
      return {
        action: 'BUY', score, reasons,
        vwap: lastV.vwap, sweepAge: sweepAgeMin,
        metrics, marketRegime, volatilityBucket,
      }
    }

    return {
      action: 'STABLE', score, reasons: [`Score ${score}/5 — sweep LOW actif ${sweepAgeMin.toFixed(0)}min.`],
      vwap: lastV.vwap, sweepAge: sweepAgeMin, metrics, marketRegime, volatilityBucket,
    }
  }

  return { ...stable, reasons: ['Direction sweep inconnue.'] }
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const SIGNAL_LOG = path.join(DATA_DIR, 'signal-log.csv')

function logSignalCSV(row: {
  time: string
  slot: string
  score: number
  action: string
  sweep_active: boolean
  sweep_age_min: number
  sweep_direction: string
  vwap_distance_pct: number
  vwap_distance_ok: boolean
  cooldown: boolean
  funding_blocked: boolean
  has_position: boolean
  weekend: boolean
  trade_taken: boolean
  reason_no_trade: string
  price: number
  vwap: number
  funding_rate: number
  cvd_delta: number
}) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const headers = Object.keys(row).join(',')
    const values = Object.values(row).map(v => {
      const str = String(v)
      return str.includes(',') ? `"${str}"` : str
    }).join(',')

    if (!fs.existsSync(SIGNAL_LOG)) {
      fs.writeFileSync(SIGNAL_LOG, headers + '\n', 'utf-8')
    }
    fs.appendFileSync(SIGNAL_LOG, values + '\n', 'utf-8')
  } catch (err) {
    console.error('[LOG] CSV write error:', err)
  }
}

export async function GET(req: NextRequest) {
  const weekend = isWeekend()

  try {
    // Fetch données communes BTC
    const [btcKlines1h, btcKlines15m, btcOI1h, btcOI15m, btcTicker, btcFunding] = await Promise.all([
      fetchKlines('BTCUSDT', '60', 200),
      fetchKlines('BTCUSDT', '15', 200),
      fetchCurrentOI('BTCUSDT', '1h'),
      fetchCurrentOI('BTCUSDT', '15min'),
      fetchTicker('BTCUSDT'),
      fetchFundingRate('BTCUSDT'),
    ])

    // Fetch données communes ETH
    const [ethKlines1h, ethKlines15m, ethOI1h, ethOI15m, ethTicker, ethFunding] = await Promise.all([
      fetchKlines('ETHUSDT', '60', 200),
      fetchKlines('ETHUSDT', '15', 200),
      fetchCurrentOI('ETHUSDT', '1h'),
      fetchCurrentOI('ETHUSDT', '15min'),
      fetchTicker('ETHUSDT'),
      fetchFundingRate('ETHUSDT'),
    ])

    // Init OI buffers si nécessaire
    await Promise.all([
      initOIBuffer('BTC-1h', '1h'),
      initOIBuffer('ETH-1h', '1h'),
      initOIBuffer('BTC-15m', '15min'),
      initOIBuffer('ETH-15m', '15min'),
    ])

    // Push snapshots OI
    pushOiSnapshot('BTC-1h', btcOI1h)
    pushOiSnapshot('ETH-1h', ethOI1h)
    pushOiSnapshot('BTC-15m', btcOI15m)
    pushOiSnapshot('ETH-15m', ethOI15m)

    // Construire les données par slot
    const slotData: Record<SlotKey, {
      klines: typeof btcKlines1h
      vwap: { time: number; vwap: number }[]
      cvd: { time: number; delta: number; cvd: number }[]
      oi: OIBar[]
      ticker: typeof btcTicker
      funding: typeof btcFunding
    }> = {
      'BTC-1h':  { klines: btcKlines1h,  vwap: calculateVWAP(btcKlines1h, 200),  cvd: calculateCVD([], btcKlines1h),  oi: buildOiSeriesForKlines('BTC-1h', btcKlines1h),   ticker: btcTicker, funding: btcFunding },
      'ETH-1h':  { klines: ethKlines1h,  vwap: calculateVWAP(ethKlines1h, 200),  cvd: calculateCVD([], ethKlines1h),  oi: buildOiSeriesForKlines('ETH-1h', ethKlines1h),   ticker: ethTicker, funding: ethFunding },
      'BTC-15m': { klines: btcKlines15m, vwap: calculateVWAP(btcKlines15m, 200), cvd: calculateCVD([], btcKlines15m), oi: buildOiSeriesForKlines('BTC-15m', btcKlines15m), ticker: btcTicker, funding: btcFunding },
      'ETH-15m': { klines: ethKlines15m, vwap: calculateVWAP(ethKlines15m, 200), cvd: calculateCVD([], ethKlines15m), oi: buildOiSeriesForKlines('ETH-15m', ethKlines15m), ticker: ethTicker, funding: ethFunding },
    }

    const slotSignals: Record<SlotKey, SignalResult> = {} as Record<SlotKey, SignalResult>

    // Traiter chaque slot indépendamment
    for (const config of SLOT_CONFIGS) {
      const { slot } = config
      const data = slotData[slot]

      // Évaluer les positions ouvertes
      evaluateOpenSetups(data.klines, slot)

      // Détecter sweep
      detectAndUpdateSweep(slot, data.klines, data.oi, data.cvd)

      // Scorer le signal
      const signal = computeSignal(slot, data.klines, data.vwap, data.cvd, data.funding)
      slotSignals[slot] = signal

      // Trading si conditions réunies
      if (!weekend && signal.action !== 'STABLE' && signal.score === 4) {
        const cooldown = isInCooldown(slot)
        // Distance sur la mèche (contact intrabar) plutôt que sur le close
        const wickDistance = signal.metrics.wickDistancePct ?? signal.metrics.distanceFromVwapPct
        const distanceOk = wickDistance <= config.vwapDistanceMax
        const fundingRate = signal.metrics.fundingRate
        const fundingBlocked = signal.action === 'BUY' && fundingRate > 0.0005
          || signal.action === 'SELL' && fundingRate < -0.0005

        const currentPos = getCurrentPosition(slot)
        const lastK = data.klines.at(-1)
        const referenceBarKey = `${slot}-${lastK?.time ?? 0}`

        const canTrade = !cooldown && distanceOk && !fundingBlocked && !currentPos && !!data.ticker
        const tradeTaken = canTrade && !hasRecentDuplicate(slot, signal.action as 'BUY' | 'SELL', Date.now())

        // Déterminer la raison du non-trade
        let reasonNoTrade = ''
        if (!tradeTaken) {
          if (cooldown) reasonNoTrade = 'cooldown'
          else if (!distanceOk) reasonNoTrade = `vwap_trop_loin_${signal.metrics.distanceFromVwapPct.toFixed(3)}pct`
          else if (fundingBlocked) reasonNoTrade = `funding_bloque_${fundingRate.toFixed(5)}`
          else if (currentPos) reasonNoTrade = 'position_deja_ouverte'
          else if (!data.ticker) reasonNoTrade = 'ticker_manquant'
          else reasonNoTrade = 'duplicate_recent'
        }

        // Log CSV
        logSignalCSV({
          time: new Date().toISOString(),
          slot,
          score: signal.score,
          action: signal.action,
          sweep_active: !!sweepStates[slot],
          sweep_age_min: Math.round(signal.sweepAge ?? 0),
          sweep_direction: sweepStates[slot]?.direction ?? '',
          vwap_distance_pct: Math.round(signal.metrics.distanceFromVwapPct * 10000) / 10000,
          vwap_distance_ok: distanceOk,
          cooldown,
          funding_blocked: fundingBlocked,
          has_position: !!currentPos,
          weekend,
          trade_taken: tradeTaken,
          reason_no_trade: tradeTaken ? 'trade_pris' : reasonNoTrade,
          price: data.ticker?.price ?? 0,
          vwap: Math.round(signal.vwap * 100) / 100,
          funding_rate: fundingRate,
          cvd_delta: Math.round(signal.metrics.cvdDelta * 100) / 100,
        })

        if (tradeTaken) {
          console.log(`[TRADE] ${slot} openPosition: ${signal.action} @ ${data.ticker!.price}`)
          await openPosition({
            slot,
            timestamp: Date.now(),
            timeframe: config.timeframe,
            action: signal.action as 'BUY' | 'SELL',
            confidence: signal.score,
            entryPrice: data.ticker!.price,
            vwap: signal.vwap,
            referenceBarKey,
            signalType: signal.action === 'BUY' ? 'bullish_retest' : 'bearish_retest',
            marketRegime: signal.marketRegime as 'trend' | 'range' | 'breakout' | 'reversal',
            vwapDistancePct: signal.metrics.distanceFromVwapPct,
            volatilityBucket: signal.volatilityBucket as 'low' | 'medium' | 'high',
          })
          // Reset sweep après entrée
          sweepStates[slot] = null
          saveSweepState(null, slot)
        }
      } else {
        // Log aussi les signaux non-4/5 pour comprendre pourquoi rien ne se passe
        const sweep = sweepStates[slot]
        logSignalCSV({
          time: new Date().toISOString(),
          slot,
          score: signal.score,
          action: signal.action,
          sweep_active: !!sweep,
          sweep_age_min: Math.round(signal.sweepAge ?? 0),
          sweep_direction: sweep?.direction ?? '',
          vwap_distance_pct: Math.round(signal.metrics.distanceFromVwapPct * 10000) / 10000,
          vwap_distance_ok: signal.metrics.distanceFromVwapPct <= config.vwapDistanceMax,
          cooldown: isInCooldown(slot),
          funding_blocked: false,
          has_position: !!getCurrentPosition(slot),
          weekend,
          trade_taken: false,
          reason_no_trade: weekend ? 'weekend' : signal.score < 4 ? `score_${signal.score}_sur_5` : 'stable_pas_de_sweep',
          price: data.ticker?.price ?? 0,
          vwap: Math.round(signal.vwap * 100) / 100,
          funding_rate: signal.metrics.fundingRate,
          cvd_delta: Math.round(signal.metrics.cvdDelta * 100) / 100,
        })
      }
    }

    return NextResponse.json({
      // Données principales BTC 1h pour l'UI
      klines: slotData['BTC-1h'].klines,
      vwap: slotData['BTC-1h'].vwap,
      cvd: slotData['BTC-1h'].cvd,
      oi: slotData['BTC-1h'].oi,
      ticker: btcTicker,
      funding: btcFunding,

      // Signal principal (BTC 1h pour compatibilité UI)
      signal: {
        action: slotSignals['BTC-1h'].action,
        confidence: slotSignals['BTC-1h'].score,
        signalType: slotSignals['BTC-1h'].action === 'BUY' ? 'bullish_retest'
          : slotSignals['BTC-1h'].action === 'SELL' ? 'bearish_retest' : 'neutral',
        marketRegime: slotSignals['BTC-1h'].marketRegime,
        volatilityBucket: slotSignals['BTC-1h'].volatilityBucket,
        vwap: slotSignals['BTC-1h'].vwap,
        reasons: slotSignals['BTC-1h'].reasons,
        sweepAge: slotSignals['BTC-1h'].sweepAge,
        metrics: {
          ...slotSignals['BTC-1h'].metrics,
          oiDeltaPct: 0,
          oiChangeAbs: 0,
        },
      },

      // Tous les signaux des 4 slots
      slotSignals: Object.fromEntries(
        Object.entries(slotSignals).map(([k, v]) => [k, {
          action: v.action, score: v.score, reasons: v.reasons,
          vwap: v.vwap, sweepAge: v.sweepAge, metrics: v.metrics,
        }])
      ),

      // Positions et stats
      allPositions: getAllPositions(),
      currentPosition: getCurrentPosition('BTC-1h'),
      setupHistory: getRecentSetups(),
      setupStats: getStats(),
      slotStats: getSlotStats(),
      sessionStats: getSessionStats(),

      // Sweeps actifs
      activeSweeps: Object.fromEntries(
        (['BTC-1h', 'ETH-1h', 'BTC-15m', 'ETH-15m'] as SlotKey[]).map(slot => [
          slot,
          sweepStates[slot] ? {
            direction: sweepStates[slot]!.direction,
            ageMinutes: Math.round((Date.now() - sweepStates[slot]!.detectedAt) / 60000),
            structureLevel: sweepStates[slot]!.structureLevel,
          } : null
        ])
      ),

      weekend,
      lastUpdate: Date.now(),
      timeframe: '1h',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
