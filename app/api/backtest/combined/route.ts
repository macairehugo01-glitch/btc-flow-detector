import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

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

type Session = 'Asia' | 'London' | 'NewYork' | 'Overlap'
type SweepAge = 'fresh' | 'recent' | 'old'

function getSession(timestampSec: number): Session {
  const hour = new Date(timestampSec * 1000).getUTCHours()
  if (hour >= 13 && hour < 17) return 'Overlap'
  if (hour >= 8 && hour < 16) return 'London'
  if (hour >= 13 && hour < 22) return 'NewYork'
  return 'Asia'
}

function getSweepAge(barsFromSweep: number): SweepAge {
  if (barsFromSweep <= 2) return 'fresh'
  if (barsFromSweep <= 6) return 'recent'
  return 'old'
}

type SweepEvent = {
  slot: string
  time: number
  direction: 'high' | 'low'
  score: number
  sweepAge: SweepAge
  session: Session
  outcome: 'win' | 'loss' | 'breakeven'
  rMultiple: number
}

type SlotResult = {
  slot: string
  symbol: string
  tf: string
  totalSweeps: number
  // Exactement les mêmes stats que le backtest simple
  L: StatBlock
  LF: StatBlock
  LFR: StatBlock
  byScore: Record<number, StatBlock>
  bySweepAge: Record<SweepAge, StatBlock>
  bySession: Record<Session, StatBlock>
  tradesPerYear: number
}

type StatBlock = {
  trades: number
  wins: number
  winRate: number
  avgR: number
  expectancy: number
}

// ─── MÊME LOGIQUE QUE backtest-run ───────────────────────────────────────────

function calcVwap(bars: RawBar[], i: number): number {
  const window = bars.slice(Math.max(0, i - 50), i + 1)
  const totalPV = window.reduce((s, k) => s + ((k.high + k.low + k.close) / 3) * k.volume, 0)
  const totalVol = window.reduce((s, k) => s + k.volume, 0)
  return totalVol > 0 ? totalPV / totalVol : bars[i].close
}

function runBacktestOnBars(bars: RawBar[], slot: string, symbol: string, tf: string): SlotResult {
  const allSweeps: SweepEvent[] = []

  for (let i = 10; i < bars.length - 15; i++) {
    const structure = bars.slice(Math.max(0, i - 80), i)
    if (structure.length < 10) continue

    const candle = bars[i]
    const structureHigh = Math.max(...structure.map(k => k.high))
    const structureLow = Math.min(...structure.map(k => k.low))

    const avgVol = bars.slice(Math.max(0, i - 20), i)
      .reduce((s, k) => s + k.volume, 0) / Math.min(20, i)

    const volMult = avgVol > 0 ? candle.volume / avgVol : 1
    const hasVolume = volMult > 1.5
    const wickThreshold = volMult >= 3 ? 0.3 : 0.6
    const totalSize = candle.high - candle.low
    if (totalSize === 0 || !hasVolume) continue

    const vwap = calcVwap(bars, i)

    let direction: 'high' | 'low' | null = null
    const upperWick = candle.high - Math.max(candle.open, candle.close)
    const lowerWick = Math.min(candle.open, candle.close) - candle.low

    if (candle.high > structureHigh && candle.close < structureHigh && upperWick / totalSize > wickThreshold) {
      direction = 'high'
    } else if (candle.low < structureLow && candle.close > structureLow && lowerWick / totalSize > wickThreshold) {
      direction = 'low'
    }

    if (!direction) continue

    // ── MÊME SCORING QUE backtest-run ──
    let scoreL = 1, scoreF = 0, scoreR = 0

    // F — CVD
    const nextBar = bars[i + 1]
    if (nextBar) {
      if (direction === 'high' && nextBar.close < nextBar.open) scoreF += 1
      if (direction === 'low' && nextBar.close > nextBar.open) scoreF += 1
    }

    // R — VWAP (2pts)
    const checkBars = bars.slice(i + 1, i + 4)
    const vwapReaction = checkBars.some(b =>
      direction === 'high' ? b.close < vwap : b.close > vwap
    )
    if (vwapReaction) scoreR += 2

    // R — Structure (1pt)
    const prev3High = bars[Math.max(0, i - 3)]?.high ?? 0
    const prev3Low = bars[Math.max(0, i - 3)]?.low ?? 0
    const lastHigh = bars[i + 1]?.high ?? 0
    const lastLow = bars[i + 1]?.low ?? 0
    if (direction === 'high' && lastHigh < prev3High) scoreR += 1
    if (direction === 'low' && lastLow > prev3Low) scoreR += 1

    const score = scoreL + scoreF + scoreR

    // Age du sweep
    const confirmBars = bars.slice(i + 1, i + 7)
    const entryBarIndex = confirmBars.findIndex(b =>
      direction === 'high' ? b.close < vwap : b.close > vwap
    )
    const sweepAge = getSweepAge(entryBarIndex >= 0 ? entryBarIndex + 1 : 7)

    // ── MÊME SIMULATION QUE backtest-run — TP 3R ──
    const slPct = 0.002
    const entryPrice = candle.close
    const slPrice = direction === 'high'
      ? structureHigh * (1 + slPct)
      : structureLow * (1 - slPct)
    const risk = Math.abs(entryPrice - slPrice)
    const tpPrice = direction === 'high'
      ? entryPrice - risk * 3
      : entryPrice + risk * 3

    let outcome: 'win' | 'loss' | 'breakeven' = 'breakeven'
    let rMultiple = 0

    for (let j = i + 1; j < Math.min(i + 16, bars.length); j++) {
      const b = bars[j]
      if (direction === 'high') {
        if (b.low <= tpPrice) { outcome = 'win'; rMultiple = 3; break }
        if (b.high >= slPrice) { outcome = 'loss'; rMultiple = -1; break }
      } else {
        if (b.high >= tpPrice) { outcome = 'win'; rMultiple = 3; break }
        if (b.low <= slPrice) { outcome = 'loss'; rMultiple = -1; break }
      }
    }

    allSweeps.push({
      slot, time: candle.time, direction, score,
      sweepAge, session: getSession(candle.time),
      outcome, rMultiple,
    })
  }

  // ── MÊME DÉDUPLICATION QUE backtest-run ──
  const filtered: SweepEvent[] = []
  for (const s of allSweeps) {
    const last = filtered.at(-1)
    if (!last || s.time - last.time > 3 * 4 * 3600) {
      filtered.push(s)
    }
  }

  // ── MÊMES STATS QUE backtest-run ──
  const calcStats = (sweeps: SweepEvent[]): StatBlock => {
    const closed = sweeps.filter(s => s.outcome !== 'breakeven')
    const wins = closed.filter(s => s.outcome === 'win')
    const winRate = closed.length > 0 ? wins.length / closed.length : 0
    const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0
    const expectancy = winRate * 3 - (1 - winRate) * 1
    return {
      trades: closed.length,
      wins: wins.length,
      winRate: Math.round(winRate * 1000) / 10,
      avgR: Math.round(avgR * 100) / 100,
      expectancy: Math.round(expectancy * 1000) / 1000,
    }
  }

  const LF = filtered.filter(s => s.score >= 2)
  const LFR = filtered.filter(s => s.score >= 4)

  const byScore: Record<number, StatBlock> = {}
  for (let sc = 1; sc <= 5; sc++) {
    byScore[sc] = calcStats(filtered.filter(s => s.score === sc))
  }

  const bySweepAge: Record<SweepAge, StatBlock> = {
    fresh: calcStats(filtered.filter(s => s.sweepAge === 'fresh')),
    recent: calcStats(filtered.filter(s => s.sweepAge === 'recent')),
    old: calcStats(filtered.filter(s => s.sweepAge === 'old')),
  }

  const bySession: Record<Session, StatBlock> = {
    Asia: calcStats(filtered.filter(s => s.session === 'Asia')),
    London: calcStats(filtered.filter(s => s.session === 'London')),
    NewYork: calcStats(filtered.filter(s => s.session === 'NewYork')),
    Overlap: calcStats(filtered.filter(s => s.session === 'Overlap')),
  }

  const totalDays = bars.length > 1 ? (bars[bars.length - 1].time - bars[0].time) / 86400 : 365
  const tradesPerYear = Math.round((LFR.length / totalDays) * 365)

  return {
    slot, symbol, tf,
    totalSweeps: filtered.length,
    L: calcStats(filtered),
    LF: calcStats(LF),
    LFR: calcStats(LFR),
    byScore,
    bySweepAge,
    bySession,
    tradesPerYear,
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    type SlotConfig = { slot: string; symbol: string; tf: string; files: string[] }

    const slots: SlotConfig[] = [
      {
        slot: 'BTC-1h', symbol: 'BTC', tf: '1h',
        files: [
          path.join(DATA_DIR, 'backtest-history-btcusdt-1h.json'),
          path.join(DATA_DIR, 'backtest-history-btcusdt.json'), // fallback ancien format
        ]
      },
      {
        slot: 'ETH-1h', symbol: 'ETH', tf: '1h',
        files: [
          path.join(DATA_DIR, 'backtest-history-ethusdt-1h.json'),
          path.join(DATA_DIR, 'backtest-history-ethusdt.json'), // fallback ancien format
        ]
      },
      {
        slot: 'BTC-15m', symbol: 'BTC', tf: '15m',
        files: [path.join(DATA_DIR, 'backtest-history-btcusdt-15m.json')]
      },
      {
        slot: 'ETH-15m', symbol: 'ETH', tf: '15m',
        files: [path.join(DATA_DIR, 'backtest-history-ethusdt-15m.json')]
      },
    ]

    const slotResults: SlotResult[] = []
    const missing: string[] = []
    const allLFR: SweepEvent[] = []

    for (const config of slots) {
      // Trouver le fichier disponible
      const file = config.files.find(f => fs.existsSync(f))
      if (!file) {
        missing.push(config.slot)
        continue
      }

      const bars = JSON.parse(fs.readFileSync(file, 'utf-8')) as RawBar[]
      const result = runBacktestOnBars(bars, config.slot, config.symbol, config.tf)
      slotResults.push(result)

      // Collecter les trades LFR (score >= 4) pour les stats combinées
      // On reconstruit les events pour le combiné
    }

    // Stats combinées — agréger les slotResults
    const allTradesPerYear = slotResults.reduce((s, r) => s + r.tradesPerYear, 0)

    // Combiner les StatBlock LFR de chaque slot
    const combinedTrades = slotResults.reduce((s, r) => s + r.LFR.trades, 0)
    const combinedWins = slotResults.reduce((s, r) => s + r.LFR.wins, 0)
    const combinedWR = combinedTrades > 0 ? combinedWins / combinedTrades : 0
    const combinedAvgR = slotResults.reduce((s, r) => s + r.LFR.avgR * r.LFR.trades, 0) / Math.max(combinedTrades, 1)
    const combinedExpectancy = combinedWR * 3 - (1 - combinedWR) * 1

    // Sessions combinées
    const sessions: Session[] = ['Asia', 'London', 'NewYork', 'Overlap']
    const bySession = sessions.map(session => {
      const totalT = slotResults.reduce((s, r) => s + (r.bySession[session]?.trades ?? 0), 0)
      const totalW = slotResults.reduce((s, r) => s + (r.bySession[session]?.wins ?? 0), 0)
      const wr = totalT > 0 ? Math.round((totalW / totalT) * 1000) / 10 : 0
      return { session, trades: totalT, wins: totalW, winRate: wr }
    })

    // Age combiné
    const ages: SweepAge[] = ['fresh', 'recent', 'old']
    const bySweepAge = ages.map(age => {
      const totalT = slotResults.reduce((s, r) => s + (r.bySweepAge[age]?.trades ?? 0), 0)
      const totalW = slotResults.reduce((s, r) => s + (r.bySweepAge[age]?.wins ?? 0), 0)
      const wr = totalT > 0 ? Math.round((totalW / totalT) * 1000) / 10 : 0
      const avgR = slotResults.reduce((s, r) => s + (r.bySweepAge[age]?.avgR ?? 0) * (r.bySweepAge[age]?.trades ?? 0), 0) / Math.max(totalT, 1)
      return { age, trades: totalT, wins: totalW, winRate: wr, avgR: Math.round(avgR * 100) / 100 }
    })

    // Simulation rendement
    const riskPerTrade = 200
    const annualProfit = Math.round(allTradesPerYear * combinedExpectancy * riskPerTrade)

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      missing,
      slots: slotResults,
      combined: {
        totalTrades: combinedTrades,
        wins: combinedWins,
        winRate: Math.round(combinedWR * 1000) / 10,
        avgR: Math.round(combinedAvgR * 100) / 100,
        expectancy: Math.round(combinedExpectancy * 1000) / 1000,
        tradesPerYear: allTradesPerYear,
        tradesPerMonth: Math.round((allTradesPerYear / 12) * 10) / 10,
        simulation: {
          capital: 10000,
          riskPct: 2,
          riskPerTrade,
          annualProfit,
          annualReturn: Math.round((annualProfit / 10000) * 100),
        }
      },
      bySession,
      bySweepAge,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest combiné'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
