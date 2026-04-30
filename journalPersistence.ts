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

// ─── SWEEP STATE — un fichier par slot ───────────────────────────────────────

export type SweepState = {
  direction: 'high' | 'low'
  detectedAt: number
  structureLevel: number
  sweepHigh: number
  sweepLow: number
  oiAtSweep: number
  cvdAtSweep: number
} | null

// TTL 2h — validé par backtest (fresh 0-2 bougies = 100% WR sur BTC 1h)
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
