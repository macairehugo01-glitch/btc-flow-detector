import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

// ───────────────────────────────────────────────────────────────────
// V2 — RESTRUCTURATION COMPLÈTE DE LA LOGIQUE DE TRIGGER
// ───────────────────────────────────────────────────────────────────
// Avant (v1) : on détectait un "trigger" (impulsion + pic OI) PUIS on
// attendait séparément un croisement VWAP comme confirmation.
//
// Maintenant (v2) : le VRAI déclencheur EST le croisement de la VWAP.
// On scanne chaque bougie ; dès que le prix vient de croiser la VWAP,
// on remonte le temps pour VALIDER que ce croisement correspond à un
// vrai setup (pic d'OI récent, chute suffisante, mouvement de prix
// significatif, pic du bon côté de sa propre VWAP). Si validé, on
// exige confirmBars bougies consécutives du bon côté avant d'entrer.
//
// pumpLookback n'est plus une fenêtre de MESURE — juste un garde-fou
// qui borne jusqu'où les recherches rétroactives (pic OI, début de
// la montée d'OI) sont autorisées à remonter.
//
// ⚠️ POINTS OUVERTS, PAS ENCORE TRANCHÉS :
// - Le filtre d'impulsion utilise toujours l'ATR du PRIX, pas une
//   mesure de volatilité de l'OI lui-même (voir échange du
//   29/06/2026 — à décider si on remplace).
// - Confirmation sur H1 uniquement — pas de données M15 disponibles
//   dans cette session pour une confirmation plus fine.
// - maxBarsToResolve retiré : chaque trade va jusqu'au SL ou au TP,
//   peu importe le temps que ça prend (garde-fou de sécurité à 1000
//   bougies pour éviter une boucle infinie en cas de données
//   pathologiques — étiqueté "unresolved", pas "breakeven").
// ───────────────────────────────────────────────────────────────────

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

type Direction = 'up' | 'down' // 'up' = pump puis SELL, 'down' = dump puis BUY
type Outcome = 'win' | 'loss' | 'unresolved' | 'no_confirmation'

type TradeEvent = {
  crossTime: number
  direction: Direction
  peakOiTime: number
  peakOffsetBars: number
  oiRiseToPeakPct: number
  oiDropFromPeakPct: number
  peakOnFomoSide: boolean // pic au-dessus (up) ou sous (down) de sa propre VWAP
  priceMovePct: number
  confirmed: boolean
  barsToConfirm?: number
  action?: 'BUY' | 'SELL'
  entryPrice?: number
  slPrice?: number
  tpPrice?: number
  outcome: Outcome
  rMultiple: number
  barsToClose?: number
}

type StatBlock = { trades: number; wins: number; winRate: number; avgR: number; expectancy: number }

function trueRange(curr: RawBar, prev: RawBar | undefined): number {
  if (!prev) return curr.high - curr.low
  return Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close))
}

function computeATR(bars: RawBar[], period: number): number[] {
  const atr = new Array(bars.length).fill(0)
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    const tr = trueRange(bars[i], bars[i - 1])
    if (i < period) { sum += tr; atr[i] = sum / (i + 1) }
    else { atr[i] = (atr[i - 1] * (period - 1) + tr) / period }
  }
  return atr
}

function computeVWAPAt(bars: RawBar[], i: number, vwapWindow: number): number {
  const window = bars.slice(Math.max(0, i - vwapWindow), i + 1)
  let pv = 0, vol = 0
  for (const b of window) {
    const typical = (b.high + b.low + b.close) / 3
    pv += typical * b.volume
    vol += b.volume
  }
  return vol > 0 ? pv / vol : bars[i].close
}

// ─── RECHERCHES RÉTROACTIVES (toutes bornées par searchFloor) ────

// Dernier pic d'OI en reculant depuis fromIdx (s'arrête au premier
// retournement — pas le maximum global de la fenêtre).
function findRecentOiPeak(bars: RawBar[], fromIdx: number, searchFloor: number): number {
  let peakIdx = fromIdx
  let peakOi = bars[fromIdx].oi
  for (let k = fromIdx - 1; k >= searchFloor; k--) {
    if (bars[k].oi > peakOi) { peakOi = bars[k].oi; peakIdx = k } else break
  }
  return peakIdx
}

// Vrai début de la montée d'OI : le creux d'OI le plus récent avant
// le pic (symétrique de findRecentOiPeak, mais cherche un minimum).
function findOiRiseStart(bars: RawBar[], peakIdx: number, searchFloor: number): number {
  let startIdx = peakIdx
  let minOi = bars[peakIdx].oi
  for (let k = peakIdx - 1; k >= searchFloor; k--) {
    if (bars[k].oi < minOi) { minOi = bars[k].oi; startIdx = k } else break
  }
  return startIdx
}

// Vrai extrême de PRIX entre deux indices (pour le SL).
function priceExtreme(bars: RawBar[], fromIdx: number, toIdx: number, kind: 'high' | 'low'): number {
  const slice = bars.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1)
  return kind === 'high' ? Math.max(...slice.map(b => b.high)) : Math.min(...slice.map(b => b.low))
}

type SetupValidation = {
  peakIdx: number
  riseStartIdx: number
  peakOffsetBars: number
  oiRiseToPeakPct: number
  oiDropFromPeakPct: number
  priceMovePct: number
  peakOnFomoSide: boolean
}

function validateSetup(
  bars: RawBar[],
  atr: number[],
  crossIdx: number,
  direction: Direction,
  searchFloor: number,
  maxPeakOffsetBars: number,
  oiRiseMinPct: number,
  oiSpikeMinPct: number,
  oiDropFromPeakMinPct: number,
  impulseAtrMult: number,
  vwapWindow: number
): SetupValidation | null {
  // 1. Dernier pic d'OI avant le croisement — doit déjà être en train
  // de redescendre, et de façon récente (soudaineté).
  const peakIdx = findRecentOiPeak(bars, crossIdx, searchFloor)
  if (peakIdx === crossIdx) return null
  const peakOffsetBars = crossIdx - peakIdx
  if (peakOffsetBars > maxPeakOffsetBars) return null

  const peakOi = bars[peakIdx].oi
  const oiDropFromPeakPct = ((peakOi - bars[crossIdx].oi) / peakOi) * 100
  if (oiDropFromPeakPct < oiDropFromPeakMinPct) return null

  // 2. Vrai début de la montée d'OI — pas une fenêtre fixe.
  const riseStartIdx = findOiRiseStart(bars, peakIdx, searchFloor)
  if (!bars[riseStartIdx].oi || bars[riseStartIdx].oi <= 0) return null
  const oiRiseToPeakPct = ((peakOi - bars[riseStartIdx].oi) / bars[riseStartIdx].oi) * 100

  // NOUVEAU : le critère n'est plus la hausse CUMULÉE sur tout le
  // segment, mais au moins UNE bougie individuelle dont l'OI a
  // bondi de oiRiseMinPct% par rapport à la bougie précédente — un
  // vrai sursaut soudain, pas une accumulation lente sur plusieurs
  // heures qui finirait par dépasser le seuil sans jamais avoir de
  // mouvement brusque.
  let hasSuddenJump = false
  for (let k = riseStartIdx + 1; k <= peakIdx; k++) {
    if (!bars[k - 1].oi || bars[k - 1].oi <= 0) continue
    const barOverBarPct = ((bars[k].oi - bars[k - 1].oi) / bars[k - 1].oi) * 100
    if (barOverBarPct >= oiRiseMinPct) { hasSuddenJump = true; break }
  }
  if (!hasSuddenJump) return null

  // 2b. NOUVEAU : sursaut bougie par bougie — au moins UNE bougie du
  // segment doit montrer une hausse d'OI ≥ oiSpikeMinPct par rapport
  // à la clôture d'OI de la bougie précédente. Différent du critère
  // cumulé ci-dessus : ça détecte un VRAI sursaut ponctuel, pas une
  // lente accumulation qui finit par dépasser le seuil.
  let maxSingleBarRisePct = 0
  for (let k = riseStartIdx + 1; k <= peakIdx; k++) {
    if (bars[k - 1].oi > 0) {
      const pct = ((bars[k].oi - bars[k - 1].oi) / bars[k - 1].oi) * 100
      if (pct > maxSingleBarRisePct) maxSingleBarRisePct = pct
    }
  }
  if (maxSingleBarRisePct < oiSpikeMinPct) return null

  // 3. Mouvement de prix "contraint" sur ce même segment dynamique
  // (ATR-prix pour l'instant — voir réserve en en-tête).
  const priceMove = bars[peakIdx].close - bars[riseStartIdx].close
  const priceMovePct = (priceMove / bars[riseStartIdx].close) * 100
  if (Math.abs(priceMove) <= impulseAtrMult * atr[peakIdx]) return null

  // 4. Le pic devait être du bon côté de SA PROPRE vwap — une vraie
  // extension, pas une fluctuation de bruit autour de la moyenne.
  const vwapAtPeak = computeVWAPAt(bars, peakIdx, vwapWindow)
  const peakAboveVwap = bars[peakIdx].close > vwapAtPeak
  const peakOnFomoSide = direction === 'up' ? peakAboveVwap : !peakAboveVwap
  if (!peakOnFomoSide) return null

  return { peakIdx, riseStartIdx, peakOffsetBars, oiRiseToPeakPct, oiDropFromPeakPct, priceMovePct, peakOnFomoSide }
}

function calcStats(events: TradeEvent[]): StatBlock {
  const closed = events.filter(e => e.outcome === 'win' || e.outcome === 'loss')
  const wins = closed.filter(e => e.outcome === 'win')
  const winRate = closed.length > 0 ? wins.length / closed.length : 0
  const avgR = closed.length > 0 ? closed.reduce((s, e) => s + e.rMultiple, 0) / closed.length : 0
  return {
    trades: closed.length, wins: wins.length,
    winRate: Math.round(winRate * 1000) / 10,
    avgR: Math.round(avgR * 1000) / 1000,
    expectancy: Math.round(avgR * 1000) / 1000,
  }
}

// Vitesse d'exécution : médiane plus pertinente que la moyenne ici,
// puisque quelques trades très longs (mouvements prolongés rares)
// déforment fortement la moyenne sans représenter le cas typique.
function timingStats(events: TradeEvent[], outcome: 'win' | 'loss'): { median: number; mean: number; min: number; max: number; n: number } {
  const values = events.filter(e => e.outcome === outcome && e.barsToClose != null).map(e => e.barsToClose as number).sort((a, b) => a - b)
  if (values.length === 0) return { median: 0, mean: 0, min: 0, max: 0, n: 0 }
  const mid = Math.floor(values.length / 2)
  const median = values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid]
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return {
    median: Math.round(median * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    min: values[0],
    max: values[values.length - 1],
    n: values.length,
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()
  const tf = url.searchParams.get('tf') ?? '1h'

  const pumpLookback = Number(url.searchParams.get('pumpLookback') ?? 12) // garde-fou, plus une fenêtre de mesure
  const impulseAtrMult = Number(url.searchParams.get('atrMult') ?? 1.0)
  const oiRiseMinPct = Number(url.searchParams.get('oiRiseMin') ?? 2)
  const oiDropFromPeakMinPct = Number(url.searchParams.get('oiDropFromPeakMin') ?? 0.5)
  const maxPeakOffsetBars = Number(url.searchParams.get('maxPeakOffsetBars') ?? 2)
  const rr = Number(url.searchParams.get('rr') ?? 1.5)
  const ttlBars = Number(url.searchParams.get('ttl') ?? 8)
  const confirmBars = Number(url.searchParams.get('confirmBars') ?? 2)
  const vwapWindow = Number(url.searchParams.get('vwapWindow') ?? 12)
  const cooldownBars = Number(url.searchParams.get('cooldown') ?? 12)
  const slBufferPct = 0.002
  const atrPeriod = 14
  // Garde-fou de sécurité seulement (pas une vraie limite business) —
  // évite une boucle qui ne se termine jamais sur des données
  // pathologiques. Le trade va normalement jusqu'au SL ou au TP.
  const maxResolveSafety = Number(url.searchParams.get('maxResolveSafety') ?? 1000)

  const allowed = ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT']
  if (!allowed.includes(symbol)) {
    return NextResponse.json({ error: `Symbole non supporté: ${symbol}` }, { status: 400 })
  }

  const HISTORY_FILE = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-${tf}.json`)
  if (!fs.existsSync(HISTORY_FILE)) {
    return NextResponse.json(
      { error: `Données ${symbol} ${tf} manquantes. Lance /api/backtest/collect?symbol=${symbol}&tf=${tf} d'abord.` },
      { status: 400 }
    )
  }

  try {
    const bars: RawBar[] = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
    const atr = computeATR(bars, atrPeriod)

    const events: TradeEvent[] = []
    let lastTriggerIdx = -Infinity
    const startIdx = pumpLookback + atrPeriod + vwapWindow

    for (let i = startIdx; i < bars.length - 1; i++) {
      if (i - lastTriggerIdx < cooldownBars) continue

      const vwapPrev = computeVWAPAt(bars, i - 1, vwapWindow)
      const vwapCurr = computeVWAPAt(bars, i, vwapWindow)

      const crossedDown = bars[i - 1].close >= vwapPrev && bars[i].close < vwapCurr // candidat SELL
      const crossedUp = bars[i - 1].close <= vwapPrev && bars[i].close > vwapCurr   // candidat BUY
      if (!crossedDown && !crossedUp) continue

      const direction: Direction = crossedDown ? 'up' : 'down'
      const searchFloor = Math.max(0, i - pumpLookback + 1)

      const setup = validateSetup(
        bars, atr, i, direction, searchFloor,
        maxPeakOffsetBars, oiRiseMinPct, oiDropFromPeakMinPct, impulseAtrMult, vwapWindow
      )
      if (!setup) continue

      lastTriggerIdx = i // cooldown démarre dès la détection validée

      const base = {
        crossTime: bars[i].time,
        direction,
        peakOiTime: bars[setup.peakIdx].time,
        peakOffsetBars: setup.peakOffsetBars,
        oiRiseToPeakPct: Math.round(setup.oiRiseToPeakPct * 100) / 100,
        oiDropFromPeakPct: Math.round(setup.oiDropFromPeakPct * 100) / 100,
        peakOnFomoSide: setup.peakOnFomoSide,
        priceMovePct: Math.round(setup.priceMovePct * 1000) / 1000,
      }

      // Confirmation : confirmBars bougies consécutives du bon côté
      // de la vwap, à partir du croisement (plusieurs essais possibles
      // dans la fenêtre ttlBars si le prix repasse temporairement).
      let consecutive = 0
      let confirmIdx = -1
      for (let j = i; j < Math.min(i + ttlBars, bars.length); j++) {
        const vwapJ = computeVWAPAt(bars, j, vwapWindow)
        const onRightSide = direction === 'up' ? bars[j].close < vwapJ : bars[j].close > vwapJ
        if (onRightSide) {
          consecutive++
          if (consecutive >= confirmBars) { confirmIdx = j; break }
        } else {
          consecutive = 0
        }
      }

      if (confirmIdx === -1) {
        events.push({ ...base, confirmed: false, outcome: 'no_confirmation', rMultiple: 0 })
        continue
      }

      const action: 'BUY' | 'SELL' = direction === 'up' ? 'SELL' : 'BUY'
      const entryPrice = bars[confirmIdx].close
      const slRaw = action === 'SELL'
        ? priceExtreme(bars, setup.riseStartIdx, setup.peakIdx, 'high')
        : priceExtreme(bars, setup.riseStartIdx, setup.peakIdx, 'low')
      const slPrice = action === 'SELL' ? slRaw * (1 + slBufferPct) : slRaw * (1 - slBufferPct)
      const risk = Math.abs(entryPrice - slPrice)
      const tpPrice = action === 'SELL' ? entryPrice - risk * rr : entryPrice + risk * rr

      let outcome: Outcome = 'unresolved'
      let rMultiple = 0
      let barsToClose = 0
      for (let j = confirmIdx + 1; j < Math.min(confirmIdx + 1 + maxResolveSafety, bars.length); j++) {
        const b = bars[j]
        barsToClose = j - confirmIdx
        if (action === 'SELL') {
          if (b.low <= tpPrice) { outcome = 'win'; rMultiple = rr; break }
          if (b.high >= slPrice) { outcome = 'loss'; rMultiple = -1; break }
        } else {
          if (b.high >= tpPrice) { outcome = 'win'; rMultiple = rr; break }
          if (b.low <= slPrice) { outcome = 'loss'; rMultiple = -1; break }
        }
      }

      events.push({
        ...base, confirmed: true, barsToConfirm: confirmIdx - i, action,
        entryPrice, slPrice, tpPrice, outcome, rMultiple, barsToClose,
      })
    }

    const confirmedEvents = events.filter(e => e.confirmed)
    const upEvents = events.filter(e => e.direction === 'up')
    const downEvents = events.filter(e => e.direction === 'down')

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      symbol,
      timeframe: tf,
      paramsUsed: {
        pumpLookback, impulseAtrMult, oiRiseMinPct, oiDropFromPeakMinPct,
        maxPeakOffsetBars, rr, ttlBars, confirmBars, vwapWindow, cooldownBars, maxResolveSafety,
      },
      totalBars: bars.length,
      totalCrossings: events.length,
      totalConfirmed: confirmedEvents.length,
      confirmationRatePct: events.length > 0 ? Math.round((confirmedEvents.length / events.length) * 1000) / 10 : 0,
      overall: calcStats(events),
      byDirection: {
        up_to_sell: calcStats(upEvents),
        down_to_buy: calcStats(downEvents),
      },
      timingBars: {
        wins: timingStats(events, 'win'),
        losses: timingStats(events, 'loss'),
      },
      events: events.slice(-300),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest v2'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
