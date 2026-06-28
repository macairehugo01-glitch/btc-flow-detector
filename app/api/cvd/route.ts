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
  openPosition,
  type SlotKey,
} from '../../../store'
import {
  loadOIBuffer,
  saveOIBuffer,
  loadSqueezeState,
  saveSqueezeState,
  loadDailyRegimeCache,
  saveDailyRegimeCache,
  type SqueezeDetectorState,
} from '../../../journalPersistence'

export const dynamic = 'force-dynamic'

// ─── CONFIG DES 4 SLOTS ──────────────────────────────────────────────────────
// BTC/ETH/SOL : UP→SELL filtré par régime Dow daily (edge principal,
// rigoureusement validé sur l'ensemble de la session de backtest).
// XRP : DOWN→BUY, SANS filtre de régime — son comportement s'est avéré
// inversé par rapport aux 3 autres actifs (UP→SELL y était perdant), et
// DOWN→BUY y était positif dans les DEUX régimes daily, donc le régime n'y
// joue pas le même rôle discriminant. Cet edge XRP est moins rigoureusement
// validé (découvert en cours d'analyse, pas optimisé indépendamment) — à
// surveiller plus attentivement que les 3 autres une fois en production.

type SlotConfig = {
  slot: SlotKey
  symbol: string
  direction: 'up' | 'down'
  regimeFiltered: boolean
}

const SLOT_CONFIGS: SlotConfig[] = [
  { slot: 'BTC-1h', symbol: 'BTCUSDT', direction: 'up',   regimeFiltered: true },
  { slot: 'ETH-1h', symbol: 'ETHUSDT', direction: 'up',   regimeFiltered: true },
  { slot: 'SOL-1h', symbol: 'SOLUSDT', direction: 'up',   regimeFiltered: true },
  { slot: 'XRP-1h', symbol: 'XRPUSDT', direction: 'down', regimeFiltered: false },
]

const ALL_SLOTS: SlotKey[] = SLOT_CONFIGS.map(c => c.slot)

// ─── PARAMÈTRES VERROUILLÉS DE LA STRATÉGIE (validés sur l'ensemble de la
// session de backtest BTC/ETH/SOL) ───────────────────────────────────────────

const COOLDOWN_HOURS = 12
const TTL_BARS = 8
const RR_UP = 1.5
const RR_DOWN = 1.5
const DOM_UP = 0.5
const DOM_DOWN = 0.5
const ATR_MULT_UP = 0.8
const ATR_MULT_DOWN = 0.5
const OI_DROP_PCT = 1.0
const LOOKBACK_BARS = 5
const ATR_PERIOD = 14
const VWAP_WINDOW = 50
const CONFIRM_BARS = 2
const SL_BUFFER_PCT = 0.002
const SWING_LOOKBACK_DAILY = 20
const DAILY_FETCH_LIMIT = 200
const REGIME_REFRESH_MS = 60 * 60 * 1000 // le régime change rarement — pas besoin de refetch à chaque poll 10s

// ─── OI BUFFERS (un par slot) ─────────────────────────────────────────────────

type OIBar = { time: number; openInterest: number }

const MAX_OI_POINTS = 500
const oiBuffers: Record<SlotKey, OIBar[]> = {
  'BTC-1h': loadOIBuffer('BTC-1h'),
  'ETH-1h': loadOIBuffer('ETH-1h'),
  'SOL-1h': loadOIBuffer('SOL-1h'),
  'XRP-1h': loadOIBuffer('XRP-1h'),
}
const oiHistoryLoaded: Record<SlotKey, boolean> = {
  'BTC-1h': false, 'ETH-1h': false, 'SOL-1h': false, 'XRP-1h': false,
}

// ─── HELPERS GÉNÉRIQUES (conservés depuis l'ancienne version) ──────────────

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

// Correctif : la version précédente appelait fetchOIHistory(oiInterval, 200)
// SANS jamais passer le symbole → il retombait toujours sur BTCUSDT par
// défaut, donc le buffer OI d'ETH (et maintenant SOL/XRP) se serait rempli
// au démarrage avec l'historique OI de BTC. Corrigé ici en passant le bon
// symbole explicitement.
async function initOIBuffer(slot: SlotKey, symbol: string, oiInterval: string) {
  if (oiHistoryLoaded[slot] && oiBuffers[slot].length >= 10) return
  oiHistoryLoaded[slot] = true
  try {
    const history = await fetchOIHistory(oiInterval, 200, symbol)
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

// ─── MATHS DE LA STRATÉGIE SQUEEZE (mêmes formules que le moteur de
// backtest squeeze/route.ts du repo de backtest — dupliquées ici pour
// rester autonome ; si un seuil change là-bas, le refléter ici aussi) ──────

type MergedBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  oi: number
}

type DailyBar = { time: number; high: number; low: number }
type TrendRegime = 'up' | 'down' | 'undefined'

function trueRange(curr: MergedBar, prev: MergedBar | undefined): number {
  if (!prev) return curr.high - curr.low
  return Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close))
}

function computeATR(bars: MergedBar[], period: number): number[] {
  const atr = new Array(bars.length).fill(0)
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    const tr = trueRange(bars[i], bars[i - 1])
    if (i < period) { sum += tr; atr[i] = sum / (i + 1) }
    else { atr[i] = (atr[i - 1] * (period - 1) + tr) / period }
  }
  return atr
}

function computeRollingVWAPAt(bars: MergedBar[], i: number, vwapWindow: number): number {
  const window = bars.slice(Math.max(0, i - vwapWindow), i + 1)
  let pv = 0, vol = 0
  for (const b of window) {
    const typical = (b.high + b.low + b.close) / 3
    pv += typical * b.volume
    vol += b.volume
  }
  return vol > 0 ? pv / vol : bars[i].close
}

function deltaDominanceOverWindow(bars: MergedBar[], startIdx: number, endIdx: number): number {
  let netVol = 0, grossVol = 0
  for (let i = startIdx; i <= endIdx; i++) {
    const b = bars[i]
    const sign = b.close > b.open ? 1 : b.close < b.open ? -1 : 0
    netVol += sign * b.volume
    grossVol += b.volume
  }
  return grossVol > 0 ? netVol / grossVol : 0
}

type SwingPoint = { idx: number; price: number; confirmedAt: number }

function computeSwingPoints(bars: DailyBar[], lookback: number): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = []
  const lows: SwingPoint[] = []
  for (let i = lookback; i < bars.length - lookback; i++) {
    const windowBars = bars.slice(i - lookback, i + lookback + 1)
    const maxHigh = Math.max(...windowBars.map(b => b.high))
    const minLow = Math.min(...windowBars.map(b => b.low))
    if (bars[i].high === maxHigh) highs.push({ idx: i, price: bars[i].high, confirmedAt: i + lookback })
    if (bars[i].low === minLow) lows.push({ idx: i, price: bars[i].low, confirmedAt: i + lookback })
  }
  return { highs, lows }
}

function computeDowTrendLabels(bars: DailyBar[], highs: SwingPoint[], lows: SwingPoint[]): TrendRegime[] {
  const labels: TrendRegime[] = new Array(bars.length).fill('undefined')
  type SwingEvent = { confirmedAt: number; type: 'high' | 'low'; point: SwingPoint }
  const events: SwingEvent[] = [
    ...highs.map(h => ({ confirmedAt: h.confirmedAt, type: 'high' as const, point: h })),
    ...lows.map(l => ({ confirmedAt: l.confirmedAt, type: 'low' as const, point: l })),
  ].sort((a, b) => a.confirmedAt - b.confirmedAt)

  let lastHigh: SwingPoint | null = null, prevHigh: SwingPoint | null = null
  let lastLow: SwingPoint | null = null, prevLow: SwingPoint | null = null
  let currentTrend: TrendRegime = 'undefined'
  let filledUpTo = 0

  for (const ev of events) {
    const fillEnd = Math.min(ev.confirmedAt, bars.length)
    for (let i = filledUpTo; i < fillEnd; i++) labels[i] = currentTrend
    filledUpTo = fillEnd
    if (ev.type === 'high') { prevHigh = lastHigh; lastHigh = ev.point } else { prevLow = lastLow; lastLow = ev.point }
    if (lastHigh && prevHigh && lastLow && prevLow) {
      const higherHigh = lastHigh.price > prevHigh.price
      const higherLow = lastLow.price > prevLow.price
      const lowerHigh = lastHigh.price < prevHigh.price
      const lowerLow = lastLow.price < prevLow.price
      if (higherHigh && higherLow) currentTrend = 'up'
      else if (lowerHigh && lowerLow) currentTrend = 'down'
      // signal mixte → la tendance en cours continue, inchangée
    }
  }
  for (let i = filledUpTo; i < bars.length; i++) labels[i] = currentTrend
  return labels
}

function regimeTrendAtTime(dailyBars: DailyBar[], dailyTrendLabels: TrendRegime[], time: number): TrendRegime {
  let lo = 0, hi = dailyBars.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (dailyBars[mid].time <= time) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans === -1 ? 'undefined' : dailyTrendLabels[ans]
}

type Trigger = { time: number; priceMovePct: number; oiChangePct: number; dominance: number }

// Détection UP — BTC/ETH/SOL, edge principal validé.
function detectUpSqueezeAt(bars: MergedBar[], atr: number[], i: number): Trigger | null {
  const startIdx = i - LOOKBACK_BARS + 1
  if (startIdx < ATR_PERIOD) return null
  const startBar = bars[startIdx]
  const endBar = bars[i]
  const priceMove = endBar.close - startBar.close
  if (priceMove <= 0) return null
  const priceMovePct = (priceMove / startBar.close) * 100
  if (priceMove <= ATR_MULT_UP * atr[i]) return null
  const oiStart = startBar.oi
  const oiEnd = endBar.oi
  if (!oiStart || oiStart <= 0) return null
  const oiChangePct = ((oiEnd - oiStart) / oiStart) * 100
  if (oiChangePct > -OI_DROP_PCT) return null
  const dominance = deltaDominanceOverWindow(bars, startIdx, i)
  if (dominance < DOM_UP) return null
  return { time: endBar.time, priceMovePct, oiChangePct, dominance }
}

// Détection DOWN — XRP uniquement, edge moins rigoureusement validé
// (découvert en cours d'analyse, jamais optimisé indépendamment comme
// BTC/ETH/SOL). Miroir exact de detectUpSqueezeAt.
function detectDownSqueezeAt(bars: MergedBar[], atr: number[], i: number): Trigger | null {
  const startIdx = i - LOOKBACK_BARS + 1
  if (startIdx < ATR_PERIOD) return null
  const startBar = bars[startIdx]
  const endBar = bars[i]
  const priceMove = endBar.close - startBar.close
  if (priceMove >= 0) return null
  const priceMovePct = (priceMove / startBar.close) * 100
  if (Math.abs(priceMove) <= ATR_MULT_DOWN * atr[i]) return null
  const oiStart = startBar.oi
  const oiEnd = endBar.oi
  if (!oiStart || oiStart <= 0) return null
  const oiChangePct = ((oiEnd - oiStart) / oiStart) * 100
  if (oiChangePct > -OI_DROP_PCT) return null
  const dominance = deltaDominanceOverWindow(bars, startIdx, i)
  if (dominance > -DOM_DOWN) return null
  return { time: endBar.time, priceMovePct, oiChangePct, dominance }
}

// ─── RÉGIME DOW DAILY (caché, rafraîchi au maximum 1x/heure par symbole) ────

async function getDailyRegime(symbol: string): Promise<{ dailyBars: DailyBar[]; trendLabels: TrendRegime[] }> {
  const cached = loadDailyRegimeCache(symbol)
  if (cached && Date.now() - cached.fetchedAt < REGIME_REFRESH_MS) {
    return { dailyBars: cached.dailyBars, trendLabels: cached.trendLabels }
  }
  const dailyKlines = await fetchKlines(symbol, 'D', DAILY_FETCH_LIMIT)
  const dailyBarsFull: DailyBar[] = dailyKlines.map(k => ({ time: k.time, high: k.high, low: k.low }))
  const { highs, lows } = computeSwingPoints(dailyBarsFull, SWING_LOOKBACK_DAILY)
  const trendLabels = computeDowTrendLabels(dailyBarsFull, highs, lows)
  saveDailyRegimeCache({ fetchedAt: Date.now(), dailyBars: dailyBarsFull, trendLabels }, symbol)
  return { dailyBars: dailyBarsFull, trendLabels }
}

// ─── LOG CSV DES SIGNAUX ─────────────────────────────────────────────────────

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const SIGNAL_LOG = path.join(DATA_DIR, 'signal-log.csv')

function logSignalCSV(row: {
  time: string
  slot: string
  action: string
  daily_regime: string
  pending_trigger: boolean
  bars_waited: number
  trade_taken: boolean
  price: number
  vwap: number
  oi_change_pct: number
  dominance: number
  funding_rate: number
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

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────

type SlotSignalResult = {
  action: 'BUY' | 'SELL' | 'STABLE'
  reasons: string[]
  vwap: number
  dailyRegime: TrendRegime
  pendingTrigger: { triggerTime: number; barsWaited: number; consecutiveCount: number } | null
  metrics: { priceVsVwapPct: number; oiChangePct: number; dominance: number; fundingRate: number }
}

export async function GET(req: NextRequest) {
  const weekend = isWeekend()

  try {
    const [btcKlines, ethKlines, solKlines, xrpKlines] = await Promise.all([
      fetchKlines('BTCUSDT', '60', 200),
      fetchKlines('ETHUSDT', '60', 200),
      fetchKlines('SOLUSDT', '60', 200),
      fetchKlines('XRPUSDT', '60', 200),
    ])
    const [btcOI, ethOI, solOI, xrpOI] = await Promise.all([
      fetchCurrentOI('BTCUSDT', '1h'),
      fetchCurrentOI('ETHUSDT', '1h'),
      fetchCurrentOI('SOLUSDT', '1h'),
      fetchCurrentOI('XRPUSDT', '1h'),
    ])
    const [btcTicker, ethTicker, solTicker, xrpTicker] = await Promise.all([
      fetchTicker('BTCUSDT'),
      fetchTicker('ETHUSDT'),
      fetchTicker('SOLUSDT'),
      fetchTicker('XRPUSDT'),
    ])
    const [btcFunding, ethFunding, solFunding, xrpFunding] = await Promise.all([
      fetchFundingRate('BTCUSDT'),
      fetchFundingRate('ETHUSDT'),
      fetchFundingRate('SOLUSDT'),
      fetchFundingRate('XRPUSDT'),
    ])

    await Promise.all([
      initOIBuffer('BTC-1h', 'BTCUSDT', '1h'),
      initOIBuffer('ETH-1h', 'ETHUSDT', '1h'),
      initOIBuffer('SOL-1h', 'SOLUSDT', '1h'),
      initOIBuffer('XRP-1h', 'XRPUSDT', '1h'),
    ])
    pushOiSnapshot('BTC-1h', btcOI)
    pushOiSnapshot('ETH-1h', ethOI)
    pushOiSnapshot('SOL-1h', solOI)
    pushOiSnapshot('XRP-1h', xrpOI)

    const slotRaw: Record<SlotKey, {
      symbol: string
      klines: typeof btcKlines
      ticker: typeof btcTicker
      funding: typeof btcFunding
    }> = {
      'BTC-1h': { symbol: 'BTCUSDT', klines: btcKlines, ticker: btcTicker, funding: btcFunding },
      'ETH-1h': { symbol: 'ETHUSDT', klines: ethKlines, ticker: ethTicker, funding: ethFunding },
      'SOL-1h': { symbol: 'SOLUSDT', klines: solKlines, ticker: solTicker, funding: solFunding },
      'XRP-1h': { symbol: 'XRPUSDT', klines: xrpKlines, ticker: xrpTicker, funding: xrpFunding },
    }

    const slotSignals: Record<SlotKey, SlotSignalResult> = {} as Record<SlotKey, SlotSignalResult>

    for (const config of SLOT_CONFIGS) {
      const { slot, symbol, direction, regimeFiltered } = config
      const { klines, funding } = slotRaw[slot]

      // Évaluer les positions ouvertes (SL/TP) — générique, inchangé
      evaluateOpenSetups(klines, slot)

      const oiSeries = buildOiSeriesForKlines(slot, klines)
      const bars: MergedBar[] = klines.map((k, i) => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
        oi: oiSeries[i]?.openInterest ?? 0,
      }))
      const atr = computeATR(bars, ATR_PERIOD)
      // Le régime est calculé pour tous les slots (affichage), mais ne
      // filtre la décision de trade que si regimeFiltered=true (XRP en est
      // exclu — voir le commentaire sur SLOT_CONFIGS plus haut).
      const regime = await getDailyRegime(symbol)
      const state: SqueezeDetectorState = loadSqueezeState(slot)

      // On ne traite QUE les bougies plus récentes que la dernière déjà vue
      // — essentiel ici car ce endpoint est interrogé toutes les 10s par le
      // frontend, alors qu'une bougie H1 ne change qu'une fois par heure.
      // Sans cette garde, la confirmation VWAP (qui doit prendre 2 BOUGIES,
      // soit 2h) se déclencherait en quelques secondes au lieu de 2 heures.
      const startIdx = bars.findIndex(b => b.time > state.lastBarTimeProcessed)
      const indices: number[] = startIdx === -1 ? [] : bars.slice(startIdx).map((_, k) => startIdx + k)

      let fired: { action: 'BUY' | 'SELL'; entryPrice: number; stopLoss: number; takeProfit: number; vwap: number; triggerTime: number } | null = null

      for (const i of indices) {
        const bar = bars[i]

        if (state.pendingTrigger) {
          const vwapJ = computeRollingVWAPAt(bars, i, VWAP_WINDOW)
          // UP→SELL : on attend un close SOUS la VWAP. DOWN→BUY (XRP) :
          // on attend un close AU-DESSUS de la VWAP (reclaim).
          const onOppositeSide = direction === 'up' ? bar.close < vwapJ : bar.close > vwapJ
          if (onOppositeSide) {
            state.pendingTrigger.consecutiveCount++
            if (state.pendingTrigger.consecutiveCount >= CONFIRM_BARS) {
              const entryPrice = bar.close
              const stopLoss = direction === 'up'
                ? state.pendingTrigger.windowHigh * (1 + SL_BUFFER_PCT)
                : state.pendingTrigger.windowLow * (1 - SL_BUFFER_PCT)
              const risk = Math.abs(entryPrice - stopLoss)
              const rr = direction === 'up' ? RR_UP : RR_DOWN
              const takeProfit = direction === 'up' ? entryPrice - risk * rr : entryPrice + risk * rr
              fired = {
                action: direction === 'up' ? 'SELL' : 'BUY',
                entryPrice, stopLoss, takeProfit, vwap: vwapJ,
                triggerTime: state.pendingTrigger.triggerTime,
              }
              state.pendingTrigger = null
            }
          } else {
            state.pendingTrigger.consecutiveCount = 0
          }
          if (state.pendingTrigger) {
            state.pendingTrigger.barsWaited++
            if (state.pendingTrigger.barsWaited >= TTL_BARS) state.pendingTrigger = null
          }
        }

        const hoursSinceLastTrigger = (bar.time - state.lastTriggerTime) / 3600
        if (!state.pendingTrigger && hoursSinceLastTrigger >= COOLDOWN_HOURS) {
          const trigger = direction === 'up'
            ? detectUpSqueezeAt(bars, atr, i)
            : detectDownSqueezeAt(bars, atr, i)
          if (trigger) {
            const trend = regimeTrendAtTime(regime.dailyBars, regime.trendLabels, trigger.time)
            // BTC/ETH/SOL (regimeFiltered=true) : il faut trend==='up'.
            // XRP (regimeFiltered=false) : toujours accepté, le régime
            // n'est calculé que pour l'affichage sur ce slot.
            const passesRegimeGate = regimeFiltered ? trend === 'up' : true
            if (passesRegimeGate) {
              const windowStart = i - LOOKBACK_BARS + 1
              const windowBars = bars.slice(windowStart, i + 1)
              state.pendingTrigger = {
                triggerTime: trigger.time,
                windowHigh: Math.max(...windowBars.map(b => b.high)),
                windowLow: Math.min(...windowBars.map(b => b.low)),
                consecutiveCount: 0,
                barsWaited: 0,
              }
            }
            // Le cooldown démarre dès la DÉTECTION, qu'elle soit filtrée
            // par le régime ou non — comme dans le moteur de backtest.
            state.lastTriggerTime = trigger.time
          }
        }

        state.lastBarTimeProcessed = bar.time
      }

      saveSqueezeState(state, slot)

      const lastBar = bars.at(-1)
      const vwapNow = lastBar ? computeRollingVWAPAt(bars, bars.length - 1, VWAP_WINDOW) : 0
      const dailyRegimeNow = regime.trendLabels.at(-1) ?? 'undefined'

      // Métriques "live" diagnostiques sur la fenêtre la plus récente —
      // affichage seulement, ne déclenchent rien (le trigger réel a déjà
      // été évalué bougie par bougie ci-dessus).
      const metricsStartIdx = bars.length - LOOKBACK_BARS
      const liveOiChangePct = metricsStartIdx >= 0 && bars[metricsStartIdx].oi > 0
        ? ((bars[bars.length - 1].oi - bars[metricsStartIdx].oi) / bars[metricsStartIdx].oi) * 100
        : 0
      const liveDominance = metricsStartIdx >= 0
        ? deltaDominanceOverWindow(bars, metricsStartIdx, bars.length - 1)
        : 0

      if (fired && !getCurrentPosition(slot)) {
        const referenceBarKey = `${slot}-${lastBar?.time ?? 0}`
        const marketRegime = getMarketRegime(klines)
        const volatilityBucket = getVolatilityBucket(klines)
        const rr = direction === 'up' ? RR_UP : RR_DOWN
        await openPosition({
          slot,
          timestamp: Date.now(),
          timeframe: '1h',
          action: fired.action,
          confidence: 5,
          entryPrice: fired.entryPrice,
          vwap: fired.vwap,
          referenceBarKey,
          signalType: fired.action === 'SELL' ? 'bearish_retest' : 'bullish_retest',
          marketRegime: marketRegime as 'trend' | 'range' | 'breakout' | 'reversal',
          vwapDistancePct: Math.abs((fired.entryPrice - fired.vwap) / fired.vwap) * 100,
          volatilityBucket: volatilityBucket as 'low' | 'medium' | 'high',
          stopLoss: fired.stopLoss,
          takeProfit: fired.takeProfit,
          rr,
        })
        console.log(`[SQUEEZE] ${slot} ${fired.action} @ ${fired.entryPrice} (trigger ${new Date(fired.triggerTime * 1000).toISOString()})`)
      }

      slotSignals[slot] = {
        action: fired ? fired.action : 'STABLE',
        reasons: fired
          ? [`Squeeze confirmé (${fired.action})${regimeFiltered ? ` — régime daily ${dailyRegimeNow}.` : '.'}`]
          : state.pendingTrigger
            ? [`Trigger ${direction === 'up' ? 'SELL' : 'BUY'} en attente de confirmation VWAP (${state.pendingTrigger.barsWaited}/${TTL_BARS}h, ${state.pendingTrigger.consecutiveCount}/${CONFIRM_BARS} confirmées).`]
            : regimeFiltered
              ? [`Aucun trigger actif — régime daily : ${dailyRegimeNow}.`]
              : [`Aucun trigger actif (pas de filtre de régime sur ce slot).`],
        vwap: vwapNow,
        dailyRegime: dailyRegimeNow,
        pendingTrigger: state.pendingTrigger ? {
          triggerTime: state.pendingTrigger.triggerTime,
          barsWaited: state.pendingTrigger.barsWaited,
          consecutiveCount: state.pendingTrigger.consecutiveCount,
        } : null,
        metrics: {
          priceVsVwapPct: lastBar && vwapNow ? ((lastBar.close - vwapNow) / vwapNow) * 100 : 0,
          oiChangePct: liveOiChangePct,
          dominance: liveDominance,
          fundingRate: funding.rate,
        },
      }

      logSignalCSV({
        time: new Date().toISOString(),
        slot,
        action: slotSignals[slot].action,
        daily_regime: dailyRegimeNow,
        pending_trigger: !!state.pendingTrigger,
        bars_waited: state.pendingTrigger?.barsWaited ?? 0,
        trade_taken: !!fired,
        price: lastBar?.close ?? 0,
        vwap: Math.round(vwapNow * 100) / 100,
        oi_change_pct: Math.round(liveOiChangePct * 10000) / 10000,
        dominance: Math.round(liveDominance * 1000) / 1000,
        funding_rate: funding.rate,
      })
    }

    return NextResponse.json({
      // BTC-1h pour compatibilité avec le graphique principal de l'UI
      klines: btcKlines,
      vwap: calculateVWAP(btcKlines, 200),
      cvd: calculateCVD([], btcKlines),
      oi: buildOiSeriesForKlines('BTC-1h', btcKlines),
      ticker: btcTicker,
      funding: btcFunding,

      // Signal principal (BTC-1h, pour compatibilité avec TradeSignalPanel)
      signal: {
        action: slotSignals['BTC-1h'].action,
        confidence: slotSignals['BTC-1h'].action === 'SELL' ? 5 : 1,
        signalType: slotSignals['BTC-1h'].action === 'SELL' ? 'bearish_retest' : 'neutral',
        marketRegime: getMarketRegime(btcKlines),
        volatilityBucket: getVolatilityBucket(btcKlines),
        vwap: slotSignals['BTC-1h'].vwap,
        reasons: slotSignals['BTC-1h'].reasons,
        metrics: {
          priceVsVwapPct: slotSignals['BTC-1h'].metrics.priceVsVwapPct,
          // "Dominance" — relabellé côté UI dans TradeSignalPanel.tsx
          cvdDelta: slotSignals['BTC-1h'].metrics.dominance,
          oiDeltaPct: slotSignals['BTC-1h'].metrics.oiChangePct,
          fundingRate: slotSignals['BTC-1h'].metrics.fundingRate,
          oiChangeAbs: 0,
          distanceFromVwapPct: Math.abs(slotSignals['BTC-1h'].metrics.priceVsVwapPct),
        },
      },

      // Les 4 slots
      slotSignals,
      allPositions: getAllPositions(),
      currentPosition: getCurrentPosition('BTC-1h'),
      setupHistory: getRecentSetups(),
      setupStats: getStats(),
      slotStats: getSlotStats(),
      sessionStats: getSessionStats(),

      weekend,
      lastUpdate: Date.now(),
      timeframe: '1h',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
