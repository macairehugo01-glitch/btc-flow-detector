import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const BYBIT = 'https://api.bybit.com'
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const HISTORY_FILE = path.join(DATA_DIR, 'backtest-history.json')

// 2 ans d'historique 4h = ~4380 bougies
const TARGET_BARS = 4380
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

// ─── KLINES paginées sur 2 ans ────────────────────────────────────────────────

async function fetchKlines4hPaginated(): Promise<KlineRaw[]> {
  const allBars: KlineRaw[] = []
  let endTime = Date.now()
  const maxCalls = Math.ceil(TARGET_BARS / BARS_PER_CALL)
  let callCount = 0

  while (allBars.length < TARGET_BARS && callCount < maxCalls) {
    const url = `${BYBIT}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=${BARS_PER_CALL}&end=${endTime}`
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

    await new Promise(r => setTimeout(r, 150))
  }

  const seen = new Set<number>()
  return allBars
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
    .slice(-TARGET_BARS)
}

// ─── OI paginé sur 2 ans ──────────────────────────────────────────────────────

async function fetchOI4hPaginated(): Promise<{ time: number; oi: number }[]> {
  const allOI: { time: number; oi: number }[] = []
  let endTime = Date.now()
  const maxCalls = Math.ceil(TARGET_BARS / BARS_PER_CALL)
  let callCount = 0

  while (allOI.length < TARGET_BARS && callCount < maxCalls) {
    const url = `${BYBIT}/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=4h&limit=${BARS_PER_CALL}&endTime=${endTime}`
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

      await new Promise(r => setTimeout(r, 150))
    } catch {
      break
    }
  }

  const seen = new Set<number>()
  return allOI
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
}

// ─── FUNDING paginé ───────────────────────────────────────────────────────────

async function fetchFundingPaginated(): Promise<{ time: number; rate: number }[]> {
  const allFunding: { time: number; rate: number }[] = []
  let endTime = Date.now()
  const maxCalls = 12
  let callCount = 0

  while (callCount < maxCalls) {
    const url = `${BYBIT}/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=${BARS_PER_CALL}&endTime=${endTime}`
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

      await new Promise(r => setTimeout(r, 150))
    } catch {
      break
    }
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

  try {
    // Cache 24h — la collecte 2 ans prend ~30s, inutile de refaire souvent
    if (!force && fs.existsSync(HISTORY_FILE)) {
      const stat = fs.statSync(HISTORY_FILE)
      const ageHours = (Date.now() - stat.mtimeMs) / 1000 / 3600
      if (ageHours < 24) {
        const existing = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) as RawBar[]
        return NextResponse.json({
          message: 'Données déjà à jour (cache 24h)',
          bars: existing.length,
          from: new Date((existing[0]?.time ?? 0) * 1000).toISOString(),
          to: new Date((existing[existing.length - 1]?.time ?? 0) * 1000).toISOString(),
          cached: true,
        })
      }
    }

    console.log('[BACKTEST] Collecte 2 ans historique 4h...')

    const klines = await fetchKlines4hPaginated()
    console.log(`[BACKTEST] Klines: ${klines.length}`)

    const oiData = await fetchOI4hPaginated()
    console.log(`[BACKTEST] OI: ${oiData.length}`)

    const fundingData = await fetchFundingPaginated()
    console.log(`[BACKTEST] Funding: ${fundingData.length}`)

    const merged = mergeData(klines, oiData, fundingData)

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(merged, null, 2), 'utf-8')

    return NextResponse.json({
      message: `${merged.length} bougies 4h collectées`,
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
