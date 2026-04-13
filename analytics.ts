import type { StoredSetup } from './store'

export type AnalyticsRow = {
  label: string
  trades: number
  wins: number
  losses: number
  open: number
  winrate: number
  rTotal: number
  expectancy: number
  profitFactor: number
  avgDurationMin: number
  avgDrawdownR: number
}

export type EquityPoint = {
  index: number
  cumulativeR: number
  tradeId: string
  timestamp: number
}

export type DrawdownStats = {
  maxDrawdownR: number
  currentDrawdownR: number
}

export type StreakStats = {
  maxWinStreak: number
  maxLossStreak: number
  currentWinStreak: number
  currentLossStreak: number
}

export type HeatmapCell = {
  weekday: string
  hourBucket: string
  trades: number
  expectancy: number
  rTotal: number
}

export type AnalyticsSnapshot = {
  overview: AnalyticsRow
  byHour: AnalyticsRow[]
  bySession: AnalyticsRow[]
  byDirection: AnalyticsRow[]
  byTimeframe: AnalyticsRow[]
  byConfidence: AnalyticsRow[]
  byDuration: AnalyticsRow[]
  byVWAPDistance: AnalyticsRow[]
  byRegime: AnalyticsRow[]
  byWeekday: AnalyticsRow[]
  bySignalType: AnalyticsRow[]
  equityCurve: EquityPoint[]
  drawdown: DrawdownStats
  streaks: StreakStats
  heatmap: HeatmapCell[]
}

function round(n: number, d = 2) {
  return Number(n.toFixed(d))
}

function durationBucket(min?: number) {
  if (min == null) return 'open'
  if (min < 5) return '<5 min'
  if (min < 15) return '5–15 min'
  if (min < 60) return '15–60 min'
  return '>60 min'
}

function vwapDistanceBucket(v: number) {
  if (v <= 0.25) return '0–0.25%'
  if (v <= 0.5) return '0.25–0.5%'
  if (v <= 1) return '0.5–1%'
  return '>1%'
}

function buildRow(label: string, trades: StoredSetup[]): AnalyticsRow {
  const wins = trades.filter((t) => t.status === 'win')
  const losses = trades.filter((t) => t.status === 'loss')
  const open = trades.filter((t) => t.status === 'open')
  const closed = trades.filter((t) => t.status !== 'open')

  const grossProfit = wins.reduce((s, t) => s + (t.rMultiple ?? 0), 0)
  const grossLossAbs = Math.abs(
    losses.reduce((s, t) => s + (t.rMultiple ?? 0), 0)
  )
  const rTotal = closed.reduce((s, t) => s + (t.rMultiple ?? 0), 0)

  const avgDurationMin =
    closed.length > 0
      ? closed.reduce((s, t) => s + (t.durationMinutes ?? 0), 0) / closed.length
      : 0

  const avgDrawdownR =
    closed.length > 0
      ? closed.reduce((s, t) => s + (t.drawdownR ?? 0), 0) / closed.length
      : 0

  return {
    label,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    open: open.length,
    winrate:
      closed.length > 0 ? round((wins.length / closed.length) * 100, 2) : 0,
    rTotal: round(rTotal, 2),
    expectancy: closed.length > 0 ? round(rTotal / closed.length, 3) : 0,
    profitFactor:
      grossLossAbs > 0 ? round(grossProfit / grossLossAbs, 3) : grossProfit > 0 ? 999 : 0,
    avgDurationMin: round(avgDurationMin, 2),
    avgDrawdownR: round(avgDrawdownR, 3),
  }
}

function groupByLabel(
  journal: StoredSetup[],
  selector: (t: StoredSetup) => string
): AnalyticsRow[] {
  const map = new Map<string, StoredSetup[]>()

  for (const trade of journal) {
    const label = selector(trade)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(trade)
  }

  return [...map.entries()]
    .map(([label, trades]) => buildRow(label, trades))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function buildEquityCurve(journal: StoredSetup[]): EquityPoint[] {
  const closed = journal
    .filter((t) => t.status !== 'open' && t.closedAt)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))

  let cumulativeR = 0

  return closed.map((trade, index) => {
    cumulativeR += trade.rMultiple ?? 0
    return {
      index: index + 1,
      cumulativeR: round(cumulativeR, 3),
      tradeId: trade.id,
      timestamp: trade.closedAt ?? trade.timestamp,
    }
  })
}

function buildDrawdown(equityCurve: EquityPoint[]): DrawdownStats {
  let peak = 0
  let maxDrawdown = 0
  let currentDrawdown = 0

  for (const point of equityCurve) {
    if (point.cumulativeR > peak) peak = point.cumulativeR
    const dd = peak - point.cumulativeR
    if (dd > maxDrawdown) maxDrawdown = dd
    currentDrawdown = dd
  }

  return {
    maxDrawdownR: round(maxDrawdown, 3),
    currentDrawdownR: round(currentDrawdown, 3),
  }
}

function buildStreaks(journal: StoredSetup[]): StreakStats {
  const closed = journal
    .filter((t) => t.status !== 'open')
    .sort((a, b) => (a.closedAt ?? a.timestamp) - (b.closedAt ?? b.timestamp))

  let maxWinStreak = 0
  let maxLossStreak = 0
  let currentWin = 0
  let currentLoss = 0

  for (const trade of closed) {
    if (trade.status === 'win') {
      currentWin += 1
      currentLoss = 0
    } else if (trade.status === 'loss') {
      currentLoss += 1
      currentWin = 0
    }

    if (currentWin > maxWinStreak) maxWinStreak = currentWin
    if (currentLoss > maxLossStreak) maxLossStreak = currentLoss
  }

  let currentWinStreak = 0
  let currentLossStreak = 0

  for (let i = closed.length - 1; i >= 0; i--) {
    if (closed[i].status === 'win' && currentLossStreak === 0) {
      currentWinStreak += 1
    } else if (closed[i].status === 'loss' && currentWinStreak === 0) {
      currentLossStreak += 1
    } else {
      break
    }
  }

  return {
    maxWinStreak,
    maxLossStreak,
    currentWinStreak,
    currentLossStreak,
  }
}

function buildHeatmap(journal: StoredSetup[]): HeatmapCell[] {
  const map = new Map<string, StoredSetup[]>()

  for (const t of journal) {
    const key = `${t.weekday}__${t.hourBucket}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(t)
  }

  return [...map.entries()].map(([key, trades]) => {
    const [weekday, hourBucket] = key.split('__')
    const row = buildRow(key, trades)
    return {
      weekday,
      hourBucket,
      trades: row.trades,
      expectancy: row.expectancy,
      rTotal: row.rTotal,
    }
  })
}

export function getAnalyticsSnapshot(journal: StoredSetup[]): AnalyticsSnapshot {
  const equityCurve = buildEquityCurve(journal)

  return {
    overview: buildRow('Overview', journal),

    byHour: groupByLabel(journal, (t) => t.hourBucket),
    bySession: groupByLabel(journal, (t) => t.session),
    byDirection: groupByLabel(journal, (t) => t.action),
    byTimeframe: groupByLabel(journal, (t) => t.timeframe),
    byConfidence: groupByLabel(journal, (t) => `${t.confidence}/5`),
    byDuration: groupByLabel(journal, (t) => durationBucket(t.durationMinutes)),
    byVWAPDistance: groupByLabel(journal, (t) => vwapDistanceBucket(t.vwapDistancePct)),
    byRegime: groupByLabel(journal, (t) => t.marketRegime),
    byWeekday: groupByLabel(journal, (t) => t.weekday),
    bySignalType: groupByLabel(journal, (t) => t.signalType),

    equityCurve,
    drawdown: buildDrawdown(equityCurve),
    streaks: buildStreaks(journal),
    heatmap: buildHeatmap(journal),
  }
}
