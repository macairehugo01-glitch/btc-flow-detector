import { loadJournalFile, saveJournalFile } from './journalPersistence'
import { sendTelegramMessage } from './lib/telegram'

type SetupStatus = 'open' | 'win' | 'loss'
export type SessionName = 'Asia' | 'London' | 'New York'
export type Timeframe = '1m' | '5m' | '15m' | '1h'

/**
 * Version COMPATIBLE TRANSITION :
 * on garde les anciens + les nouveaux types
 * pour que le build passe tant que route.ts n'a pas encore été remplacé
 */
export type SignalType =
  | 'continuation_long'
  | 'continuation_short'
  | 'breakout'
  | 'bullish_retest'
  | 'bearish_retest'
  | 'majority_trap_long'
  | 'majority_trap_short'
  | 'bullish_reset'
  | 'bearish_reset'
  | 'neutral'

export type MarketRegime = 'trend' | 'range' | 'breakout' | 'reversal'
export type VolatilityBucket = 'low' | 'medium' | 'high'
export type VWAPSide = 'above' | 'below'

export type StoredSetup = {
  id: string

  timestamp: number
  closedAt?: number

  session: SessionName
  weekday: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
  hourBucket: string

  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number

  signalType: SignalType
  marketRegime: MarketRegime
  vwapSide: VWAPSide
  vwapDistancePct: number
  volatilityBucket: VolatilityBucket

  entryPrice: number
  stopLoss: number
  takeProfit: number
  rr: number
  riskPercent: number

  status: SetupStatus
  exitPrice?: number
  rMultiple?: number
  drawdownR?: number
  durationMinutes?: number

  referenceBarKey: string
}

type LivePosition = {
  setupId: string
  action: 'BUY' | 'SELL'
  entryPrice: number
  stopLoss: number
  takeProfit: number
  openedAt: number
  timeframe: Timeframe
  confidence: number
  referenceBarKey: string
} | null

export type SetupStats = {
  total: number
  wins: number
  losses: number
  open: number
  winrate: number
}

export type SessionStats = {
  session: SessionName
  total: number
  wins: number
  losses: number
  open: number
  winrate: number
}

type PersistedState = {
  setups: StoredSetup[]
  currentPosition: LivePosition
  lastReverseBarKey: string | null
}

const initialState: PersistedState = {
  setups: [],
  currentPosition: null,
  lastReverseBarKey: null,
}

const state = loadJournalFile<PersistedState>(initialState)

function persist() {
  saveJournalFile(state)
}

function sessionFromTimestamp(tsMs: number): SessionName {
  const hour = new Date(tsMs).getUTCHours()
  if (hour >= 0 && hour < 7) return 'Asia'
  if (hour >= 7 && hour < 13) return 'London'
  return 'New York'
}

function weekdayFromTimestamp(tsMs: number): StoredSetup['weekday'] {
  const day = new Date(tsMs).getUTCDay()
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] as StoredSetup['weekday']
}

function hourBucketFromTimestamp(tsMs: number) {
  const d = new Date(tsMs)
  const h = d.getUTCHours()
  const next = (h + 1) % 24
  return `${String(h).padStart(2, '0')}:00-${String(next).padStart(2, '0')}:00`
}

function buildRiskLevels(entryPrice: number, action: 'BUY' | 'SELL') {
  const riskMove = entryPrice * 0.002
  const rr = 2

  const stopLoss =
    action === 'BUY' ? entryPrice - riskMove : entryPrice + riskMove

  const takeProfit =
    action === 'BUY'
      ? entryPrice + riskMove * rr
      : entryPrice - riskMove * rr

  return { stopLoss, takeProfit, rr }
}

function computeRealizedR(setup: StoredSetup, exitPrice: number) {
  const risk = Math.abs(setup.entryPrice - setup.stopLoss)
  if (risk === 0) return 0

  if (setup.action === 'BUY') {
    return (exitPrice - setup.entryPrice) / risk
  }

  return (setup.entryPrice - exitPrice) / risk
}

async function notifyOpen(setup: StoredSetup) {
  try {
    await sendTelegramMessage(
`📈 *NEW TRADE*

${setup.action} ${setup.timeframe}

Price: ${setup.entryPrice}
SL: ${setup.stopLoss}
TP: ${setup.takeProfit}
RR: ${setup.rr}

Confidence: ${setup.confidence}/5
Type: ${setup.signalType}

VWAP dist: ${setup.vwapDistancePct.toFixed(3)}%
Session: ${setup.session}`
    )
  } catch (err) {
    console.error('[Telegram] notifyOpen error:', err)
  }
}

async function notifyClose(setup: StoredSetup) {
  try {
    await sendTelegramMessage(
`📉 *TRADE CLOSED*

Result: ${setup.status.toUpperCase()}
R: ${setup.rMultiple?.toFixed(2)}

Duration: ${setup.durationMinutes?.toFixed(1)} min`
    )
  } catch (err) {
    console.error('[Telegram] notifyClose error:', err)
  }
}

export function getCurrentPosition() {
  return state.currentPosition
}

export function getLastReverseBarKey() {
  return state.lastReverseBarKey
}

export function getTradeJournal() {
  return state.setups
}

export function hasRecentDuplicate(
  action: 'BUY' | 'SELL',
  timeframe: Timeframe,
  timestamp: number
) {
  return state.setups.some(
    (s) =>
      s.action === action &&
      s.timeframe === timeframe &&
      Math.abs(s.timestamp - timestamp) < 5 * 60 * 1000
  )
}

export async function openPosition(input: {
  timestamp: number
  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
  referenceBarKey: string

  signalType: SignalType
  marketRegime: MarketRegime
  vwapDistancePct: number
  volatilityBucket: VolatilityBucket
}) {
  const { stopLoss, takeProfit, rr } = buildRiskLevels(
    input.entryPrice,
    input.action
  )

  const setup: StoredSetup = {
    id: `${input.action}-${input.timeframe}-${input.timestamp}`,

    timestamp: input.timestamp,
    session: sessionFromTimestamp(input.timestamp),
    weekday: weekdayFromTimestamp(input.timestamp),
    hourBucket: hourBucketFromTimestamp(input.timestamp),

    timeframe: input.timeframe,
    action: input.action,
    confidence: input.confidence,

    signalType: input.signalType,
    marketRegime: input.marketRegime,
    vwapSide: input.action === 'BUY' ? 'above' : 'below',
    vwapDistancePct: input.vwapDistancePct,
    volatilityBucket: input.volatilityBucket,

    entryPrice: input.entryPrice,
    stopLoss,
    takeProfit,
    rr,
    riskPercent: 3,

    status: 'open',
    referenceBarKey: input.referenceBarKey,
  }

  state.setups.unshift(setup)

  state.currentPosition = {
    setupId: setup.id,
    action: setup.action,
    entryPrice: setup.entryPrice,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    openedAt: setup.timestamp,
    timeframe: setup.timeframe,
    confidence: setup.confidence,
    referenceBarKey: setup.referenceBarKey,
  }

  persist()
  await notifyOpen(setup)
  return setup
}

export async function closeCurrentPositionAtMarket(
  timestamp: number,
  exitPrice: number
) {
  if (!state.currentPosition) return

  const setup = state.setups.find((s) => s.id === state.currentPosition?.setupId)
  if (!setup || setup.status !== 'open') {
    state.currentPosition = null
    persist()
    return
  }

  const realizedR = computeRealizedR(setup, exitPrice)

  setup.exitPrice = exitPrice
  setup.rMultiple = realizedR
  setup.drawdownR = realizedR < 0 ? Math.abs(realizedR) : 0
  setup.closedAt = timestamp
  setup.durationMinutes = Math.max(
    0,
    (timestamp - setup.timestamp) / 1000 / 60
  )
  setup.status = realizedR >= 0 ? 'win' : 'loss'

  state.currentPosition = null
  persist()
  await notifyClose(setup)
}

export async function reversePosition(input: {
  timestamp: number
  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
  referenceBarKey: string

  signalType: SignalType
  marketRegime: MarketRegime
  vwapDistancePct: number
  volatilityBucket: VolatilityBucket
}) {
  await closeCurrentPositionAtMarket(input.timestamp, input.entryPrice)
  state.lastReverseBarKey = input.referenceBarKey
  persist()
  return openPosition(input)
}

export function evaluateOpenSetups(
  klines: Array<{ time: number; high: number; low: number }>
) {
  let changed = false

  for (const setup of state.setups) {
    if (setup.status !== 'open') continue

    const candlesAfterEntry = klines.filter(
      (k) => k.time * 1000 >= setup.timestamp
    )

    for (const candle of candlesAfterEntry) {
      if (setup.action === 'BUY') {
        const hitSl = candle.low <= setup.stopLoss
        const hitTp = candle.high >= setup.takeProfit

        if (hitSl || hitTp) {
          setup.status = hitTp ? 'win' : 'loss'
          setup.exitPrice = hitTp ? setup.takeProfit : setup.stopLoss
          setup.rMultiple = hitTp ? setup.rr : -1
          setup.drawdownR = hitTp ? 0 : 1
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (state.currentPosition?.setupId === setup.id) state.currentPosition = null
          notifyClose(setup)
          changed = true
          break
        }
      } else {
        const hitSl = candle.high >= setup.stopLoss
        const hitTp = candle.low <= setup.takeProfit

        if (hitSl || hitTp) {
          setup.status = hitTp ? 'win' : 'loss'
          setup.exitPrice = hitTp ? setup.takeProfit : setup.stopLoss
          setup.rMultiple = hitTp ? setup.rr : -1
          setup.drawdownR = hitTp ? 0 : 1
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (state.currentPosition?.setupId === setup.id) state.currentPosition = null
          notifyClose(setup)
          changed = true
          break
        }
      }
    }
  }

  if (changed) persist()
}

export function getRecentSetups() {
  return state.setups.slice(0, 25)
}

export function getStats(): SetupStats {
  const wins = state.setups.filter((s) => s.status === 'win').length
  const losses = state.setups.filter((s) => s.status === 'loss').length
  const open = state.setups.filter((s) => s.status === 'open').length
  const totalClosed = wins + losses

  return {
    total: state.setups.length,
    wins,
    losses,
    open,
    winrate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
  }
}

export function getSessionStats(): SessionStats[] {
  const sessions: SessionName[] = ['Asia', 'London', 'New York']

  return sessions.map((session) => {
    const filtered = state.setups.filter((s) => s.session === session)
    const wins = filtered.filter((s) => s.status === 'win').length
    const losses = filtered.filter((s) => s.status === 'loss').length
    const open = filtered.filter((s) => s.status === 'open').length
    const totalClosed = wins + losses

    return {
      session,
      total: filtered.length,
      wins,
      losses,
      open,
      winrate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
    }
  })
}
