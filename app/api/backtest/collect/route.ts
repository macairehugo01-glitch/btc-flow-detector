import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const BYBIT = 'https://api.bybit.com'
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const TARGET_BARS = 17520
const BARS_PER_CALL = 200

type RawBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  oi: number
  fundingRate: number
}

type KlineRaw = Omit<RawBar, 'oi' | 'fundingRate'>

function getHistoryFile(symbol: string): string {
  return path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}.json`)
}

// ─── KLINES paginées ──────────────────────────────────────────────────────────

async function fetchKlinesPaginated(symbol: string): Promise<KlineRaw[]> {
  const allBars: KlineRaw[] = []
  let endTime = Date.now()
  const maxCalls = Math.ceil(TARGET_BARS / BARS_PER_CALL)
  let callCount = 0

  while (allBars.length < TARGET_BARS && callCount < maxCalls) {
    const url = `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=60&limit=${BARS_PER_CALL}&end=${endTime}`
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json()

    if (data.retCode !== 0 || !data.result?.list?.length) break

    const bars: KlineRaw[] = [...data.result.list].reverse().map((k: string[]) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }))

    allBars.unshift(...bars)
    const oldest = bars[0]
    if (!oldest) break
    endTime = oldest.time * 1000 - 1
    callCount++
    await new Promise(r => setTimeout(r, 200))
  }

  const seen = new Set<number>()
  return allBars
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
    .slice(-TARGET_BARS)
}

// ─── OI paginé ───────────────────────────────────────────────────────────────

async function fetchOIPaginated(symbol: string): Promise<{ time: number; oi: number }[]> {
  const allOI: { time: number; oi: number }[] = []
  let endTime = Date.now()
  const maxCalls = Math.ceil(TARGET_BARS / BARS_PER_CALL)
  let callCount = 0

  while (allOI.length < TARGET_BARS && callCount < maxCalls) {
    const url = `${BYBIT}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h&limit=${BARS_PER_CALL}&endTime=${endTime}`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      if (data.retCode !== 0 || !data.result?.list?.length) break

      const bars = [...data.result.list].reverse().map((d: { timestamp: string; openInterest: string }) => ({
        time: Math.floor(Number(d.timestamp) / 1000),
        oi: Number(d.openInterest),
      }))

      allOI.unshift(...bars)
      const oldest = bars[0]
      if (!oldest) break
      endTime = oldest.time * 1000 - 1
      callCount++
      await new Promise(r => setTimeout(r, 200))
    } catch { break }
  }

  const seen = new Set<number>()
  return allOI
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
}

// ─── FUNDING paginé ───────────────────────────────────────────────────────────

async function fetchFundingPaginated(symbol: string): Promise<{ time: number; rate: number }[]> {
  const allFunding: { time: number; rate: number }[] = []
  let endTime = Date.now()
  let callCount = 0

  while (callCount < 12) {
    const url = `${BYBIT}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=${BARS_PER_CALL}&endTime=${endTime}`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      if (data.retCode !== 0 || !data.result?.list?.length) break

      const bars = [...data.result.list].reverse().map((d: { fundingRateTimestamp: string; fundingRate: string }) => ({
        time: Math.floor(Number(d.fundingRateTimestamp) / 1000),
        rate: Number(d.fundingRate),
      }))

      allFunding.unshift(...bars)
      const oldest = bars[0]
      if (!oldest) break
      endTime = oldest.time * 1000 - 1
      callCount++
      await new Promise(r => setTimeout(r, 200))
    } catch { break }
  }

  const seen = new Set<number>()
  return allFunding
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
}

// ─── MERGE ────────────────────────────────────────────────────────────────────

function mergeData(
  klines: KlineRaw[],
  oiData: { time: number; oi: number }[],
  fundingData: { time: number; rate: number }[]
): RawBar[] {
  return klines.map((k) => {
    let oi = 0
    for (const o of oiData) {
      if (o.time <= k.time) oi = o.oi
      else break
    }
    let fundingRate = 0
    for (const f of fundingData) {
      if (f.time <= k.time) fundingRate = f.rate
      else break
    }
    return { ...k, oi, fundingRate }
  })
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()

  // Valider le symbole
  const allowed = ['BTCUSDT', 'ETHUSDT']
  if (!allowed.includes(symbol)) {
    return NextResponse.json({ error: `Symbole non supporté: ${symbol}. Utilise BTCUSDT ou ETHUSDT` }, { status: 400 })
  }

  const HISTORY_FILE = getHistoryFile(symbol)

  try {
    // Cache 24h par symbole
    if (!force && fs.existsSync(HISTORY_FILE)) {
      const stat = fs.statSync(HISTORY_FILE)
      const ageHours = (Date.now() - stat.mtimeMs) / 1000 / 3600
      if (ageHours < 24) {
        const existing = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) as RawBar[]
        return NextResponse.json({
          message: `Données ${symbol} déjà à jour (cache 24h)`,
          symbol,
          bars: existing.length,
          from: new Date((existing[0]?.time ?? 0) * 1000).toISOString(),
          to: new Date((existing[existing.length - 1]?.time ?? 0) * 1000).toISOString(),
          cached: true,
        })
      }
    }

    console.log(`[BACKTEST] Collecte 2 ans 1h pour ${symbol}...`)

    const klines = await fetchKlinesPaginated(symbol)
    const oiData = await fetchOIPaginated(symbol)
    const fundingData = await fetchFundingPaginated(symbol)
    const merged = mergeData(klines, oiData, fundingData)

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(merged, null, 2), 'utf-8')

    return NextResponse.json({
      message: `${merged.length} bougies 1h ${symbol} collectées`,
      symbol,
      bars: merged.length,
      from: new Date((merged[0]?.time ?? 0) * 1000).toISOString(),
      to: new Date((merged[merged.length - 1]?.time ?? 0) * 1000).toISOString(),
      oiPoints: oiData.length,
      fundingPoints: fundingData.length,
      cached: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur collecte'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
