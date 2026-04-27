import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const FILE_PATH = path.join(DATA_DIR, 'trade-journal.json')
const OI_FILE_PATH = path.join(DATA_DIR, 'oi-buffer.json')
const SWEEP_FILE_PATH = path.join(DATA_DIR, 'sweep-state.json')

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

// ─── OI BUFFER ───────────────────────────────────────────────────────────────

type OIBar = {
  time: number
  openInterest: number
}

export function loadOIBuffer(): OIBar[] {
  try {
    ensureDir()
    if (!fs.existsSync(OI_FILE_PATH)) return []
    const raw = fs.readFileSync(OI_FILE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() / 1000 - 48 * 60 * 60
    return parsed.filter((p: OIBar) => p.time > cutoff)
  } catch {
    return []
  }
}

export function saveOIBuffer(buffer: OIBar[]) {
  try {
    ensureDir()
    const toSave = buffer.slice(-500)
    fs.writeFileSync(OI_FILE_PATH, JSON.stringify(toSave, null, 2), 'utf-8')
  } catch {}
}

// ─── SWEEP STATE ──────────────────────────────────────────────────────────────

/**
 * Mémorise le dernier sweep détecté avec un TTL de 6 heures.
 * Permet de détecter L (sweep) et R (retest VWAP) sur des temporalités différentes.
 */
export type SweepState = {
  direction: 'high' | 'low'   // high = piège haussier → signal SELL, low = piège baissier → signal BUY
  detectedAt: number           // timestamp ms de la détection
  structureLevel: number       // niveau sweepé (high ou low)
  sweepHigh: number            // high de la bougie de sweep (pour SL)
  sweepLow: number             // low de la bougie de sweep (pour SL)
  oiAtSweep: number            // OI au moment du sweep
  cvdAtSweep: number           // CVD au moment du sweep
} | null

const SWEEP_TTL_MS = 6 * 60 * 60 * 1000 // 6 heures

export function loadSweepState(): SweepState {
  try {
    ensureDir()
    if (!fs.existsSync(SWEEP_FILE_PATH)) return null
    const raw = fs.readFileSync(SWEEP_FILE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as SweepState
    if (!parsed) return null
    // Expiration TTL
    if (Date.now() - parsed.detectedAt > SWEEP_TTL_MS) {
      fs.unlinkSync(SWEEP_FILE_PATH)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveSweepState(state: SweepState) {
  try {
    ensureDir()
    if (state === null) {
      if (fs.existsSync(SWEEP_FILE_PATH)) fs.unlinkSync(SWEEP_FILE_PATH)
      return
    }
    fs.writeFileSync(SWEEP_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8')
  } catch {}
}
