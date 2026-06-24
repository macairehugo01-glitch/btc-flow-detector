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

// ─── SEUILS PAR DÉFAUT (valeurs d'origine — jamais mutées, juste lues) ───────
const DEFAULT_RR = 3
const DEFAULT_COOLDOWN_BARS = 12
const DEFAULT_TTL_BARS = 8
const DEFAULT_DOMINANCE_MIN = 0.5
const DEFAULT_IMPULSE_ATR_MULT = 1.3

const LOOKBACK_BARS = 5
const ATR_PERIOD = 14
const OI_DROP_PCT = 1.5
const CONFIRM_BARS = 2
const VWAP_WINDOW = 50
const SL_BUFFER_PCT = 0.002
const MAX_BARS_TO_RESOLVE = 16

// ─── TYPES ───────────────────────────────────────────────────────────────────

type SqueezeDirection = 'up' | 'down'
type SqueezeOutcome = 'win' | 'loss' | 'breakeven' | 'no_confirmation'

type SqueezeEvent = {
  triggerTime: number
  direction: SqueezeDirection
  priceMovePct: number
  oiChangePct: number
  dominance: number
  atrAtTrigger: number
  confirmed: boolean
  barsToConfirm?: number
  action?: 'BUY' | 'SELL'
  entryPrice?: number
  slPrice?: number
  tpPrice?: number
  outcome: SqueezeOutcome
  rMultiple: number
  barsToClose?: number
}

type StatBlock = { trades: number; wins: number; winRate: number; avgR: number; expectancy: number }

type SqueezeBacktestResults = {
  generatedAt: string
  symbol: string
  timeframe: string
  paramsUsed: { rr: number; cooldown: number; ttl: number; dom: number; atrMult: number }
  totalBars: number
  totalTriggers: number
  totalConfirmed: number
  confirmationRatePct: number
  overall: StatBlock
  byDirection: {
    up_to_sell: StatBlock
    down_to_buy: StatBlock
  }
  events: SqueezeEvent[]
}

// ─── CALCULS ─────────────────────────────────────────────────────────────────

function trueRange(curr: RawBar, prev: RawBar | undefined): number {
  if (!prev) return curr.high - curr.low
  return Math.max(
    curr.high - curr.low,
    Math.abs(curr.high - prev.close),
    Math.abs(curr.low - prev.close)
  )
}

function computeATR(bars: RawBar[], period: number): number[] {
  const atr = new Array(bars.length).fill(0)
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    const tr = trueRange(bars[i], bars[i - 1])
    if (i < period) {
      sum += tr
      atr[i] = sum / (i + 1)
    } else {
      atr[i] = (atr[i - 1] * (period - 1) + tr) / period
    }
  }
  return atr
}

function computeVWAPAt(bars: RawBar[], i: number): number {
  const window = bars.slice(Math.max(0, i - VWAP_WINDOW), i + 1)
  let pv = 0, vol = 0
  for (const b of window) {
    const typical = (b.high + b.low + b.close) / 3
    pv += typical * b.volume
    vol += b.volume
  }
  return vol > 0 ? pv / vol : bars[i].close
}

function deltaDominanceOverWindow(bars: RawBar[], startIdx: number, endIdx: number): number {
  let netVol = 0, grossVol = 0
  for (let i = startIdx; i <= endIdx; i++) {
    const b = bars[i]
    const sign = b.close > b.open ? 1 : b.close < b.open ? -1 : 0
    netVol += sign * b.volume
    grossVol += b.volume
  }
  return grossVol > 0 ? netVol / grossVol : 0
}

type Trigger = {
  triggerIdx: number
  time: number
  direction: SqueezeDirection
  priceMove: number
  priceMovePct: number
  oiChangePct: number
  dominance: number
  atrAtTrigger: number
}

function detectSqueezeAt(
  bars: RawBar[],
  atr: number[],
  i: number,
  deltaDominanceMin: number,
  impulseAtrMult: number
): Trigger | null {
  const startIdx = i - LOOKBACK_BARS + 1
  if (startIdx < ATR_PERIOD) return null

  const startBar = bars[startIdx]
  const endBar = bars[i]

  const priceMove = endBar.close - startBar.close
  const impulseOk = Math.abs(priceMove) > impulseAtrMult * atr[i]
  if (!impulseOk) return null

  const oiStart = startBar.oi
  const oiEnd = endBar.oi
  if (!oiStart || oiStart <= 0) return null
  const oiChangePct = ((oiEnd - oiStart) / oiStart) * 100
  const oiDropOk = oiChangePct <= -OI_DROP_PCT
  if (!oiDropOk) return null

  const dominance = deltaDominanceOverWindow(bars, startIdx, i)
  const direction: SqueezeDirection = priceMove > 0 ? 'up' : 'down'

  if (direction === 'up' && dominance < deltaDominanceMin) return null
  if (direction === 'down' && dominance > -deltaDominanceMin) return null

  return {
    triggerIdx: i,
    time: endBar.time,
    direction,
    priceMove,
    priceMovePct: (priceMove / startBar.close) * 100,
    oiChangePct,
    dominance,
    atrAtTrigger: atr[i],
  }
}

function resolveSqueezeTrade(
  bars: RawBar[],
  trigger: Trigger,
  ttlBars: number,
  rr: number
): SqueezeEvent {
  const i = trigger.triggerIdx
  const windowStart = i - LOOKBACK_BARS + 1
  const windowBars = bars.slice(windowStart, i + 1)
  const windowHigh = Math.max(...windowBars.map(b => b.high))
  const windowLow = Math.min(...windowBars.map(b => b.low))

  let consecutiveCount = 0
  let confirmBarIdx = -1

  for (let j = i + 1; j < Math.min(i + 1 + ttlBars, bars.length); j++) {
    const vwapJ = computeVWAPAt(bars, j)
    const closeJ = bars[j].close
    const onOppositeSide = trigger.direction === 'up' ? closeJ < vwapJ : closeJ > vwapJ

    if (onOppositeSide) {
      consecutiveCount++
      if (consecutiveCount >= CONFIRM_BARS) {
        confirmBarIdx = j
        break
      }
    } else {
      consecutiveCount = 0
    }
  }

  const base = {
    triggerTime: trigger.time,
    direction: trigger.direction,
    priceMovePct: Math.round(trigger.priceMovePct * 1000) / 1000,
    oiChangePct: Math.round(trigger.oiChangePct * 1000) / 1000,
    dominance: Math.round(trigger.dominance * 1000) / 1000,
    atrAtTrigger: trigger.atrAtTrigger,
  }

  if (confirmBarIdx === -1) {
    return { ...base, confirmed: false, outcome: 'no_confirmation', rMultiple: 0 }
  }

  const action: 'BUY' | 'SELL' = trigger.direction === 'up' ? 'SELL' : 'BUY'
  const entryPrice = bars[confirmBarIdx].close

  const slPrice = action === 'SELL'
    ? windowHigh * (1 + SL_BUFFER_PCT)
    : windowLow * (1 - SL_BUFFER_PCT)

  const risk = Math.abs(entryPrice - slPrice)
  const tpPrice = action === 'SELL' ? entryPrice - risk * rr : entryPrice + risk * rr

  let outcome: SqueezeOutcome = 'breakeven'
  let rMultiple = 0
  let barsToClose = 0

  for (let j = confirmBarIdx + 1; j < Math.min(confirmBarIdx + 1 + MAX_BARS_TO_RESOLVE, bars.length); j++) {
    const b = bars[j]
    barsToClose = j - confirmBarIdx
    if (action === 'SELL') {
      if (b.low <= tpPrice) { outcome = 'win'; rMultiple = rr; break }
      if (b.high >= slPrice) { outcome = 'loss'; rMultiple = -1; break }
    } else {
      if (b.high >= tpPrice) { outcome = 'win'; rMultiple = rr; break }
      if (b.low <= slPrice) { outcome = 'loss'; rMultiple = -1; break }
    }
  }

  return {
    ...base,
    confirmed: true,
    barsToConfirm: confirmBarIdx - i,
    action,
    entryPrice,
    slPrice,
    tpPrice,
    outcome,
    rMultiple,
    barsToClose,
  }
}

function calcStats(events: SqueezeEvent[], rr: number): StatBlock {
  const closed = events.filter(e => e.outcome === 'win' || e.outcome === 'loss')
  const wins = closed.filter(e => e.outcome === 'win')
  const winRate = closed.length > 0 ? wins.length / closed.length : 0
  const avgR = closed.length > 0 ? closed.reduce((s, e) => s + e.rMultiple, 0) / closed.length : 0
  const expectancy = winRate * rr - (1 - winRate) * 1
  return {
    trades: closed.length,
    wins: wins.length,
    winRate: Math.round(winRate * 1000) / 10,
    avgR: Math.round(avgR * 1000) / 1000,
    expectancy: Math.round(expectancy * 1000) / 1000,
  }
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()
  const tf = url.searchParams.get('tf') ?? '1h'

  // Tous les paramètres sont résolus en variables LOCALES à cette requête —
  // aucune mutation d'état partagé entre requêtes (fix du bug dom=0).
  const rrRaw = url.searchParams.get('rr')
  const RR = (rrRaw !== null && Number(rrRaw) > 0) ? Number(rrRaw) : DEFAULT_RR

  const cooldownRaw = url.searchParams.get('cooldown')
  const COOLDOWN_BARS_AFTER_TRIGGER = (cooldownRaw !== null && Number(cooldownRaw) >= 0)
    ? Number(cooldownRaw)
    : DEFAULT_COOLDOWN_BARS

  const ttlRaw = url.searchParams.get('ttl')
  const SQUEEZE_TTL_BARS = (ttlRaw !== null && Number(ttlRaw) > 0) ? Number(ttlRaw) : DEFAULT_TTL_BARS

  const domRaw = url.searchParams.get('dom')
  const DELTA_DOMINANCE_MIN = (domRaw !== null && Number(domRaw) >= 0 && Number(domRaw) < 1)
    ? Number(domRaw)
    : DEFAULT_DOMINANCE_MIN

  const atrMultRaw = url.searchParams.get('atrMult')
  const IMPULSE_ATR_MULT = (atrMultRaw !== null && Number(atrMultRaw) > 0)
    ? Number(atrMultRaw)
    : DEFAULT_IMPULSE_ATR_MULT

  const allowed = ['BTCUSDT', 'ETHUSDT']
  if (!allowed.includes(symbol)) {
    return NextResponse.json({ error: `Symbole non supporté: ${symbol}` }, { status: 400 })
  }

  const HISTORY_FILE = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-${tf}.json`)
  const FALLBACK_FILE = path.join(DATA_DIR, 'backtest-history.json')
  const fileToUse = fs.existsSync(HISTORY_FILE) ? HISTORY_FILE
    : (symbol === 'BTCUSDT' && tf === '1h' && fs.existsSync(FALLBACK_FILE)) ? FALLBACK_FILE
    : null

  if (!fileToUse) {
    return NextResponse.json(
      { error: `Données ${symbol} ${tf} manquantes. Lance /api/backtest/collect?symbol=${symbol}&tf=${tf} d'abord.` },
      { status: 400 }
    )
  }

  try {
    const bars: RawBar[] = JSON.parse(fs.readFileSync(fileToUse, 'utf-8'))
    const atr = computeATR(bars, ATR_PERIOD)

    const triggers: Trigger[] = []
    let lastTriggerIdx = -Infinity

    for (let i = ATR_PERIOD + LOOKBACK_BARS; i < bars.length - SQUEEZE_TTL_BARS - MAX_BARS_TO_RESOLVE; i++) {
      if (i - lastTriggerIdx < COOLDOWN_BARS_AFTER_TRIGGER) continue
      const trigger = detectSqueezeAt(bars, atr, i, DELTA_DOMINANCE_MIN, IMPULSE_ATR_MULT)
      if (trigger) {
        triggers.push(trigger)
        lastTriggerIdx = i
      }
    }

    const events = triggers.map(t => resolveSqueezeTrade(bars, t, SQUEEZE_TTL_BARS, RR))
    const confirmed = events.filter(e => e.confirmed)

    const results: SqueezeBacktestResults = {
      generatedAt: new Date().toISOString(),
      symbol,
      timeframe: tf,
      paramsUsed: { rr: RR, cooldown: COOLDOWN_BARS_AFTER_TRIGGER, ttl: SQUEEZE_TTL_BARS, dom: DELTA_DOMINANCE_MIN, atrMult: IMPULSE_ATR_MULT },
      totalBars: bars.length,
      totalTriggers: triggers.length,
      totalConfirmed: confirmed.length,
      confirmationRatePct: triggers.length > 0
        ? Math.round((confirmed.length / triggers.length) * 1000) / 10
        : 0,
      overall: calcStats(events, RR),
      byDirection: {
        up_to_sell: calcStats(events.filter(e => e.direction === 'up'), RR),
        down_to_buy: calcStats(events.filter(e => e.direction === 'down'), RR),
      },
      events: events.slice(-300),
    }

    const RESULTS_FILE = path.join(DATA_DIR, `squeeze-backtest-results-${symbol.toLowerCase()}-${tf}.json`)
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8')

    return NextResponse.json(results)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest squeeze'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
