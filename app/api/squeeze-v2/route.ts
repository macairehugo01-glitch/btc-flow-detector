import { NextRequest, NextResponse } from 'next/server'
import {
  fetchKlines,
  fetchCurrentOI,
  fetchOIHistory,
} from '../../../binance'
import {
  evaluateOpenSetups,
  getCurrentPosition,
  getAllPositions,
  openPosition,
  type SlotKey,
} from '../../../store'
import {
  loadOIBuffer,
  saveOIBuffer,
  loadV2DetectorState,
  saveV2DetectorState,
  loadDailyRegimeCache,
  saveDailyRegimeCache,
  type V2DetectorState,
} from '../../../journalPersistence'

export const dynamic = 'force-dynamic'

// ═════════════════════════════════════════════════════════════════════════
// ⚠️ PRÉREQUIS AVANT DÉPLOIEMENT — lire avant de pousser en prod
// ═════════════════════════════════════════════════════════════════════════
// 1. Le type SlotKey ET la liste ALL_SLOTS (dans store.ts) doivent être
//    étendus pour accepter les 3 nouveaux identifiants ci-dessous :
//      | 'BTC-15m-v2' | 'ETH-15m-v2' | 'SOL-15m-v2'
//    Voir le patch fourni séparément (store-v2-patch.ts) — 3 endroits
//    précis à modifier : le type SlotKey, le tableau ALL_SLOTS, et
//    l'objet initialState.slots.
//
// 2. CONFIRMÉ (lecture de store.ts) : openPosition() est un suivi
//    journalisé (paper/dashboard) avec notification Telegram automatique
//    à l'ouverture ET à la clôture — PAS un envoi d'ordre broker réel.
//    Chaque trade v2 déclenchera donc un vrai message Telegram dès le
//    déploiement. risk = 2% fixe dans le journal (affichage seulement,
//    aucun lien avec une taille de position réelle).
//
// 3. Cette route est un moteur SÉPARÉ de cvd/route.ts (squeeze v1, H1,
//    4 actifs). Elle ne le remplace pas et ne le modifie pas. Les deux
//    peuvent tourner en parallèle. Il faudra ajouter un appel à cette
//    route (`/api/squeeze-v2`) quelque part dans le frontend ou un cron
//    pour qu'elle soit effectivement pollée — comme cvd/route.ts, elle
//    est conçue request-driven (déclenchée par le poll), pas par cron
//    natif. Sans poll régulier, elle ne tournera jamais.
// ═════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// LOGIQUE DE TRADING — portée à l'identique depuis le backtest v2 final
// (cloche d'OI symétrique + croisement VWAP comme trigger + détection
// dynamique du pic/swing + filtre de régime Dow daily symétrique).
// XRP exclu (son edge s'est avéré inversé sous ce filtre).
//
// DIFFÉRENCE STRUCTURELLE BACKTEST → LIVE (lire avant de toucher au code) :
// Le backtest, une fois un setup validé à la bougie i, scanne directement
// les bougies FUTURES i+1...i+ttlBars (déjà connues) pour trouver la
// confirmation en une seule passe. En live, ces bougies n'existent pas
// encore : la confirmation doit être un état persisté (pendingTrigger)
// qui progresse d'UNE bougie clôturée à la fois, à chaque poll — exactement
// comme le fait déjà le moteur squeeze v1 (cvd/route.ts). Le code ci-dessous
// suit ce modèle, pas celui du backtest.
// ───────────────────────────────────────────────────────────────────

const BAR_SECONDS = 15 * 60 // bougie M15
const KLINE_INTERVAL = '15' // code Bybit pour 15 minutes
const OI_INTERVAL = '15min'
const KLINES_LIMIT = 200

// Paramètres verrouillés — identiques à la config finale validée en
// backtest (BTC+ETH+SOL, filtre régime symétrique, expectancy combinée
// +0,238R/trade sur 119 trades, 2 ans M15).
const PUMP_LOOKBACK = 8        // garde-fou de recherche rétroactive, pas une fenêtre de mesure
const IMPULSE_ATR_MULT = 0     // filtre prix/ATR verrouillé désactivé (validé ainsi)
const OI_RISE_MIN_PCT = 1      // sursaut bougie-à-bougie, pas cumulé
const OI_DROP_FROM_PEAK_MIN_PCT = 0.5
const MAX_PEAK_OFFSET_BARS = 2
const RR = 1.5
const TTL_BARS = 8             // 2h pour confirmer
const CONFIRM_BARS = 2         // 30 min du bon côté de la VWAP
const VWAP_WINDOW = 12         // 3h
const COOLDOWN_BARS = 12       // 3h entre deux détections
const SL_BUFFER_PCT = 0.002
const ATR_PERIOD = 14
const SWING_LOOKBACK_DAILY = 20
const DAILY_FETCH_LIMIT = 200
const REGIME_REFRESH_MS = 60 * 60 * 1000

type SlotConfig = { slot: SlotKey; symbol: string }

const SLOT_CONFIGS: SlotConfig[] = [
  { slot: 'BTC-15m-v2', symbol: 'BTCUSDT' },
  { slot: 'ETH-15m-v2', symbol: 'ETHUSDT' },
  { slot: 'SOL-15m-v2', symbol: 'SOLUSDT' },
  // XRP volontairement absent — voir analyse du 30/06/2026 : son edge
  // s'est avéré inversé (-0,338R, symétrique sur les deux sens) sous le
  // même filtre de régime que BTC/ETH/SOL. Ne pas le rajouter ici sans
  // un filtre adapté spécifiquement validé pour lui.
  //
  // Suffixe "-v2" OBLIGATOIRE : store.ts contient des slots orphelins
  // 'BTC-15m'/'ETH-15m' venant d'une ANCIENNE stratégie (LFR, abandonnée).
  // Réutiliser ces noms exacts ferait potentiellement resurgir de vieilles
  // positions/stats fantômes si des données orphelines existent encore
  // dans le fichier journal persisté. Ne jamais renommer ces slots vers
  // 'BTC-15m' sans avoir vérifié et purgé ces données orphelines d'abord.
]

// ─── OI BUFFERS (un par slot, distincts des buffers H1 du moteur v1) ──────

type OIBar = { time: number; openInterest: number }
const MAX_OI_POINTS = 500
const oiBuffers: Record<string, OIBar[]> = {
  'BTC-15m-v2': loadOIBuffer('BTC-15m-v2'),
  'ETH-15m-v2': loadOIBuffer('ETH-15m-v2'),
  'SOL-15m-v2': loadOIBuffer('SOL-15m-v2'),
}
const oiHistoryLoaded: Record<string, boolean> = {
  'BTC-15m-v2': false, 'ETH-15m-v2': false, 'SOL-15m-v2': false,
}

function pushOiSnapshot(slot: string, snapshot: OIBar) {
  const buf = oiBuffers[slot]
  const last = buf.at(-1)
  if (!last || snapshot.time !== last.time || snapshot.openInterest !== last.openInterest) {
    buf.push(snapshot)
    while (buf.length > MAX_OI_POINTS) buf.shift()
    saveOIBuffer(buf, slot)
  }
}

function buildOiSeriesForKlines(slot: string, klines: Array<{ time: number }>): OIBar[] {
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

async function initOIBuffer(slot: string, symbol: string) {
  if (oiHistoryLoaded[slot] && oiBuffers[slot].length >= 10) return
  oiHistoryLoaded[slot] = true
  try {
    const history = await fetchOIHistory(OI_INTERVAL, 200, symbol)
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
    console.error(`[V2-OI] Failed to load history for ${slot}:`, err)
    oiHistoryLoaded[slot] = false
  }
}

// ─── MATHS DE LA STRATÉGIE — copiées à l'identique depuis le backtest v2
// final (validateSetup, findRecentOiPeak, findOiRiseStart, priceExtreme,
// computeVWAPAt, computeATR). Aucune divergence volontaire.

type MergedBar = {
  time: number; open: number; high: number; low: number
  close: number; volume: number; oi: number
}
type Direction = 'up' | 'down'

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

function computeVWAPAt(bars: MergedBar[], i: number, vwapWindow: number): number {
  const window = bars.slice(Math.max(0, i - vwapWindow), i + 1)
  let pv = 0, vol = 0
  for (const b of window) {
    const typical = (b.high + b.low + b.close) / 3
    pv += typical * b.volume
    vol += b.volume
  }
  return vol > 0 ? pv / vol : bars[i].close
}

function findRecentOiPeak(bars: MergedBar[], fromIdx: number, searchFloor: number): number {
  let peakIdx = fromIdx
  let peakOi = bars[fromIdx].oi
  for (let k = fromIdx - 1; k >= searchFloor; k--) {
    if (bars[k].oi > peakOi) { peakOi = bars[k].oi; peakIdx = k } else break
  }
  return peakIdx
}

function findOiRiseStart(bars: MergedBar[], peakIdx: number, searchFloor: number): number {
  let startIdx = peakIdx
  let minOi = bars[peakIdx].oi
  for (let k = peakIdx - 1; k >= searchFloor; k--) {
    if (bars[k].oi < minOi) { minOi = bars[k].oi; startIdx = k } else break
  }
  return startIdx
}

function priceExtreme(bars: MergedBar[], fromIdx: number, toIdx: number, kind: 'high' | 'low'): number {
  const slice = bars.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1)
  return kind === 'high' ? Math.max(...slice.map(b => b.high)) : Math.min(...slice.map(b => b.low))
}

type SetupValidation = { peakIdx: number; riseStartIdx: number } | null

function validateSetup(bars: MergedBar[], atr: number[], crossIdx: number, direction: Direction, searchFloor: number): SetupValidation {
  const peakIdx = findRecentOiPeak(bars, crossIdx, searchFloor)
  if (peakIdx === crossIdx) return null
  const peakOffsetBars = crossIdx - peakIdx
  if (peakOffsetBars > MAX_PEAK_OFFSET_BARS) return null

  const peakOi = bars[peakIdx].oi
  const oiDropFromPeakPct = ((peakOi - bars[crossIdx].oi) / peakOi) * 100
  if (oiDropFromPeakPct < OI_DROP_FROM_PEAK_MIN_PCT) return null

  const riseStartIdx = findOiRiseStart(bars, peakIdx, searchFloor)
  if (!bars[riseStartIdx].oi || bars[riseStartIdx].oi <= 0) return null

  let hasSuddenJump = false
  for (let k = riseStartIdx + 1; k <= peakIdx; k++) {
    if (!bars[k - 1].oi || bars[k - 1].oi <= 0) continue
    const barOverBarPct = ((bars[k].oi - bars[k - 1].oi) / bars[k - 1].oi) * 100
    if (barOverBarPct >= OI_RISE_MIN_PCT) { hasSuddenJump = true; break }
  }
  if (!hasSuddenJump) return null

  const priceMove = bars[peakIdx].close - bars[riseStartIdx].close
  if (Math.abs(priceMove) <= IMPULSE_ATR_MULT * atr[peakIdx]) return null

  const vwapAtPeak = computeVWAPAt(bars, peakIdx, VWAP_WINDOW)
  const peakAboveVwap = bars[peakIdx].close > vwapAtPeak
  const peakOnFomoSide = direction === 'up' ? peakAboveVwap : !peakAboveVwap
  if (!peakOnFomoSide) return null

  return { peakIdx, riseStartIdx }
}

// ─── RÉGIME DOW DAILY — réutilise le cache existant daily-regime-{symbol}
// (un par SYMBOLE, pas par slot/timeframe — partagé avec le moteur v1
// pour BTC/ETH/SOL, ce qui est correct : le régime quotidien ne dépend
// pas du timeframe de trading).

type DailyBar = { time: number; high: number; low: number }
type TrendRegime = 'up' | 'down' | 'undefined'
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

// ─── HELPERS GÉNÉRIQUES — dupliqués depuis cvd/route.ts (non exportés
// là-bas, donc dupliqués ici à l'identique plutôt que réimportés).

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

// ─── HANDLER PRINCIPAL ──────────────────────────────────────────────────────

type SlotSignalResult = {
  action: 'BUY' | 'SELL' | 'STABLE'
  reasons: string[]
  vwap: number
  dailyRegime: TrendRegime
  pendingTrigger: { crossTime: number; direction: Direction; barsWaited: number; consecutiveCount: number } | null
}

export async function GET(req: NextRequest) {
  try {
    const slotSignals: Record<string, SlotSignalResult> = {}

    for (const config of SLOT_CONFIGS) {
      const { slot, symbol } = config

      // 1. Récupérer les klines M15 (inclut potentiellement la bougie en
      // cours de formation, comme tout endpoint kline standard).
      const klines = await fetchKlines(symbol, KLINE_INTERVAL, KLINES_LIMIT)
      // CORRECTIF : fetchCurrentOI attend le format Bybit OI ('15min'),
      // pas le format kline ('15') — utiliser OI_INTERVAL, pas un format
      // ad hoc, pour éviter un appel qui échouerait silencieusement ou
      // retournerait des données mal alignées dans le temps.
      const currentOI = await fetchCurrentOI(symbol, OI_INTERVAL)

      await initOIBuffer(slot, symbol)
      pushOiSnapshot(slot, currentOI)

      // 2. Évaluer les positions ouvertes (SL/TP) AVANT de filtrer les
      // bougies — l'évaluation des sorties reste réactive et utilise la
      // bougie en formation, contrairement à la détection d'entrée.
      evaluateOpenSetups(klines, slot)

      const oiSeries = buildOiSeriesForKlines(slot, klines)
      const allBars: MergedBar[] = klines.map((k, i) => ({
        time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
        oi: oiSeries[i]?.openInterest ?? 0,
      }))

      // 3. ★ POINT CRITIQUE — bougie n-1, pas n. On ne garde QUE les
      // bougies dont la clôture est déjà passée. La détection (trigger,
      // confirmation, calcul VWAP/OI/swing) n'utilise JAMAIS la bougie en
      // cours de formation — seule l'évaluation SL/TP ci-dessus le fait.
      const nowSeconds = Math.floor(Date.now() / 1000)
      const bars = allBars.filter(b => b.time + BAR_SECONDS <= nowSeconds)

      if (bars.length < PUMP_LOOKBACK + ATR_PERIOD + VWAP_WINDOW + 2) {
        slotSignals[slot] = {
          action: 'STABLE', reasons: ['Historique insuffisant pour détecter.'],
          vwap: 0, dailyRegime: 'undefined', pendingTrigger: null,
        }
        continue
      }

      const atr = computeATR(bars, ATR_PERIOD)
      const regime = await getDailyRegime(symbol)
      const state: V2DetectorState = loadV2DetectorState(slot)

      // On ne traite que les bougies CLÔTURÉES plus récentes que la
      // dernière déjà vue — un seul nouveau point normalement entre deux
      // polls (15 min >> 10s), mais on boucle au cas où le service ait
      // été arrêté pendant plusieurs cycles.
      const startCalcIdx = PUMP_LOOKBACK + ATR_PERIOD + VWAP_WINDOW
      const firstNewIdx = bars.findIndex((b, idx) => idx >= startCalcIdx && b.time > state.lastBarTimeProcessed)
      const indices: number[] = firstNewIdx === -1 ? [] : bars.slice(firstNewIdx).map((_, k) => firstNewIdx + k)

      let fired: { action: 'BUY' | 'SELL'; entryPrice: number; stopLoss: number; takeProfit: number; vwap: number; crossTime: number } | null = null

      for (const i of indices) {
        const bar = bars[i]

        // ── Confirmation d'un trigger déjà en attente ──
        if (state.pendingTrigger) {
          const vwapJ = computeVWAPAt(bars, i, VWAP_WINDOW)
          const onRightSide = state.pendingTrigger.direction === 'up' ? bar.close < vwapJ : bar.close > vwapJ
          if (onRightSide) {
            state.pendingTrigger.consecutiveCount++
            if (state.pendingTrigger.consecutiveCount >= CONFIRM_BARS) {
              const direction = state.pendingTrigger.direction
              const action: 'BUY' | 'SELL' = direction === 'up' ? 'SELL' : 'BUY'
              const entryPrice = bar.close
              const stopLoss = state.pendingTrigger.slPrice // figé à la détection
              const risk = Math.abs(entryPrice - stopLoss)
              const takeProfit = action === 'SELL' ? entryPrice - risk * RR : entryPrice + risk * RR
              fired = { action, entryPrice, stopLoss, takeProfit, vwap: vwapJ, crossTime: state.pendingTrigger.crossTime }
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

        // ── Détection d'un nouveau trigger (croisement VWAP) ──
        const cooldownElapsedSec = bar.time - state.lastTriggerTime
        if (!state.pendingTrigger && cooldownElapsedSec >= COOLDOWN_BARS * BAR_SECONDS && i > 0) {
          const vwapPrev = computeVWAPAt(bars, i - 1, VWAP_WINDOW)
          const vwapCurr = computeVWAPAt(bars, i, VWAP_WINDOW)
          const crossedDown = bars[i - 1].close >= vwapPrev && bar.close < vwapCurr // candidat SELL
          const crossedUp = bars[i - 1].close <= vwapPrev && bar.close > vwapCurr   // candidat BUY

          if (crossedDown || crossedUp) {
            const direction: Direction = crossedDown ? 'up' : 'down'
            const searchFloor = Math.max(0, i - PUMP_LOOKBACK + 1)
            const setup = validateSetup(bars, atr, i, direction, searchFloor)

            if (setup) {
              // Cooldown démarre dès la détection validée, que le régime
              // accepte ou non ensuite — identique au comportement v1.
              state.lastTriggerTime = bar.time

              const trend = regimeTrendAtTime(regime.dailyBars, regime.trendLabels, bar.time)
              const requiredTrend: TrendRegime = direction === 'up' ? 'up' : 'down'
              if (trend === requiredTrend) {
                const slRaw = direction === 'up'
                  ? priceExtreme(bars, setup.riseStartIdx, setup.peakIdx, 'high')
                  : priceExtreme(bars, setup.riseStartIdx, setup.peakIdx, 'low')
                const slPrice = direction === 'up' ? slRaw * (1 + SL_BUFFER_PCT) : slRaw * (1 - SL_BUFFER_PCT)
                state.pendingTrigger = { crossTime: bar.time, direction, slPrice, consecutiveCount: 0, barsWaited: 0 }
              }
            }
          }
        }

        state.lastBarTimeProcessed = bar.time
      }

      saveV2DetectorState(state, slot)

      if (fired && !getCurrentPosition(slot)) {
        const referenceBarKey = `${slot}-${bars.at(-1)?.time ?? 0}`
        const marketRegime = getMarketRegime(klines)
        const volatilityBucket = getVolatilityBucket(klines)
        await openPosition({
          slot,
          timestamp: Date.now(),
          timeframe: '15m',
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
          rr: RR,
        })
        console.log(`[V2] ${slot} ${fired.action} @ ${fired.entryPrice} (cross ${new Date(fired.crossTime * 1000).toISOString()})`)
      }

      const lastBar = bars.at(-1)
      const vwapNow = lastBar ? computeVWAPAt(bars, bars.length - 1, VWAP_WINDOW) : 0
      const dailyRegimeNow = regime.trendLabels.at(-1) ?? 'undefined'

      slotSignals[slot] = {
        action: fired ? fired.action : 'STABLE',
        reasons: fired
          ? [`Trigger confirmé (${fired.action}) — régime daily ${dailyRegimeNow}.`]
          : state.pendingTrigger
            ? [`Trigger ${state.pendingTrigger.direction === 'up' ? 'SELL' : 'BUY'} en attente (${state.pendingTrigger.barsWaited}/${TTL_BARS} bougies, ${state.pendingTrigger.consecutiveCount}/${CONFIRM_BARS} confirmées).`]
            : [`Aucun trigger actif — régime daily : ${dailyRegimeNow}.`],
        vwap: vwapNow,
        dailyRegime: dailyRegimeNow,
        pendingTrigger: state.pendingTrigger
          ? { crossTime: state.pendingTrigger.crossTime, direction: state.pendingTrigger.direction, barsWaited: state.pendingTrigger.barsWaited, consecutiveCount: state.pendingTrigger.consecutiveCount }
          : null,
      }
    }

    return NextResponse.json({
      slotSignals,
      allPositions: getAllPositions(),
      lastUpdate: Date.now(),
      timeframe: '15m',
      engine: 'squeeze-v2-bellshape-dow',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
