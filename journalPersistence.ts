import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const FILE_PATH = path.join(DATA_DIR, 'trade-journal.json')

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
  } catch {}
}

export function loadJournalFile<T>(fallback: T): T {
  try {
    ensureDir()
    if (!fs.existsSync(FILE_PATH)) {
      fs.writeFileSync(FILE_PATH, JSON.stringify(fallback, null, 2), 'utf-8')
      return fallback
    }
    const raw = fs.readFileSync(FILE_PATH, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJournalFile<T>(data: T) {
  try {
    ensureDir()
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8')
  } catch {}
}

// ─── OI BUFFER — un fichier par slot ─────────────────────────────────────────

type OIBar = {
  time: number
  openInterest: number
}

function getOiFilePath(slot?: string): string {
  if (!slot) return path.join(DATA_DIR, 'oi-buffer.json')
  return path.join(DATA_DIR, `oi-buffer-${slot.toLowerCase().replace('-', '_')}.json`)
}

export function loadOIBuffer(slot?: string): OIBar[] {
  try {
    ensureDir()
    const filePath = getOiFilePath(slot)
    if (!fs.existsSync(filePath)) return []
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() / 1000 - 48 * 60 * 60
    return parsed.filter((p: OIBar) => p.time > cutoff)
  } catch {
    return []
  }
}

export function saveOIBuffer(buffer: OIBar[], slot?: string) {
  try {
    ensureDir()
    const filePath = getOiFilePath(slot)
    const toSave = buffer.slice(-500)
    fs.writeFileSync(filePath, JSON.stringify(toSave, null, 2), 'utf-8')
  } catch {}
}

// ─── SWEEP STATE — un fichier par slot (ancienne stratégie LFR, conservé
// pour compatibilité mais plus utilisé par le moteur actuel) ────────────────

export type SweepState = {
  direction: 'high' | 'low'
  detectedAt: number
  structureLevel: number
  sweepHigh: number
  sweepLow: number
  oiAtSweep: number
  cvdAtSweep: number
} | null

const SWEEP_TTL_MS = 2 * 60 * 60 * 1000

function getSweepFilePath(slot?: string): string {
  if (!slot) return path.join(DATA_DIR, 'sweep-state.json')
  return path.join(DATA_DIR, `sweep-state-${slot.toLowerCase().replace('-', '_')}.json`)
}

export function loadSweepState(slot?: string): SweepState {
  try {
    ensureDir()
    const filePath = getSweepFilePath(slot)
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as SweepState
    if (!parsed) return null
    if (Date.now() - parsed.detectedAt > SWEEP_TTL_MS) {
      fs.unlinkSync(filePath)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveSweepState(state: SweepState, slot?: string) {
  try {
    ensureDir()
    const filePath = getSweepFilePath(slot)
    if (state === null) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return
    }
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  } catch {}
}

// ─── ÉTAT DU DÉTECTEUR SQUEEZE (stratégie validée UP→SELL/DOWN→BUY + régime
// Dow daily) — un fichier par slot.

export type PendingSqueezeTrigger = {
  triggerTime: number
  windowHigh: number
  windowLow: number
  consecutiveCount: number
  barsWaited: number
} | null

export type SqueezeDetectorState = {
  lastBarTimeProcessed: number
  // 0 = "jamais déclenché" — surtout PAS -Infinity, qui n'est pas JSON-safe
  // et redeviendrait `null` après un cycle save/load, cassant le calcul du
  // cooldown au redémarrage du service.
  lastTriggerTime: number
  pendingTrigger: PendingSqueezeTrigger
}

const DEFAULT_SQUEEZE_STATE: SqueezeDetectorState = {
  lastBarTimeProcessed: 0,
  lastTriggerTime: 0,
  pendingTrigger: null,
}

function getSqueezeStateFilePath(slot: string): string {
  return path.join(DATA_DIR, `squeeze-state-${slot.toLowerCase().replace('-', '_')}.json`)
}

export function loadSqueezeState(slot: string): SqueezeDetectorState {
  try {
    ensureDir()
    const filePath = getSqueezeStateFilePath(slot)
    if (!fs.existsSync(filePath)) return { ...DEFAULT_SQUEEZE_STATE }
    const raw = fs.readFileSync(filePath, 'utf-8')
    return { ...DEFAULT_SQUEEZE_STATE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SQUEEZE_STATE }
  }
}

export function saveSqueezeState(state: SqueezeDetectorState, slot: string) {
  try {
    ensureDir()
    fs.writeFileSync(getSqueezeStateFilePath(slot), JSON.stringify(state, null, 2), 'utf-8')
  } catch {}
}

// ─── CACHE DU RÉGIME DOW DAILY — un fichier par symbole (BTC/ETH/SOL/XRP) ───
// Le régime ne change que lorsqu'un nouveau swing est confirmé (rare, au
// mieux quelques fois par mois) — inutile de le recalculer à chaque poll
// de 10s. Rafraîchi au maximum une fois par heure (voir REGIME_REFRESH_MS
// dans cvd/route.ts).

export type DailyRegimeCache = {
  fetchedAt: number
  dailyBars: { time: number; high: number; low: number }[]
  trendLabels: ('up' | 'down' | 'undefined')[]
}

function getRegimeCacheFilePath(symbol: string): string {
  return path.join(DATA_DIR, `daily-regime-${symbol.toLowerCase()}.json`)
}

export function loadDailyRegimeCache(symbol: string): DailyRegimeCache | null {
  try {
    ensureDir()
    const filePath = getRegimeCacheFilePath(symbol)
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

export function saveDailyRegimeCache(cache: DailyRegimeCache, symbol: string) {
  try {
    ensureDir()
    fs.writeFileSync(getRegimeCacheFilePath(symbol), JSON.stringify(cache), 'utf-8')
  } catch {}
}
