import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

// ───────────────────────────────────────────────────────────────────
// HYPOTHÈSE TESTÉE ICI : forme en cloche de l'OI — IDENTIQUE dans les
// deux sens, parce que l'OI ne distingue pas long/short.
//
//   Phase 1 (FOMO)            : OI MONTE (positions qui s'ouvrent,
//                                que ce soit des longs sur un pump
//                                ou des shorts sur un dump)
//   Phase 2 (haut/bas du move): OI redescend déjà au moment du trigger
//   Phase 3 (retour vers VWAP): OI continue de baisser pendant la
//                                confirmation (vérifié en plus du
//                                croisement VWAP existant)
//
// Le sens du PRIX (up/down) détermine seulement SELL vs BUY et le
// sens de la confirmation VWAP — la FORME de l'OI recherchée (pic,
// pas creux) est la même dans les deux cas.
//
// Différent du détecteur actuel (squeeze/route.ts) qui ne regarde
// que le solde net OI(fin) - OI(début) sur 5 bougies, sans forme.
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

type SqueezeDirection = 'up' | 'down'
type SqueezeOutcome = 'win' | 'loss' | 'breakeven' | 'no_confirmation'

type BellEvent = {
  triggerTime: number
  direction: SqueezeDirection
  priceMovePct: number
  oiRiseToPeakPct: number   // phase 1 : montée FOMO mesurée
  oiDropFromPeakPct: number // phase 2 : redescente déjà entamée au trigger
  peakOffsetBars: number    // combien de bougies avant le trigger le pic d'OI a eu lieu
  confirmed: boolean
  barsToConfirm?: number
  action?: 'BUY' | 'SELL'
  entryPrice?: number
  slPrice?: number
  tpPrice?: number
  outcome: SqueezeOutcome
  rMultiple: number
  barsToClose?: number
  oiKeptDroppingDuringConfirm?: boolean // phase 3 vérifiée ou non
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

// ─── DÉTECTION DE LA FORME EN CLOCHE ─────────────────────────────
// Regarde une fenêtre de `pumpLookback` bougies avant le trigger.
// Trouve le pic d'OI dans cette fenêtre, vérifie qu'il a bien monté
// depuis le début de fenêtre (phase 1), et qu'il a déjà redescendu
// d'au moins X% jusqu'à la bougie de trigger (phase 2 amorcée).
function detectBellShapeAt(
  bars: RawBar[],
  atr: number[],
  i: number,
  pumpLookback: number,
  impulseAtrMult: number,
  oiRiseMinPct: number,
  oiDropFromPeakMinPct: number,
  maxPeakOffsetBars: number
): { direction: SqueezeDirection; priceMovePct: number; oiRiseToPeakPct: number; oiDropFromPeakPct: number; peakOffsetBars: number } | null {
  const windowStart = i - pumpLookback + 1
  if (windowStart < 0) return null

  const startBar = bars[windowStart]
  const endBar = bars[i]
  const priceMove = endBar.close - startBar.close
  const direction: SqueezeDirection = priceMove > 0 ? 'up' : 'down'
  const priceMovePct = (priceMove / startBar.close) * 100

  // Magnitude de l'impulsion (même logique que le moteur existant,
  // sur toute la fenêtre pump plutôt que les 5 dernières bougies).
  if (Math.abs(priceMove) <= impulseAtrMult * atr[i]) return null

  if (!startBar.oi || startBar.oi <= 0) return null

  // Trouver le pic d'OI dans la fenêtre — TOUJOURS un maximum, peu
  // importe la direction du prix. L'OI ne distingue pas long/short :
  // un "fake pump" (FOMO de nouveaux longs) et un "fake dump" (FOMO
  // de nouveaux shorts) produisent tous les deux la même forme —
  // OI qui monte (positions qui s'ouvrent) puis qui descend
  // (positions qui se ferment en panique/liquidation), peu importe
  // le sens du prix.
  let peakIdx = windowStart
  let peakOi = bars[windowStart].oi
  for (let k = windowStart; k <= i; k++) {
    if (bars[k].oi > peakOi) { peakOi = bars[k].oi; peakIdx = k }
  }

  // Le pic ne doit pas être la dernière bougie — il faut qu'il y ait
  // déjà une redescente amorcée au moment du trigger (phase 2).
  if (peakIdx === i) return null

  // Soudaineté du dump : le pic d'OI doit être à maxPeakOffsetBars
  // bougies maximum du trigger.
  if (i - peakIdx > maxPeakOffsetBars) return null

  const oiRiseToPeakPct = ((peakOi - startBar.oi) / startBar.oi) * 100
  if (oiRiseToPeakPct < oiRiseMinPct) return null

  const oiDropFromPeakPct = ((peakOi - endBar.oi) / peakOi) * 100
  if (oiDropFromPeakPct < oiDropFromPeakMinPct) return null

  return {
    direction,
    priceMovePct,
    oiRiseToPeakPct: Math.round(oiRiseToPeakPct * 100) / 100,
    oiDropFromPeakPct: Math.round(oiDropFromPeakPct * 100) / 100,
    peakOffsetBars: i - peakIdx,
  }
}

function resolveBellTrade(
  bars: RawBar[],
  triggerIdx: number,
  triggerInfo: { direction: SqueezeDirection; priceMovePct: number; oiRiseToPeakPct: number; oiDropFromPeakPct: number; peakOffsetBars: number },
  ttlBars: number,
  rr: number,
  vwapWindow: number,
  maxBarsToResolve: number,
  confirmBars: number,
  requireOiKeepDropping: boolean,
  slBufferPct: number,
  pumpLookback: number,
  slLookback: number
): BellEvent {
  // Fenêtre SL/TP dédiée, plus courte que pumpLookback — évite de
  // placer le stop sur l'amplitude de TOUT le mouvement pump quand
  // celui-ci est déjà bien avancé au moment du trigger.
  const slWindowStart = triggerIdx - slLookback + 1
  const windowBars = bars.slice(slWindowStart, triggerIdx + 1)
  const windowHigh = Math.max(...windowBars.map(b => b.high))
  const windowLow = Math.min(...windowBars.map(b => b.low))

  const base = {
    triggerTime: bars[triggerIdx].time,
    direction: triggerInfo.direction,
    priceMovePct: Math.round(triggerInfo.priceMovePct * 1000) / 1000,
    oiRiseToPeakPct: triggerInfo.oiRiseToPeakPct,
    oiDropFromPeakPct: triggerInfo.oiDropFromPeakPct,
    peakOffsetBars: triggerInfo.peakOffsetBars,
  }

  let consecutiveCount = 0
  let confirmBarIdx = -1
  let oiAtTrigger = bars[triggerIdx].oi

  for (let j = triggerIdx + 1; j < Math.min(triggerIdx + 1 + ttlBars, bars.length); j++) {
    const vwapJ = computeVWAPAt(bars, j, vwapWindow)
    const closeJ = bars[j].close
    const onOppositeSide = triggerInfo.direction === 'up' ? closeJ < vwapJ : closeJ > vwapJ

    // Phase 3 : pendant l'attente de confirmation, l'OI doit
    // continuer à baisser — dans les DEUX sens, puisque la forme
    // recherchée est la même (pic puis chute) peu importe la
    // direction du prix.
    if (requireOiKeepDropping) {
      const stillDropping = bars[j].oi <= oiAtTrigger
      if (!stillDropping) {
        return { ...base, confirmed: false, outcome: 'no_confirmation', rMultiple: 0, oiKeptDroppingDuringConfirm: false }
      }
      oiAtTrigger = bars[j].oi
    }

    if (onOppositeSide) {
      consecutiveCount++
      if (consecutiveCount >= confirmBars) { confirmBarIdx = j; break }
    } else {
      consecutiveCount = 0
    }
  }

  if (confirmBarIdx === -1) {
    return { ...base, confirmed: false, outcome: 'no_confirmation', rMultiple: 0, oiKeptDroppingDuringConfirm: requireOiKeepDropping }
  }

  const action: 'BUY' | 'SELL' = triggerInfo.direction === 'up' ? 'SELL' : 'BUY'
  const entryPrice = bars[confirmBarIdx].close
  const slPrice = action === 'SELL' ? windowHigh * (1 + slBufferPct) : windowLow * (1 - slBufferPct)
  const risk = Math.abs(entryPrice - slPrice)
  const tpPrice = action === 'SELL' ? entryPrice - risk * rr : entryPrice + risk * rr

  let outcome: SqueezeOutcome = 'breakeven'
  let rMultiple = 0
  let barsToClose = 0

  for (let j = confirmBarIdx + 1; j < Math.min(confirmBarIdx + 1 + maxBarsToResolve, bars.length); j++) {
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
    ...base, confirmed: true, barsToConfirm: confirmBarIdx - triggerIdx, action,
    entryPrice, slPrice, tpPrice, outcome, rMultiple, barsToClose,
    oiKeptDroppingDuringConfirm: requireOiKeepDropping,
  }
}

function calcStats(events: BellEvent[]): StatBlock {
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

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()
  const tf = url.searchParams.get('tf') ?? '1h'

  // Fenêtre de recherche du pic d'OI — plus large que les 5 bougies
  // du détecteur actuel, puisqu'on cherche une forme, pas juste un
  // solde net sur une courte fenêtre.
  const pumpLookback = Number(url.searchParams.get('pumpLookback') ?? 12)
  const impulseAtrMult = Number(url.searchParams.get('atrMult') ?? 1.0)
  const oiRiseMinPct = Number(url.searchParams.get('oiRiseMin') ?? 2)
  const oiDropFromPeakMinPct = Number(url.searchParams.get('oiDropFromPeakMin') ?? 0.5)
  // Soudaineté du dump : le pic d'OI doit être à maxPeakOffsetBars
  // bougies maximum du trigger. Défaut=2 pour exiger un dump "d'un
  // coup" comme décrit (pic puis chute quasi immédiate), au lieu de
  // la valeur précédente qui acceptait jusqu'à 10 bougies d'écart.
  const maxPeakOffsetBars = Number(url.searchParams.get('maxPeakOffsetBars') ?? 2)
  // Fenêtre dédiée pour le calcul du SL/TP — par défaut égale à
  // pumpLookback (comportement d'avant), mais testable séparément
  // pour éviter un stop placé sur l'amplitude du mouvement entier.
  const slLookback = Number(url.searchParams.get('slLookback') ?? pumpLookback)
  const requireOiKeepDropping = url.searchParams.get('requireOiKeepDropping') === 'true'
  const rr = Number(url.searchParams.get('rr') ?? 1.5)
  const ttlBars = Number(url.searchParams.get('ttl') ?? 8)
  const confirmBars = Number(url.searchParams.get('confirmBars') ?? 2)
  const vwapWindow = Number(url.searchParams.get('vwapWindow') ?? 50)
  const maxBarsToResolve = Number(url.searchParams.get('maxBarsToResolve') ?? 16)
  const slBufferPct = 0.002
  const atrPeriod = 14
  const cooldownBars = Number(url.searchParams.get('cooldown') ?? 12)

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

    const events: BellEvent[] = []
    let lastTriggerIdx = -Infinity

    for (let i = pumpLookback + atrPeriod; i < bars.length - ttlBars - maxBarsToResolve; i++) {
      if (i - lastTriggerIdx < cooldownBars) continue
      const triggerInfo = detectBellShapeAt(bars, atr, i, pumpLookback, impulseAtrMult, oiRiseMinPct, oiDropFromPeakMinPct, maxPeakOffsetBars)
      if (triggerInfo) {
        events.push(resolveBellTrade(
          bars, i, triggerInfo, ttlBars, rr, vwapWindow, maxBarsToResolve,
          confirmBars, requireOiKeepDropping, slBufferPct, pumpLookback, slLookback
        ))
        lastTriggerIdx = i
      }
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
        maxPeakOffsetBars, slLookback, requireOiKeepDropping, rr, ttlBars, confirmBars, vwapWindow,
        maxBarsToResolve, cooldownBars,
      },
      totalBars: bars.length,
      totalTriggers: events.length,
      totalConfirmed: confirmedEvents.length,
      confirmationRatePct: events.length > 0 ? Math.round((confirmedEvents.length / events.length) * 1000) / 10 : 0,
      overall: calcStats(events),
      byDirection: {
        up_to_sell: calcStats(upEvents),
        down_to_buy: calcStats(downEvents),
      },
      events: events.slice(-300),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest bell-shape'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
