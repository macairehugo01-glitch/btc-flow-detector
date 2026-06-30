import { loadJournalFile, saveJournalFile } from './journalPersistence'
import { sendTelegramMessage } from './lib/telegram'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type SetupStatus = 'open' | 'win' | 'loss'
export type SlotKey =
  | 'BTC-1h' | 'ETH-1h' | 'SOL-1h' | 'XRP-1h'
  | 'BTC-15m-v2' | 'ETH-15m-v2' | 'SOL-15m-v2'
export type SessionName = 'Asia' | 'London' | 'New York'
export type Timeframe = '1m' | '5m' | '15m' | '1h'

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
  slot: SlotKey
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

export type LivePosition = {
  setupId: string
  slot: SlotKey
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

// ─── ÉTAT PERSISTÉ ────────────────────────────────────────────────────────────

type SlotState = {
  position: LivePosition
  lastLossTimestamp: number | null
  lastReferenceBarKey: string | null
}

type PersistedState = {
  setups: StoredSetup[]
  // Ancien format (migration)
  currentPosition?: LivePosition
  lastLossTimestamp?: number | null
  lastReverseBarKey?: string | null
  // Format 4 slots
  slots: Record<SlotKey, SlotState>
}

const ALL_SLOTS: SlotKey[] = [
  'BTC-1h', 'ETH-1h', 'SOL-1h', 'XRP-1h',
  'BTC-15m-v2', 'ETH-15m-v2', 'SOL-15m-v2',
]

const DEFAULT_SLOT: SlotState = {
  position: null,
  lastLossTimestamp: null,
  lastReferenceBarKey: null,
}

const initialState: PersistedState = {
  setups: [],
  slots: {
    'BTC-1h': { ...DEFAULT_SLOT },
    'ETH-1h': { ...DEFAULT_SLOT },
    'SOL-1h': { ...DEFAULT_SLOT },
    'XRP-1h': { ...DEFAULT_SLOT },
    'BTC-15m-v2': { ...DEFAULT_SLOT },
    'ETH-15m-v2': { ...DEFAULT_SLOT },
    'SOL-15m-v2': { ...DEFAULT_SLOT },
  },
}

const state = loadJournalFile<PersistedState>(initialState)

// ── Migration depuis l'ancien format ──
if (!state.slots) {
  state.slots = {
    'BTC-1h':  { position: state.currentPosition ?? null, lastLossTimestamp: state.lastLossTimestamp ?? null, lastReferenceBarKey: state.lastReverseBarKey ?? null },
    'ETH-1h':  { ...DEFAULT_SLOT },
    'SOL-1h':  { ...DEFAULT_SLOT },
    'XRP-1h':  { ...DEFAULT_SLOT },
    'BTC-15m-v2': { ...DEFAULT_SLOT },
    'ETH-15m-v2': { ...DEFAULT_SLOT },
    'SOL-15m-v2': { ...DEFAULT_SLOT },
  }
}
// Les anciens slots BTC-15m/ETH-15m (stratégie LFR précédente, SANS le
// suffixe -v2) restent orphelins dans le fichier persisté si présents —
// inoffensif, jamais lus puisque ALL_SLOTS ne les contient plus.
for (const slot of ALL_SLOTS) {
  if (!state.slots[slot]) state.slots[slot] = { ...DEFAULT_SLOT }
}

function persist() {
  saveJournalFile(state)
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

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
  const h = new Date(tsMs).getUTCHours()
  const next = (h + 1) % 24
  return `${String(h).padStart(2, '0')}:00-${String(next).padStart(2, '0')}:00`
}

function buildRiskLevels(entryPrice: number, action: 'BUY' | 'SELL', vwap: number) {
  const VWAP_BUFFER = 0.0015
  const RR = 3 // TP 3R — validé par backtest (ancienne stratégie LFR)

  const stopLoss = action === 'BUY'
    ? vwap * (1 - VWAP_BUFFER)
    : vwap * (1 + VWAP_BUFFER)

  const riskMove = Math.abs(entryPrice - stopLoss)

  const takeProfit = action === 'BUY'
    ? entryPrice + riskMove * RR
    : entryPrice - riskMove * RR

  return { stopLoss, takeProfit, rr: RR }
}

function computeRealizedR(setup: StoredSetup, exitPrice: number) {
  const risk = Math.abs(setup.entryPrice - setup.stopLoss)
  if (risk === 0) return 0
  if (setup.action === 'BUY') return (exitPrice - setup.entryPrice) / risk
  return (setup.entryPrice - exitPrice) / risk
}

function escapeMarkdown(text: string): string {
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*').replace(/\[/g, '\\[')
}

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

async function notifyOpen(setup: StoredSetup) {
  try {
    await sendTelegramMessage(
`📈 *NEW TRADE — ${setup.slot}*

${setup.action} ${setup.timeframe}

Price: ${setup.entryPrice}
SL: ${setup.stopLoss.toFixed(2)}
TP: ${setup.takeProfit.toFixed(2)} (${setup.rr}R)

Confidence: ${setup.confidence}/5
Type: ${escapeMarkdown(setup.signalType)}
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
`📉 *TRADE CLOSED — ${setup.slot}*

Result: ${setup.status.toUpperCase()}
R: ${setup.rMultiple?.toFixed(2)}
Duration: ${setup.durationMinutes?.toFixed(1)} min`
    )
  } catch (err) {
    console.error('[Telegram] notifyClose error:', err)
  }
}

// ─── GETTERS ─────────────────────────────────────────────────────────────────

export function getCurrentPosition(slot: SlotKey): LivePosition {
  return state.slots[slot]?.position ?? null
}

export function getAllPositions(): Record<SlotKey, LivePosition> {
  const result = {} as Record<SlotKey, LivePosition>
  for (const slot of ALL_SLOTS) result[slot] = state.slots[slot]?.position ?? null
  return result
}

export function getLastReferenceBarKey(slot: SlotKey): string | null {
  return state.slots[slot]?.lastReferenceBarKey ?? null
}

export function isInCooldown(slot: SlotKey): boolean {
  const lastLoss = state.slots[slot]?.lastLossTimestamp
  if (!lastLoss) return false
  // Cooldown générique après une perte — NON utilisé par la stratégie
  // squeeze actuelle, qui gère son propre cooldown (12h depuis la
  // détection du trigger, indépendant des pertes) via journalPersistence's
  // SqueezeDetectorState. Conservé ici pour compatibilité éventuelle.
  const cooldownMs = 4 * 60 * 60 * 1000
  return Date.now() - lastLoss < cooldownMs
}

export function hasRecentDuplicate(slot: SlotKey, action: 'BUY' | 'SELL', timestamp: number): boolean {
  return state.setups.some(
    s => s.slot === slot && s.action === action && Math.abs(s.timestamp - timestamp) < 5 * 60 * 1000
  )
}

export function getRecentSetups() {
  return state.setups.slice(0, 50)
}

export function getStats(): SetupStats {
  const wins = state.setups.filter(s => s.status === 'win').length
  const losses = state.setups.filter(s => s.status === 'loss').length
  const open = state.setups.filter(s => s.status === 'open').length
  const totalClosed = wins + losses
  return {
    total: state.setups.length,
    wins, losses, open,
    winrate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
  }
}

export function getSlotStats(): Record<SlotKey, SetupStats> {
  const result = {} as Record<SlotKey, SetupStats>
  for (const slot of ALL_SLOTS) {
    const slotSetups = state.setups.filter(s => s.slot === slot)
    const wins = slotSetups.filter(s => s.status === 'win').length
    const losses = slotSetups.filter(s => s.status === 'loss').length
    const open = slotSetups.filter(s => s.status === 'open').length
    const totalClosed = wins + losses
    result[slot] = {
      total: slotSetups.length,
      wins, losses, open,
      winrate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
    }
  }
  return result
}

export function getSessionStats(): SessionStats[] {
  const sessions: SessionName[] = ['Asia', 'London', 'New York']
  return sessions.map(session => {
    const filtered = state.setups.filter(s => s.session === session)
    const wins = filtered.filter(s => s.status === 'win').length
    const losses = filtered.filter(s => s.status === 'loss').length
    const open = filtered.filter(s => s.status === 'open').length
    const totalClosed = wins + losses
    return {
      session, total: filtered.length,
      wins, losses, open,
      winrate: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
    }
  })
}

export function getTradeJournal() {
  return state.setups
}

// ─── ACTIONS ─────────────────────────────────────────────────────────────────

export async function openPosition(input: {
  slot: SlotKey
  timestamp: number
  timeframe: Timeframe
  action: 'BUY' | 'SELL'
  confidence: number
  entryPrice: number
  vwap: number
  referenceBarKey: string
  signalType: SignalType
  marketRegime: MarketRegime
  vwapDistancePct: number
  volatilityBucket: VolatilityBucket
  // Optionnel — si les trois sont fournis, ils sont utilisés directement
  // au lieu d'être dérivés de la VWAP via buildRiskLevels. Utilisé par la
  // stratégie squeeze H1, dont le SL/TP est basé sur la fenêtre
  // d'impulsion (windowHigh/windowLow), pas sur la VWAP.
  stopLoss?: number
  takeProfit?: number
  rr?: number
}) {
  const useExplicitLevels = input.stopLoss !== undefined && input.takeProfit !== undefined && input.rr !== undefined
  const { stopLoss, takeProfit, rr } = useExplicitLevels
    ? { stopLoss: input.stopLoss!, takeProfit: input.takeProfit!, rr: input.rr! }
    : buildRiskLevels(input.entryPrice, input.action, input.vwap)

  const setup: StoredSetup = {
    id: `${input.slot}-${input.action}-${input.timestamp}`,
    slot: input.slot,
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
    riskPercent: 2,
    status: 'open',
    referenceBarKey: input.referenceBarKey,
  }

  state.setups.unshift(setup)

  state.slots[input.slot].position = {
    setupId: setup.id,
    slot: input.slot,
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

export async function closePosition(slot: SlotKey, timestamp: number, exitPrice: number) {
  const slotState = state.slots[slot]
  if (!slotState?.position) return

  const setup = state.setups.find(s => s.id === slotState.position?.setupId)
  if (!setup || setup.status !== 'open') {
    slotState.position = null
    persist()
    return
  }

  const realizedR = computeRealizedR(setup, exitPrice)

  setup.exitPrice = exitPrice
  setup.rMultiple = realizedR
  setup.drawdownR = realizedR < 0 ? Math.abs(realizedR) : 0
  setup.closedAt = timestamp
  setup.durationMinutes = Math.max(0, (timestamp - setup.timestamp) / 1000 / 60)
  setup.status = realizedR >= 0 ? 'win' : 'loss'

  if (setup.status === 'loss') {
    slotState.lastLossTimestamp = timestamp
  }

  slotState.position = null
  persist()
  await notifyClose(setup)
}

export function evaluateOpenSetups(
  klines: Array<{ time: number; high: number; low: number }>,
  slot: SlotKey
) {
  let changed = false

  const slotSetups = state.setups.filter(s => s.slot === slot && s.status === 'open')

  for (const setup of slotSetups) {
    const candlesAfterEntry = klines.filter(k => k.time * 1000 >= setup.timestamp)

    for (const candle of candlesAfterEntry) {
      const hitSl = setup.action === 'BUY'
        ? candle.low <= setup.stopLoss
        : candle.high >= setup.stopLoss
      const hitTp = setup.action === 'BUY'
        ? candle.high >= setup.takeProfit
        : candle.low <= setup.takeProfit

      if (hitSl || hitTp) {
        setup.status = hitTp ? 'win' : 'loss'
        setup.exitPrice = hitTp ? setup.takeProfit : setup.stopLoss
        setup.rMultiple = hitTp ? setup.rr : -1
        setup.drawdownR = hitTp ? 0 : 1
        setup.closedAt = candle.time * 1000
        setup.durationMinutes = Math.max(0, (setup.closedAt - setup.timestamp) / 1000 / 60)

        if (state.slots[slot]?.position?.setupId === setup.id) {
          state.slots[slot].position = null
        }
        if (setup.status === 'loss') {
          state.slots[slot].lastLossTimestamp = setup.closedAt
        }

        notifyClose(setup)
        changed = true
        break
      }
    }
  }

  if (changed) persist()
}
