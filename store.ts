type SetupStatus = 'open' | 'win' | 'loss'
type SessionName = 'Asia' | 'London' | 'New York'
type Timeframe = '1m' | '5m' | '15m' | '1h'

type StoredSetup = {
  id: string
  timestamp: number
  session: SessionName
  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  rr: number
  status: SetupStatus
  closedAt?: number
}

type SetupStats = {
  total: number
  wins: number
  losses: number
  open: number
  winrate: number
}

type SessionStats = {
  session: SessionName
  total: number
  wins: number
  losses: number
  open: number
  winrate: number
}

const setups: StoredSetup[] = []

function sessionFromTimestamp(tsMs: number): SessionName {
  const hour = new Date(tsMs).getUTCHours()

  if (hour >= 0 && hour < 7) return 'Asia'
  if (hour >= 7 && hour < 13) return 'London'
  return 'New York'
}

export function createSetup(input: {
  timestamp: number
  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
}) {
  const move = input.entryPrice * 0.002
  const rr = 2

  const stopLoss =
    input.action === 'BUY' ? input.entryPrice - move : input.entryPrice + move

  const takeProfit =
    input.action === 'BUY'
      ? input.entryPrice + move * rr
      : input.entryPrice - move * rr

  const setup: StoredSetup = {
    id: `${input.action}-${input.timeframe}-${input.timestamp}`,
    timestamp: input.timestamp,
    session: sessionFromTimestamp(input.timestamp),
    timeframe: input.timeframe,
    action: input.action,
    confidence: input.confidence,
    entryPrice: input.entryPrice,
    stopLoss,
    takeProfit,
    rr,
    status: 'open',
  }

  setups.unshift(setup)
  return setup
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
          setup.closedAt = candle.time * 1000
          break
        }

        if (hitSl) {
          setup.status = 'loss'
          setup.closedAt = candle.time * 1000
          break
        }

        if (hitTp) {
          setup.status = 'win'
          setup.closedAt = candle.time * 1000
          break
        }
      } else {
        const hitSl = candle.high >= setup.stopLoss
        const hitTp = candle.low <= setup.takeProfit

        if (hitSl && hitTp) {
          setup.status = 'loss'
          setup.closedAt = candle.time * 1000
          break
        }

        if (hitSl) {
          setup.status = 'loss'
          setup.closedAt = candle.time * 1000
          break
        }

        if (hitTp) {
          setup.status = 'win'
          setup.closedAt = candle.time * 1000
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
