import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const FILE_PATH = path.join(DATA_DIR, 'trade-journal.json')
const OI_FILE_PATH = path.join(DATA_DIR, 'oi-buffer.json')

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

// ─── OI BUFFER PERSISTANCE ───────────────────────────────────────────────────

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
    // Garder seulement les 48h de données (48 * 60 / 5 = 576 points 5m)
    const cutoff = Date.now() / 1000 - 48 * 60 * 60
    return parsed.filter((p: OIBar) => p.time > cutoff)
  } catch {
    return []
  }
}

export function saveOIBuffer(buffer: OIBar[]) {
  try {
    ensureDir()
    // Sauvegarder seulement les 500 derniers points
    const toSave = buffer.slice(-500)
    fs.writeFileSync(OI_FILE_PATH, JSON.stringify(toSave, null, 2), 'utf-8')
  } catch {}
}
