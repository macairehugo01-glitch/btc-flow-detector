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
