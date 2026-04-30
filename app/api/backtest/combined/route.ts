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

type SlotKey = 'BTC-1h' | 'BTC-15m' | 'ETH-1h' | 'ETH-15m'

type TradeResult = {
  slot: SlotKey
  time: number
  direction: 'high' | 'low'
  score: number
  outcome: 'win' | 'loss' | 'breakeven'
  rMultiple: number
  sweepAge: 'fresh' | 'recent' | 'old'
  session: string
}

type SlotStats = {
  slot: SlotKey
  trades: number
  wins: number
  winRate: number
  avgR: number
  expectancy: number
  tradesPerYear: number
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getSession(ts: number): string {
  const h = new Date(ts * 1000).getUTCHours()
  if (h >= 13 && h < 17) return 'Overlap'
  if (h >= 8 && h < 16) return 'London'
  if (h >= 13 && h < 22) return 'NewYork'
  return 'Asia'
}

function getSweepAge(barsFromSweep: number): 'fresh' | 'recent' | 'old' {
  if (barsFromSweep <= 2) return 'fresh'
  if (barsFromSweep <= 6) return 'recent'
  return 'old'
}

function calcVwap(bars: RawBar[], i: number): number {
  const window = bars.slice(Math.max(0, i - 50), i + 1)
  const totalPV = window.reduce((s, k) => s + ((k.high + k.low + k.close) / 3) * k.volume, 0)
  const totalVol = window.reduce((s, k) => s + k.volume, 0)
  return totalVol > 0 ? totalPV / totalVol : bars[i].close
}

// ─── DETECTION + SIMULATION ──────────────────────────────────────────────────

function runSlot(bars: RawBar[], slot: SlotKey): TradeResult[] {
  const results: TradeResult[] = []
  const COOLDOWN_BARS = slot.includes('1h') ? 4 : 16 // 4h cooldown
  let lastTradedBar = -COOLDOWN_BARS

  for (let i = 10; i < bars.length - 15; i++) {
    // Cooldown
    if (i - lastTradedBar < COOLDOWN_BARS) continue

    const structure = bars.slice(Math.max(0, i - 80), i)
    if (structure.length < 10) continue

    const candle = bars[i]
    const structureHigh = Math.max(...structure.map(k => k.high))
    const structureLow = Math.min(...structure.map(k => k.low))

    const avgVol = bars.slice(Math.max(0, i - 20), i)
      .reduce((s, k) => s + k.volume, 0) / Math.min(20, i)
    const volMult = avgVol > 0 ? candle.volume / avgVol : 1
    if (volMult < 1.5) continue

    const wickThreshold = volMult >= 3 ? 0.3 : 0.6
    const totalSize = candle.high - candle.low
    if (totalSize === 0) continue

    const vwap = calcVwap(bars, i)

    // Détecter sweep
    let direction: 'high' | 'low' | null = null
    const upperWick = candle.high - Math.max(candle.open, candle.close)
    const lowerWick = Math.min(candle.open, candle.close) - candle.low

    if (candle.high > structureHigh && candle.close < structureHigh && upperWick / totalSize > wickThreshold) {
      direction = 'high'
    } else if (candle.low < structureLow && candle.close > structureLow && lowerWick / totalSize > wickThreshold) {
      direction = 'low'
    }

    if (!direction) continue

    // Scorer sur les 2 bougies suivantes (fresh only)
    const confirmBars = bars.slice(i + 1, i + 3)
    if (confirmBars.length < 1) continue

    for (let ci = 0; ci < confirmBars.length; ci++) {
      const cb = confirmBars[ci]
      let score = 1 // L

      // F — CVD
      const nextBar = bars[i + 1]
      if (nextBar) {
        if (direction === 'high' && nextBar.close < nextBar.open) score += 1
        if (direction === 'low' && nextBar.close > nextBar.open) score += 1
      }

      // R — VWAP (2pts)
      if (direction === 'high' && cb.close < vwap) score += 2
      if (direction === 'low' && cb.close > vwap) score += 2

      // R — Structure (1pt)
      const prev3High = bars[Math.max(0, i - 3)]?.high ?? 0
      const prev3Low = bars[Math.max(0, i - 3)]?.low ?? 0
      if (direction === 'high' && cb.high < prev3High) score += 1
      if (direction === 'low' && cb.low > prev3Low) score += 1

      // Ne prendre QUE les 4/5 exactement
      if (score !== 4) continue

      // Distance VWAP <= 0.3%
      const distPct = Math.abs((cb.close - vwap) / vwap) * 100
      if (distPct > 0.3) continue

      // Simuler le trade — TP 3R
      const slPct = 0.002
      const entryPrice = cb.close
      const slPrice = direction === 'high'
        ? candle.high * (1 + slPct)
        : candle.low * (1 - slPct)
      const risk = Math.abs(entryPrice - slPrice)
      const tpPrice = direction === 'high'
        ? entryPrice - risk * 3
        : entryPrice + risk * 3

      let outcome: 'win' | 'loss' | 'breakeven' = 'breakeven'
      let rMultiple = 0

      for (let j = i + ci + 2; j < Math.min(i + ci + 20, bars.length); j++) {
        const b = bars[j]
        if (direction === 'high') {
          if (b.low <= tpPrice) { outcome = 'win'; rMultiple = 3; break }
          if (b.high >= slPrice) { outcome = 'loss'; rMultiple = -1; break }
        } else {
          if (b.high >= tpPrice) { outcome = 'win'; rMultiple = 3; break }
          if (b.low <= slPrice) { outcome = 'loss'; rMultiple = -1; break }
        }
      }

      results.push({
        slot,
        time: cb.time,
        direction,
        score,
        outcome,
        rMultiple,
        sweepAge: getSweepAge(ci + 1),
        session: getSession(cb.time),
      })

      lastTradedBar = i + ci
      break // un seul trade par sweep
    }
  }

  return results
}

function calcSlotStats(trades: TradeResult[], slot: SlotKey, totalDays: number): SlotStats {
  const closed = trades.filter(t => t.outcome !== 'breakeven')
  const wins = closed.filter(t => t.outcome === 'win')
  const winRate = closed.length > 0 ? wins.length / closed.length : 0
  const avgR = closed.length > 0 ? closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length : 0
  const expectancy = winRate * 3 - (1 - winRate) * 1
  return {
    slot,
    trades: closed.length,
    wins: wins.length,
    winRate: Math.round(winRate * 1000) / 10,
    avgR: Math.round(avgR * 100) / 100,
    expectancy: Math.round(expectancy * 1000) / 1000,
    tradesPerYear: Math.round((closed.length / totalDays) * 365),
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Charger les 4 fichiers historiques
    const slotFiles: Record<SlotKey, string> = {
      'BTC-1h':  path.join(DATA_DIR, 'backtest-history-btcusdt-1h.json'),
      'BTC-15m': path.join(DATA_DIR, 'backtest-history-btcusdt-15m.json'),
      'ETH-1h':  path.join(DATA_DIR, 'backtest-history-ethusdt-1h.json'),
      'ETH-15m': path.join(DATA_DIR, 'backtest-history-ethusdt-15m.json'),
    }

    // Fallbacks sur les anciens fichiers collectés avant la mise à jour
    const fallbacks: Partial<Record<SlotKey, string>> = {
      'BTC-1h': path.join(DATA_DIR, 'backtest-history-btcusdt.json'),
      'ETH-1h': path.join(DATA_DIR, 'backtest-history-ethusdt.json'),
    }

    const allTrades: TradeResult[] = []
    const slotStats: SlotStats[] = []
    const missing: SlotKey[] = []

    for (const [slot, file] of Object.entries(slotFiles) as [SlotKey, string][]) {
      const fileToUse = fs.existsSync(file) ? file
        : (fallbacks[slot] && fs.existsSync(fallbacks[slot]!)) ? fallbacks[slot]!
        : null

      if (!fileToUse) {
        missing.push(slot)
        continue
      }

      const bars = JSON.parse(fs.readFileSync(fileToUse, 'utf-8')) as RawBar[]
      const trades = runSlot(bars, slot)
      allTrades.push(...trades)

      const totalDays = bars.length > 1
        ? (bars[bars.length - 1].time - bars[0].time) / 86400
        : 365

      slotStats.push(calcSlotStats(trades, slot, totalDays))
    }

    // Stats combinées
    const allClosed = allTrades.filter(t => t.outcome !== 'breakeven')
    const allWins = allClosed.filter(t => t.outcome === 'win')
    const combinedWR = allClosed.length > 0 ? allWins.length / allClosed.length : 0
    const combinedAvgR = allClosed.length > 0 ? allClosed.reduce((s, t) => s + t.rMultiple, 0) / allClosed.length : 0
    const combinedExpectancy = combinedWR * 3 - (1 - combinedWR) * 1
    const totalDaysAll = 730 // 2 ans

    // Par session combinée
    const sessions = ['Asia', 'London', 'NewYork', 'Overlap']
    const bySession = sessions.map(s => {
      const st = allClosed.filter(t => t.session === s)
      const w = st.filter(t => t.outcome === 'win')
      const wr = st.length > 0 ? w.length / st.length : 0
      return { session: s, trades: st.length, winRate: Math.round(wr * 1000) / 10 }
    })

    // Simulation rendement
    const riskPerTrade = 200 // 200€ de risque par trade (2% sur 10 000€)
    const annualTrades = Math.round((allClosed.length / totalDaysAll) * 365)
    const annualProfit = Math.round(annualTrades * combinedExpectancy * riskPerTrade)

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      missing,
      // Stats par slot
      slots: slotStats,
      // Stats combinées
      combined: {
        totalTrades: allClosed.length,
        wins: allWins.length,
        winRate: Math.round(combinedWR * 1000) / 10,
        avgR: Math.round(combinedAvgR * 100) / 100,
        expectancy: Math.round(combinedExpectancy * 1000) / 1000,
        tradesPerYear: annualTrades,
        tradesPerMonth: Math.round(annualTrades / 12 * 10) / 10,
        // Simulation rendement
        simulation: {
          capital: 10000,
          riskPct: 2,
          riskPerTrade,
          annualProfit,
          annualReturn: Math.round((annualProfit / 10000) * 100),
        }
      },
      bySession,
      // Tous les trades pour analyse
      trades: allTrades.slice(-100),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest combiné'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
