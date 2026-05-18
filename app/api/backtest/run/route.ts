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

// ─── AMÉLIORATION 1 : Sessions de trading ────────────────────────────────────
type Session = 'Asia' | 'London' | 'NewYork' | 'Overlap'

function getSession(timestampSec: number): Session {
  const hour = new Date(timestampSec * 1000).getUTCHours()
  if (hour >= 13 && hour < 17) return 'Overlap'   // London/NY overlap — meilleur volume
  if (hour >= 8 && hour < 16) return 'London'      // London session
  if (hour >= 13 && hour < 22) return 'NewYork'    // NY session
  return 'Asia'                                      // Asia session
}

// ─── AMÉLIORATION 2 : Direction funding ──────────────────────────────────────
function isFundingAligned(fundingRate: number, direction: 'high' | 'low'): boolean {
  // Funding positif élevé = longs surchargés → favorise SELL (sweep HIGH)
  // Funding négatif = shorts surchargés → favorise BUY (sweep LOW)
  if (direction === 'high' && fundingRate > 0.0002) return true
  if (direction === 'low' && fundingRate < -0.0002) return true
  return false
}

// ─── AMÉLIORATION 3 : Contexte HTF (trend vs range) ─────────────────────────
function getHTFContext(bars: RawBar[], i: number): 'trend_aligned' | 'range' | 'counter_trend' {
  // Regarder les 20 dernières bougies pour déterminer la tendance
  const window = bars.slice(Math.max(0, i - 20), i)
  if (window.length < 10) return 'range'

  const firstClose = window[0].close
  const lastClose = window[window.length - 1].close
  const changePct = ((lastClose - firstClose) / firstClose) * 100

  if (Math.abs(changePct) < 1.5) return 'range'
  return changePct > 0 ? 'trend_aligned' : 'counter_trend'
}

// ─── AMÉLIORATION 4 : Age optimal du sweep ───────────────────────────────────
type SweepAge = 'fresh' | 'recent' | 'old'

function getSweepAge(barsFromSweep: number): SweepAge {
  if (barsFromSweep <= 2) return 'fresh'    // 0-2 bougies après sweep
  if (barsFromSweep <= 6) return 'recent'   // 3-6 bougies après sweep
  return 'old'                               // >6 bougies = signal dégradé
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

type SweepEvent = {
  time: number
  direction: 'high' | 'low'
  structureLevel: number
  sweepCandle: RawBar
  oiAtSweep: number
  oiBeforeSweep: number
  oiExpanded: boolean
  fundingAtSweep: number
  fundingExtreme: boolean
  fundingAligned: boolean        // Amélioration 2
  session: Session               // Amélioration 1
  htfContext: string             // Amélioration 3
  sweepAge: SweepAge             // Amélioration 4
  score: number
  scoreL: number
  scoreF: number
  scoreR: number
  outcome: 'win' | 'loss' | 'breakeven'
  rMultiple: number
  entryPrice: number
  slPrice: number
  tpPrice: number
  barsToClose: number
  vwapAtEntry: number
  cvdDirection: 'bullish' | 'bearish' | 'neutral'
}

type StatBlock = { trades: number; wins: number; winRate: number; avgR: number; expectancy: number }

type BacktestResults = {
  generatedAt: string
  symbol: string
  totalBars: number
  totalSweeps: number
  L: StatBlock
  LF: StatBlock
  LFR: StatBlock
  byScore: Record<number, StatBlock>

  // Funding directionnel (amélioration 2)
  fundingFilter: {
    aligned: StatBlock
    neutral: StatBlock
    counter: StatBlock
  }

  // OI filtre
  oiFilter: {
    withExpansion: { trades: number; wins: number; winRate: number }
    withoutExpansion: { trades: number; wins: number; winRate: number }
  }

  // Sessions (amélioration 1)
  bySession: Record<Session, StatBlock>

  // HTF context (amélioration 3)
  byHTFContext: Record<string, StatBlock>

  // Age du sweep (amélioration 4)
  bySweepAge: Record<SweepAge, StatBlock>

  rDistribution: { bucket: string; count: number }[]
  suggestedWeights: { L: number; F_oi: number; F_cvd: number; F_funding: number; R_vwap: number; R_structure: number }
  sweeps: SweepEvent[]
}

// ─── DETECTION SWEEP ─────────────────────────────────────────────────────────

function detectSweep(bars: RawBar[], i: number): SweepEvent | null {
  const structure = bars.slice(Math.max(0, i - 80), i)
  if (structure.length < 10) return null

  const candle = bars[i]
  const structureHigh = Math.max(...structure.map(k => k.high))
  const structureLow = Math.min(...structure.map(k => k.low))

  const avgVol = bars.slice(Math.max(0, i - 20), i)
    .reduce((s, k) => s + k.volume, 0) / Math.min(20, i)

  const volMult = avgVol > 0 ? candle.volume / avgVol : 1
  const hasVolume = volMult > 1.5
  const wickThreshold = volMult >= 3 ? 0.3 : 0.6
  const totalSize = candle.high - candle.low
  if (totalSize === 0 || !hasVolume) return null

  const oiBeforeSweep = bars[Math.max(0, i - 1)].oi
  const oiAtSweep = candle.oi
  const oiExpanded = oiBeforeSweep > 0 && oiAtSweep > oiBeforeSweep * 1.0002
  const fundingAtSweep = candle.fundingRate
  const fundingExtreme = Math.abs(fundingAtSweep) > 0.0008
  const session = getSession(candle.time)
  const htfContext = getHTFContext(bars, i)

  const isHighSweep = candle.high > structureHigh && candle.close < structureHigh
  const upperWick = candle.high - Math.max(candle.open, candle.close)
  if (isHighSweep && upperWick / totalSize > wickThreshold) {
    return buildSweepEvent(bars, i, 'high', structureHigh, oiAtSweep, oiBeforeSweep, oiExpanded, fundingAtSweep, fundingExtreme, session, htfContext)
  }

  const isLowSweep = candle.low < structureLow && candle.close > structureLow
  const lowerWick = Math.min(candle.open, candle.close) - candle.low
  if (isLowSweep && lowerWick / totalSize > wickThreshold) {
    return buildSweepEvent(bars, i, 'low', structureLow, oiAtSweep, oiBeforeSweep, oiExpanded, fundingAtSweep, fundingExtreme, session, htfContext)
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
  fundingExtreme: boolean,
  session: Session,
  htfContext: string
): SweepEvent {
  const candle = bars[i]

  const vwapWindow = bars.slice(Math.max(0, i - 50), i + 1)
  const totalPV = vwapWindow.reduce((s, k) => s + ((k.high + k.low + k.close) / 3) * k.volume, 0)
  const totalVol = vwapWindow.reduce((s, k) => s + k.volume, 0)
  const vwapAtEntry = totalVol > 0 ? totalPV / totalVol : candle.close

  const fundingAligned = isFundingAligned(fundingAtSweep, direction)

  // ─── AJUSTEMENTS v2 ───────────────────────────────────────────────────────
  // TTL sweep élargi : 4 bougies au lieu de 2 (fresh) et 8 au lieu de 6 (recent)
  const confirmBars = bars.slice(i + 1, i + 9) // fenêtre élargie à 8 bougies
  
  // R-VWAP sur prix intra-bougie (low/high) pas seulement le close
  // Un rejet violent peut fermer loin de la VWAP mais avoir touché la VWAP intrabar
  const entryBarIndex = confirmBars.findIndex(b =>
    direction === 'high' ? b.close < vwapAtEntry : b.close > vwapAtEntry
  )
  const sweepAge = getSweepAge(entryBarIndex >= 0 ? entryBarIndex + 1 : 8)

  const entryBar = entryBarIndex >= 0 ? confirmBars[entryBarIndex] : null
  const entryPrice = entryBar ? entryBar.close : candle.close

  // Scoring
  let scoreL = 0, scoreF = 0, scoreR = 0
  scoreL = 1

  const nextBar = bars[i + 1]
  const cvdDirection: 'bullish' | 'bearish' | 'neutral' = nextBar
    ? nextBar.close > nextBar.open ? 'bullish' : nextBar.close < nextBar.open ? 'bearish' : 'neutral'
    : 'neutral'

  if (direction === 'high' && cvdDirection === 'bearish') scoreF += 1
  if (direction === 'low' && cvdDirection === 'bullish') scoreF += 1

  // R VWAP (2pts) — close de la bougie sous/sur la VWAP
  const checkBars = bars.slice(i + 1, i + 4)
  const vwapReaction = checkBars.some(b =>
    direction === 'high' ? b.close < vwapAtEntry : b.close > vwapAtEntry
  )
  if (vwapReaction) scoreR += 2

  // R Structure (1pt)
  const prev3High = bars[Math.max(0, i - 3)]?.high ?? 0
  const prev3Low = bars[Math.max(0, i - 3)]?.low ?? 0
  const lastHigh = bars[i + 1]?.high ?? 0
  const lastLow = bars[i + 1]?.low ?? 0
  if (direction === 'high' && lastHigh < prev3High) scoreR += 1
  if (direction === 'low' && lastLow > prev3Low) scoreR += 1

  const score = scoreL + scoreF + scoreR

  // Trade — TP 3R — entrée au prix VWAP si touché intrabar
  const slPct = 0.002
  const finalEntryPrice = entryPrice
  const slPrice = direction === 'high'
    ? structureLevel * (1 + slPct)
    : structureLevel * (1 - slPct)
  const risk = Math.abs(finalEntryPrice - slPrice)
  const tpPrice = direction === 'high'
    ? finalEntryPrice - risk * 3
    : finalEntryPrice + risk * 3

  let outcome: 'win' | 'loss' | 'breakeven' = 'breakeven'
  let rMultiple = 0
  let barsToClose = 0

  const startBar = entryBarIndex >= 0 ? i + entryBarIndex + 1 : i + 1

  for (let j = startBar; j < Math.min(startBar + 16, bars.length); j++) {
    const b = bars[j]
    barsToClose = j - i
    if (direction === 'high') {
      if (b.low <= tpPrice) { outcome = 'win'; rMultiple = 3; break }
      if (b.high >= slPrice) { outcome = 'loss'; rMultiple = -1; break }
    } else {
      if (b.high >= tpPrice) { outcome = 'win'; rMultiple = 3; break }
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
    fundingAligned,
    session,
    htfContext,
    sweepAge,
    score,
    scoreL,
    scoreF,
    scoreR,
    outcome,
    rMultiple,
    entryPrice: finalEntryPrice,
    slPrice,
    tpPrice,
    barsToClose,
    vwapAtEntry,
    cvdDirection,
  }
}

// ─── STATS ───────────────────────────────────────────────────────────────────

function calcStats(sweeps: SweepEvent[]): StatBlock {
  const closed = sweeps.filter(s => s.outcome !== 'breakeven')
  const wins = closed.filter(s => s.outcome === 'win')
  const avgR = closed.length > 0
    ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length
    : 0
  const winRate = closed.length > 0 ? wins.length / closed.length : 0
  const expectancy = winRate * 3 - (1 - winRate) * 1
  return {
    trades: closed.length,
    wins: wins.length,
    winRate: Math.round(winRate * 1000) / 10,
    avgR: Math.round(avgR * 100) / 100,
    expectancy: Math.round(expectancy * 1000) / 1000,
  }
}

function suggestWeights(sweeps: SweepEvent[]) {
  const base = calcStats(sweeps).winRate / 100
  const lift = (v: number) => Math.max(0, Math.round((v - base) * 100) / 100)

  return {
    L: lift(calcStats(sweeps.filter(s => s.scoreL > 0)).winRate / 100),
    F_oi: 0,
    F_cvd: lift(calcStats(sweeps.filter(s =>
      (s.direction === 'high' && s.cvdDirection === 'bearish') ||
      (s.direction === 'low' && s.cvdDirection === 'bullish')
    )).winRate / 100),
    F_funding: lift(calcStats(sweeps.filter(s => s.fundingAligned)).winRate / 100),
    R_vwap: lift(calcStats(sweeps.filter(s => s.scoreR >= 2)).winRate / 100),
    R_structure: lift(calcStats(sweeps.filter(s => s.scoreR >= 3)).winRate / 100),
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()
  const allowed = ['BTCUSDT', 'ETHUSDT']
  if (!allowed.includes(symbol)) {
    return NextResponse.json({ error: `Symbole non supporté: ${symbol}` }, { status: 400 })
  }

  const HISTORY_FILE = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}.json`)
  const HISTORY_FILE_1H = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-1h.json`)
  const FALLBACK_FILE = path.join(DATA_DIR, 'backtest-history.json')

  // Chercher dans l'ordre : ancien format → nouveau format 1h → fallback BTC
  const fileToUse = fs.existsSync(HISTORY_FILE) ? HISTORY_FILE
    : fs.existsSync(HISTORY_FILE_1H) ? HISTORY_FILE_1H
    : (symbol === 'BTCUSDT' && fs.existsSync(FALLBACK_FILE)) ? FALLBACK_FILE
    : null

  try {
    if (!fileToUse) {
      return NextResponse.json(
        { error: `Données ${symbol} manquantes. Lance /api/backtest/collect?symbol=${symbol} d'abord.` },
        { status: 400 }
      )
    }

    const raw = JSON.parse(fs.readFileSync(fileToUse, 'utf-8')) as RawBar[]

    const allSweeps: SweepEvent[] = []
    for (let i = 10; i < raw.length - 15; i++) {
      const sweep = detectSweep(raw, i)
      if (sweep) allSweeps.push(sweep)
    }

    // Dédupliquer
    const filtered: SweepEvent[] = []
    for (const s of allSweeps) {
      const last = filtered.at(-1)
      if (!last || s.time - last.time > 3 * 4 * 3600) {
        filtered.push(s)
      }
    }

    const LF = filtered.filter(s => s.scoreF >= 1)
    const LFR_full = filtered.filter(s => s.score >= 4)

    const byScore: BacktestResults['byScore'] = {}
    for (let sc = 1; sc <= 5; sc++) {
      byScore[sc] = calcStats(filtered.filter(s => s.score === sc))
    }

    // Amélioration 1 — Par session
    const bySession: BacktestResults['bySession'] = {
      Asia: calcStats(filtered.filter(s => s.session === 'Asia')),
      London: calcStats(filtered.filter(s => s.session === 'London')),
      NewYork: calcStats(filtered.filter(s => s.session === 'NewYork')),
      Overlap: calcStats(filtered.filter(s => s.session === 'Overlap')),
    }

    // Amélioration 2 — Funding directionnel
    const fundingFilter: BacktestResults['fundingFilter'] = {
      aligned: calcStats(filtered.filter(s => s.fundingAligned)),
      neutral: calcStats(filtered.filter(s => !s.fundingAligned && !s.fundingExtreme)),
      counter: calcStats(filtered.filter(s => s.fundingExtreme && !s.fundingAligned)),
    }

    // Amélioration 3 — HTF context
    const byHTFContext: BacktestResults['byHTFContext'] = {
      trend_aligned: calcStats(filtered.filter(s => s.htfContext === 'trend_aligned')),
      range: calcStats(filtered.filter(s => s.htfContext === 'range')),
      counter_trend: calcStats(filtered.filter(s => s.htfContext === 'counter_trend')),
    }

    // Amélioration 4 — Age du sweep
    const bySweepAge: BacktestResults['bySweepAge'] = {
      fresh: calcStats(filtered.filter(s => s.sweepAge === 'fresh')),
      recent: calcStats(filtered.filter(s => s.sweepAge === 'recent')),
      old: calcStats(filtered.filter(s => s.sweepAge === 'old')),
    }

    // OI filtre
    const oiFilter = {
      withExpansion: calcStats(filtered.filter(s => s.oiExpanded)),
      withoutExpansion: calcStats(filtered.filter(s => !s.oiExpanded)),
    }

    const rDistribution = ['-2R', '-1R', '0R', '+1R', '+2R', '+3R'].map(bucket => {
      let count = 0
      if (bucket === '-2R') count = filtered.filter(s => s.rMultiple <= -2).length
      else if (bucket === '-1R') count = filtered.filter(s => s.rMultiple > -2 && s.rMultiple <= -0.5).length
      else if (bucket === '0R') count = filtered.filter(s => s.outcome === 'breakeven').length
      else if (bucket === '+1R') count = filtered.filter(s => s.rMultiple > 0 && s.rMultiple < 2).length
      else if (bucket === '+2R') count = filtered.filter(s => s.rMultiple >= 2 && s.rMultiple < 3).length
      else count = filtered.filter(s => s.rMultiple >= 3).length
      return { bucket, count }
    })

    const results: BacktestResults = {
      generatedAt: new Date().toISOString(),
      symbol,
      totalBars: raw.length,
      totalSweeps: filtered.length,
      L: calcStats(filtered),
      LF: calcStats(LF),
      LFR: calcStats(LFR_full),
      byScore,
      fundingFilter,
      oiFilter,
      bySession,
      byHTFContext,
      bySweepAge,
      rDistribution,
      suggestedWeights: suggestWeights(filtered),
      sweeps: filtered.slice(-50),
    }

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8')
    return NextResponse.json(results)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
