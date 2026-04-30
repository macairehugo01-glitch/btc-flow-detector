import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const HISTORY_FILE = path.join(DATA_DIR, 'backtest-history.json')
const RESULTS_FILE = path.join(DATA_DIR, 'backtest-results.json')

type RawBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  oi: number
  fundingRate: number
}

type SweepEvent = {
  time: number
  direction: 'high' | 'low'
  structureLevel: number
  sweepCandle: RawBar
  oiAtSweep: number
  oiBeforeSweep: number
  oiExpanded: boolean
  fundingAtSweep: number
  fundingExtreme: boolean // |funding| > 0.0008
  // Résultat
  score: number           // 0-5 selon critères LFR
  scoreL: number          // L seul (0 ou 1)
  scoreF: number          // F (0-2)
  scoreR: number          // R (0-2)
  outcome: 'win' | 'loss' | 'breakeven'
  rMultiple: number       // R réalisé
  entryPrice: number
  slPrice: number
  tpPrice: number
  barsToClose: number
  // Contexte
  vwapAtEntry: number
  cvdDirection: 'bullish' | 'bearish' | 'neutral'
}

type BacktestResults = {
  generatedAt: string
  totalBars: number
  totalSweeps: number

  // L seul
  L: { trades: number; wins: number; winRate: number; avgR: number; expectancy: number }

  // L+F
  LF: { trades: number; wins: number; winRate: number; avgR: number; expectancy: number }

  // L+F+R (stratégie complète)
  LFR: { trades: number; wins: number; winRate: number; avgR: number; expectancy: number }

  // Par score
  byScore: Record<number, { trades: number; wins: number; winRate: number; avgR: number }>

  // Funding comme filtre
  fundingFilter: {
    withExtreme: { trades: number; wins: number; winRate: number }
    withoutExtreme: { trades: number; wins: number; winRate: number }
  }

  // OI expansion comme filtre
  oiFilter: {
    withExpansion: { trades: number; wins: number; winRate: number }
    withoutExpansion: { trades: number; wins: number; winRate: number }
  }

  // Distribution des R
  rDistribution: { bucket: string; count: number }[]

  // Poids suggérés (calibrés sur les résultats)
  suggestedWeights: { L: number; F_oi: number; F_cvd: number; R_vwap: number; R_structure: number }

  sweeps: SweepEvent[]
}

// ─── DETECTION SWEEP ─────────────────────────────────────────────────────────

function detectSweep(bars: RawBar[], i: number): SweepEvent | null {
  const structure = bars.slice(Math.max(0, i - 80), i)
  if (structure.length < 10) return null

  const candle = bars[i]
  const structureHigh = Math.max(...structure.map(k => k.high))
  const structureLow = Math.min(...structure.map(k => k.low))

  // Volume moyen des 20 bougies précédentes
  const avgVol = bars.slice(Math.max(0, i - 20), i)
    .reduce((s, k) => s + k.volume, 0) / Math.min(20, i)

  const volMult = avgVol > 0 ? candle.volume / avgVol : 1
  const hasVolume = volMult > 1.5
  const wickThreshold = volMult >= 3 ? 0.3 : 0.6
  const totalSize = candle.high - candle.low
  if (totalSize === 0 || !hasVolume) return null

  // OI avant sweep (barre précédente)
  const oiBeforeSweep = bars[Math.max(0, i - 1)].oi
  const oiAtSweep = candle.oi
  const oiExpanded = oiBeforeSweep > 0 && oiAtSweep > oiBeforeSweep * 1.0002

  const fundingAtSweep = candle.fundingRate
  const fundingExtreme = Math.abs(fundingAtSweep) > 0.0008

  // SWEEP HIGH
  const isHighSweep = candle.high > structureHigh && candle.close < structureHigh
  const upperWick = candle.high - Math.max(candle.open, candle.close)
  if (isHighSweep && upperWick / totalSize > wickThreshold) {
    return buildSweepEvent(bars, i, 'high', structureHigh, oiAtSweep, oiBeforeSweep, oiExpanded, fundingAtSweep, fundingExtreme)
  }

  // SWEEP LOW
  const isLowSweep = candle.low < structureLow && candle.close > structureLow
  const lowerWick = Math.min(candle.open, candle.close) - candle.low
  if (isLowSweep && lowerWick / totalSize > wickThreshold) {
    return buildSweepEvent(bars, i, 'low', structureLow, oiAtSweep, oiBeforeSweep, oiExpanded, fundingAtSweep, fundingExtreme)
  }

  return null
}

function buildSweepEvent(
  bars: RawBar[],
  i: number,
  direction: 'high' | 'low',
  structureLevel: number,
  oiAtSweep: number,
  oiBeforeSweep: number,
  oiExpanded: boolean,
  fundingAtSweep: number,
  fundingExtreme: boolean
): SweepEvent {
  const candle = bars[i]

  // Calcul VWAP simplifié sur les 50 dernières bougies
  const vwapWindow = bars.slice(Math.max(0, i - 50), i + 1)
  const totalPV = vwapWindow.reduce((s, k) => s + ((k.high + k.low + k.close) / 3) * k.volume, 0)
  const totalVol = vwapWindow.reduce((s, k) => s + k.volume, 0)
  const vwapAtEntry = totalVol > 0 ? totalPV / totalVol : candle.close

  // Scoring LFR
  let scoreL = 0, scoreF = 0, scoreR = 0

  // L (1pt)
  scoreL = 1

  // F — OI expansion (1pt)
  if (oiExpanded) scoreF += 1

  // F — CVD (estimé depuis la direction de la bougie suivante)
  const nextBar = bars[i + 1]
  const cvdDirection: 'bullish' | 'bearish' | 'neutral' = nextBar
    ? nextBar.close > nextBar.open ? 'bullish' : nextBar.close < nextBar.open ? 'bearish' : 'neutral'
    : 'neutral'

  if (direction === 'high' && cvdDirection === 'bearish') scoreF += 1
  if (direction === 'low' && cvdDirection === 'bullish') scoreF += 1

  // R — Rejet/Reclaim VWAP (1pt) — vérifié sur les 2 bougies suivantes
  const checkBars = bars.slice(i + 1, i + 4)
  const vwapReaction = checkBars.some(b =>
    direction === 'high' ? b.close < vwapAtEntry : b.close > vwapAtEntry
  )
  if (vwapReaction) scoreR += 1

  // R — Structure LH/HL (1pt)
  const prev3High = bars[Math.max(0, i - 3)]?.high ?? 0
  const prev3Low = bars[Math.max(0, i - 3)]?.low ?? 0
  const lastHigh = bars[i + 1]?.high ?? 0
  const lastLow = bars[i + 1]?.low ?? 0
  if (direction === 'high' && lastHigh < prev3High) scoreR += 1
  if (direction === 'low' && lastLow > prev3Low) scoreR += 1

  const score = scoreL + scoreF + scoreR

  // Simulation trade (SL = structureLevel ± 0.2%, TP = 2R)
  const slPct = 0.002
  const entryPrice = candle.close
  const slPrice = direction === 'high'
    ? structureLevel * (1 + slPct)
    : structureLevel * (1 - slPct)
  const risk = Math.abs(entryPrice - slPrice)
  const tpPrice = direction === 'high'
    ? entryPrice - risk * 2
    : entryPrice + risk * 2

  // Résultat dans les 10 bougies suivantes
  let outcome: 'win' | 'loss' | 'breakeven' = 'breakeven'
  let rMultiple = 0
  let barsToClose = 0

  for (let j = i + 1; j < Math.min(i + 11, bars.length); j++) {
    const b = bars[j]
    barsToClose = j - i

    if (direction === 'high') {
      if (b.low <= tpPrice) { outcome = 'win'; rMultiple = 2; break }
      if (b.high >= slPrice) { outcome = 'loss'; rMultiple = -1; break }
    } else {
      if (b.high >= tpPrice) { outcome = 'win'; rMultiple = 2; break }
      if (b.low <= slPrice) { outcome = 'loss'; rMultiple = -1; break }
    }
  }

  return {
    time: candle.time,
    direction,
    structureLevel,
    sweepCandle: candle,
    oiAtSweep,
    oiBeforeSweep,
    oiExpanded,
    fundingAtSweep,
    fundingExtreme,
    score,
    scoreL,
    scoreF,
    scoreR,
    outcome,
    rMultiple,
    entryPrice,
    slPrice,
    tpPrice,
    barsToClose,
    vwapAtEntry,
    cvdDirection,
  }
}

// ─── STATS HELPERS ────────────────────────────────────────────────────────────

function calcStats(sweeps: SweepEvent[]) {
  const closed = sweeps.filter(s => s.outcome !== 'breakeven')
  const wins = closed.filter(s => s.outcome === 'win')
  const avgR = closed.length > 0
    ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length
    : 0
  const winRate = closed.length > 0 ? wins.length / closed.length : 0
  const expectancy = winRate * 2 - (1 - winRate) * 1

  return {
    trades: closed.length,
    wins: wins.length,
    winRate: Math.round(winRate * 1000) / 10,
    avgR: Math.round(avgR * 100) / 100,
    expectancy: Math.round(expectancy * 1000) / 1000,
  }
}

// ─── POIDS SUGGÉRÉS ───────────────────────────────────────────────────────────

function suggestWeights(sweeps: SweepEvent[]) {
  // Pour chaque critère, calculer le lift de win rate quand il est présent
  const base = calcStats(sweeps).winRate / 100

  const withL = calcStats(sweeps.filter(s => s.scoreL > 0)).winRate / 100
  const withFOI = calcStats(sweeps.filter(s => s.oiExpanded)).winRate / 100
  const withFCVD = calcStats(sweeps.filter(s =>
    (s.direction === 'high' && s.cvdDirection === 'bearish') ||
    (s.direction === 'low' && s.cvdDirection === 'bullish')
  )).winRate / 100
  const withRVwap = calcStats(sweeps.filter(s => s.scoreR >= 1)).winRate / 100
  const withRStruct = calcStats(sweeps.filter(s => s.scoreR >= 2)).winRate / 100

  const lift = (v: number) => Math.max(0, Math.round((v - base) * 100) / 100)

  return {
    L: lift(withL),
    F_oi: lift(withFOI),
    F_cvd: lift(withFCVD),
    R_vwap: lift(withRVwap),
    R_structure: lift(withRStruct),
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) {
      return NextResponse.json(
        { error: 'Données historiques manquantes. Lance /api/backtest/collect d\'abord.' },
        { status: 400 }
      )
    }

    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) as RawBar[]

    // Détecter tous les sweeps
    const allSweeps: SweepEvent[] = []
    for (let i = 10; i < raw.length - 10; i++) {
      const sweep = detectSweep(raw, i)
      if (sweep) allSweeps.push(sweep)
    }

    // Filtrer les doublons (même direction dans les 3 bougies suivantes)
    const filtered: SweepEvent[] = []
    for (const s of allSweeps) {
      const last = filtered.at(-1)
      if (!last || s.time - last.time > 3 * 4 * 3600) {
        filtered.push(s)
      }
    }

    // Calculer stats par segment
    const L_only = filtered
    const LF = filtered.filter(s => s.scoreF >= 1)
    const LFR_full = filtered.filter(s => s.score >= 4)

    // Par score
    const byScore: BacktestResults['byScore'] = {}
    for (let sc = 1; sc <= 5; sc++) {
      const group = filtered.filter(s => s.score === sc)
      byScore[sc] = calcStats(group)
    }

    // Funding filter
    const withExtreme = filtered.filter(s => s.fundingExtreme)
    const withoutExtreme = filtered.filter(s => !s.fundingExtreme)

    // OI filter
    const withExpansion = filtered.filter(s => s.oiExpanded)
    const withoutExpansion = filtered.filter(s => !s.oiExpanded)

    // Distribution R
    const buckets = ['-2R', '-1R', '0R', '+1R', '+2R', '+3R+']
    const rDistribution = buckets.map(bucket => {
      let count = 0
      if (bucket === '-2R') count = filtered.filter(s => s.rMultiple <= -2).length
      else if (bucket === '-1R') count = filtered.filter(s => s.rMultiple > -2 && s.rMultiple <= -0.5).length
      else if (bucket === '0R') count = filtered.filter(s => s.outcome === 'breakeven').length
      else if (bucket === '+1R') count = filtered.filter(s => s.rMultiple > 0 && s.rMultiple < 2).length
      else if (bucket === '+2R') count = filtered.filter(s => s.rMultiple === 2).length
      else count = filtered.filter(s => s.rMultiple > 2).length
      return { bucket, count }
    })

    const results: BacktestResults = {
      generatedAt: new Date().toISOString(),
      totalBars: raw.length,
      totalSweeps: filtered.length,
      L: calcStats(L_only),
      LF: calcStats(LF),
      LFR: calcStats(LFR_full),
      byScore,
      fundingFilter: {
        withExtreme: calcStats(withExtreme),
        withoutExtreme: calcStats(withoutExtreme),
      },
      oiFilter: {
        withExpansion: calcStats(withExpansion),
        withoutExpansion: calcStats(withoutExpansion),
      },
      rDistribution,
      suggestedWeights: suggestWeights(filtered),
      sweeps: filtered.slice(-50), // derniers 50 pour l'UI
    }

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8')

    return NextResponse.json(results)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
