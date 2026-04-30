import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const BYBIT = 'https://api.bybit.com'
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const HISTORY_FILE = path.join(DATA_DIR, 'backtest-history.json')

type RawBar = {
  time: number       // timestamp secondes
  open: number
  high: number
  low: number
  close: number
  volume: number
  oi: number
  fundingRate: number
}

async function fetchKlines4h(limit = 500): Promise<Omit<RawBar, 'oi' | 'fundingRate'>[]> {
  const res = await fetch(
    `${BYBIT}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=${limit}`,
    { cache: 'no-store' }
  )
  const data = await res.json()
  if (data.retCode !== 0) throw new Error(`Klines error: ${data.retMsg}`)
  return [...data.result.list].reverse().map((k: string[]) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

async function fetchOI4h(limit = 500): Promise<{ time: number; oi: number }[]> {
  const res = await fetch(
    `${BYBIT}/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=4h&limit=${limit}`,
    { cache: 'no-store' }
  )
  const data = await res.json()
  if (data.retCode !== 0 || !data.result?.list?.length) return []
  return [...data.result.list].reverse().map((d: { timestamp: string; openInterest: string }) => ({
    time: Math.floor(Number(d.timestamp) / 1000),
    oi: Number(d.openInterest),
  }))
}

async function fetchFundingHistory(limit = 200): Promise<{ time: number; rate: number }[]> {
  const res = await fetch(
    `${BYBIT}/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=${limit}`,
    { cache: 'no-store' }
  )
  const data = await res.json()
  if (data.retCode !== 0 || !data.result?.list?.length) return []
  return [...data.result.list].reverse().map((d: { fundingRateTimestamp: string; fundingRate: string }) => ({
    time: Math.floor(Number(d.fundingRateTimestamp) / 1000),
    rate: Number(d.fundingRate),
  }))
}

function mergeData(
  klines: Omit<RawBar, 'oi' | 'fundingRate'>[],
  oiData: { time: number; oi: number }[],
  fundingData: { time: number; rate: number }[]
): RawBar[] {
  return klines.map((k) => {
    // OI le plus proche avant ou au moment de la bougie
    let oi = 0
    for (const o of oiData) {
      if (o.time <= k.time) oi = o.oi
      else break
    }

    // Funding le plus proche avant ou au moment de la bougie
    let fundingRate = 0
    for (const f of fundingData) {
      if (f.time <= k.time) fundingRate = f.rate
      else break
    }

    return { ...k, oi, fundingRate }
  })
}

export async function GET() {
  try {
    // Vérifier si données récentes déjà présentes (< 4h)
    if (fs.existsSync(HISTORY_FILE)) {
      const stat = fs.statSync(HISTORY_FILE)
      const ageHours = (Date.now() - stat.mtimeMs) / 1000 / 3600
      if (ageHours < 4) {
        const existing = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
        return NextResponse.json({
          message: 'Données déjà à jour',
          bars: existing.length,
          cached: true,
        })
      }
    }

    const [klines, oiData, fundingData] = await Promise.all([
      fetchKlines4h(500),
      fetchOI4h(500),
      fetchFundingHistory(200),
    ])

    const merged = mergeData(klines, oiData, fundingData)

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(merged, null, 2), 'utf-8')

    return NextResponse.json({
      message: 'Données collectées avec succès',
      bars: merged.length,
      from: new Date(merged[0]?.time * 1000).toISOString(),
      to: new Date(merged.at(-1)?.time * 1000 ?? 0).toISOString(),
      cached: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur collecte'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
