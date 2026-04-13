type SetupStatus = 'open' | 'win' | 'loss'
export type SessionName = 'Asia' | 'London' | 'New York'
export type Timeframe = '1m' | '5m' | '15m' | '1h'
export type SignalType =
  | 'majority_trap_long'
  | 'majority_trap_short'
  | 'bullish_reset'
  | 'bearish_reset'
  | 'continuation_long'
  | 'continuation_short'
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

const setups: StoredSetup[] = []
let currentPosition: LivePosition = null
let lastReverseBarKey: string | null = null

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

export function getCurrentPosition() {
  return currentPosition
}

export function getLastReverseBarKey() {
  return lastReverseBarKey
}

export function getTradeJournal() {
  return setups
}

export function hasRecentDuplicate(
  action: 'BUY' | 'SELL',
  timeframe: Timeframe,
  timestamp: number
) {
  return setups.some(
    (s) =>
      s.action === action &&
      s.timeframe === timeframe &&
      Math.abs(s.timestamp - timestamp) < 5 * 60 * 1000
  )
}

export function openPosition(input: {
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

  setups.unshift(setup)

  currentPosition = {
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

  return setup
}

export function closeCurrentPositionAtMarket(
  timestamp: number,
  exitPrice: number
) {
  if (!currentPosition) return

  const setup = setups.find((s) => s.id === currentPosition?.setupId)
  if (!setup || setup.status !== 'open') {
    currentPosition = null
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

  currentPosition = null
}

export function reversePosition(input: {
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
  closeCurrentPositionAtMarket(input.timestamp, input.entryPrice)
  lastReverseBarKey = input.referenceBarKey
  return openPosition(input)
}

export function evaluateOpenSetups(
  klines: Array<{ time: number; high: number; low: number }>
) {
  for (const setup of setups) {
    if (setup.status !== 'open') continue

    const candlesAfterEntry = klines.filter(
      (k) => k.time * 1000 >= setup.timestamp
    )

    for (const candle of candlesAfterEntry) {
      if (setup.action === 'BUY') {
        const hitSl = candle.low <= setup.stopLoss
        const hitTp = candle.high >= setup.takeProfit

        if (hitSl && hitTp) {
          setup.status = 'loss'
          setup.exitPrice = setup.stopLoss
          setup.rMultiple = -1
          setup.drawdownR = 1
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (currentPosition?.setupId === setup.id) currentPosition = null
          break
        }

        if (hitSl) {
          setup.status = 'loss'
          setup.exitPrice = setup.stopLoss
          setup.rMultiple = -1
          setup.drawdownR = 1
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (currentPosition?.setupId === setup.id) currentPosition = null
          break
        }

        if (hitTp) {
          setup.status = 'win'
          setup.exitPrice = setup.takeProfit
          setup.rMultiple = setup.rr
          setup.drawdownR = 0
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (currentPosition?.setupId === setup.id) currentPosition = null
          break
        }
      } else {
        const hitSl = candle.high >= setup.stopLoss
        const hitTp = candle.low <= setup.takeProfit

        if (hitSl && hitTp) {
          setup.status = 'loss'
          setup.exitPrice = setup.stopLoss
          setup.rMultiple = -1
          setup.drawdownR = 1
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (currentPosition?.setupId === setup.id) currentPosition = null
          break
        }

        if (hitSl) {
          setup.status = 'loss'
          setup.exitPrice = setup.stopLoss
          setup.rMultiple = -1
          setup.drawdownR = 1
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (currentPosition?.setupId === setup.id) currentPosition = null
          break
        }

        if (hitTp) {
          setup.status = 'win'
          setup.exitPrice = setup.takeProfit
          setup.rMultiple = setup.rr
          setup.drawdownR = 0
          setup.closedAt = candle.time * 1000
          setup.durationMinutes = Math.max(
            0,
            (setup.closedAt - setup.timestamp) / 1000 / 60
          )
          if (currentPosition?.setupId === setup.id) currentPosition = null
          break
        }
      }
    }
  }
}

export function getRecentSetups() {
  return setups.slice(0, 25)
}

export function getStats(): SetupStats {
  const wins = setups.filter((s) => s.status === 'win').length
  const losses = setups.filter((s) => s.status === 'loss').length
  const open = setups.filter((s) => s.status === 'open').length
  const totalClosed = wins + losses

  return {
    total: setups.length,
    wins,
    losses,
    open,
    winrate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
  }
}

export function getSessionStats(): SessionStats[] {
  const sessions: SessionName[] = ['Asia', 'London', 'New York']

  return sessions.map((session) => {
    const filtered = setups.filter((s) => s.session === session)
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
