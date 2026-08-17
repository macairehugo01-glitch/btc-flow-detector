import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const BYBIT = 'https://api.bybit.com'
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

const KLINE_BARS_PER_CALL = 1000
const OI_BARS_PER_CALL = 200
const FUNDING_BARS_PER_CALL = 200
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000

// ─── FETCH AVEC RETRY ─────────────────────────────────────────────────────────
// Sans retry, un rate-limit Bybit ou un hiccup réseau ponctuel coupe
// silencieusement toute la pagination avant d'avoir atteint targetBars.
// Retourne null après épuisement des tentatives (et logge la raison,
// visible dans les logs Railway).
async function fetchWithRetry(url: string): Promise<any> {
  let lastError: string | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      if (data.retCode === 0) return data
      lastError = `retCode=${data.retCode} retMsg=${data.retMsg ?? 'inconnu'}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'erreur réseau inconnue'
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
      console.log(`[BACKTEST] Retry ${attempt + 1}/${MAX_RETRIES} après échec (${lastError}), attente ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  console.log(`[BACKTEST] Abandon après ${MAX_RETRIES} tentatives — dernière erreur: ${lastError}`)
  return null
}

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

// ─── CONFIG PAR TIMEFRAME ─────────────────────────────────────────────────────
// priceOnly=true : on ne collecte QUE les klines (pas d'OI ni funding).
// Utilisé pour le 5m de l'ICT, où le 5m ne sert qu'au BOS (prix seul).
const TF_CONFIG: Record<string, { interval: string; oiInterval: string; targetBars: number; label: string; priceOnly?: boolean }> = {
  '1h':  { interval: '60',  oiInterval: '1h',    targetBars: 17520,  label: '1h'  },
  '30m': { interval: '30',  oiInterval: '30min', targetBars: 35040,  label: '30m' },
  '15m': { interval: '15',  oiInterval: '15min', targetBars: 70080,  label: '15m' },
  '5m':  { interval: '5',   oiInterval: '5min',  targetBars: 210240, label: '5m', priceOnly: true },
  '4h':  { interval: '240', oiInterval: '4h',    targetBars: 4380,   label: '4h'  },
  '1d':  { interval: 'D',   oiInterval: '1d',    targetBars: 1095,   label: '1d'  },
}

function getHistoryFile(symbol: string, tf: string): string {
  return path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-${tf}.json`)
}

// ─── KLINES paginées ──────────────────────────────────────────────────────────
async function fetchKlinesPaginated(symbol: string, interval: string, targetBars: number): Promise<KlineRaw[]> {
  const allBars: KlineRaw[] = []
  let endTime = Date.now()
  const maxCalls = Math.ceil(targetBars / KLINE_BARS_PER_CALL)
  let callCount = 0

  while (allBars.length < targetBars && callCount < maxCalls) {
    const url = `${BYBIT}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${KLINE_BARS_PER_CALL}&end=${endTime}`
    const data = await fetchWithRetry(url)
    if (!data || !data.result?.list?.length) {
      console.log(`[BACKTEST] Klines ${symbol}: arrêt à ${allBars.length}/${targetBars} bougies (appel ${callCount + 1}/${maxCalls})`)
      break
    }

    const bars: KlineRaw[] = [...data.result.list].reverse().map((k: string[]) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]), high: Number(k[2]),
      low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]),
    }))

    allBars.unshift(...bars)
    const oldest = bars[0]
    if (!oldest) break
    endTime = oldest.time * 1000 - 1
    callCount++
    await new Promise(r => setTimeout(r, 250))
  }

  const seen = new Set<number>()
  return allBars
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
    .slice(-targetBars)
}

// ─── OPEN INTEREST paginé ─────────────────────────────────────────────────────
async function fetchOIPaginated(symbol: string, oiInterval: string, targetBars: number): Promise<{ time: number; oi: number }[]> {
  const allOI: { time: number; oi: number }[] = []
  let cursor: string | null = null
  let callCount = 0
  const maxCalls = Math.ceil(targetBars / OI_BARS_PER_CALL) + 5

  while (allOI.length < targetBars && callCount < maxCalls) {
    let u = `${BYBIT}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${oiInterval}&limit=${OI_BARS_PER_CALL}`
    if (cursor) u += `&cursor=${encodeURIComponent(cursor)}`
    const data = await fetchWithRetry(u)
    if (!data || !data.result?.list?.length) {
      console.log(`[BACKTEST] OI ${symbol}: arrêt à ${allOI.length}/${targetBars} points (appel ${callCount + 1})`)
      break
    }

    const bars = [...data.result.list].reverse().map((d: { timestamp: string; openInterest: string }) => ({
      time: Math.floor(Number(d.timestamp) / 1000),
      oi: Number(d.openInterest),
    }))
    allOI.unshift(...bars)

    cursor = data.result.nextPageCursor ?? null
    if (!cursor) break
    callCount++
    await new Promise(r => setTimeout(r, 250))
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
    const url = `${BYBIT}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=${FUNDING_BARS_PER_CALL}&endTime=${endTime}`
    const data = await fetchWithRetry(url)
    if (!data || !data.result?.list?.length) break

    const bars = [...data.result.list].reverse().map((d: { fundingRateTimestamp: string; fundingRate: string }) => ({
      time: Math.floor(Number(d.fundingRateTimestamp) / 1000),
      rate: Number(d.fundingRate),
    }))

    allFunding.unshift(...bars)
    const oldest = bars[0]
    if (!oldest) break
    endTime = oldest.time * 1000 - 1
    callCount++
    await new Promise(r => setTimeout(r, 250))
  }

  const seen = new Set<number>()
  return allFunding
    .filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true })
    .sort((a, b) => a.time - b.time)
}

// ─── MERGE ────────────────────────────────────────────────────────────────────
function mergeData(klines: KlineRaw[], oiData: { time: number; oi: number }[], fundingData: { time: number; rate: number }[]): RawBar[] {
  return klines.map((k) => {
    let oi = 0
    for (const o of oiData) { if (o.time <= k.time) oi = o.oi; else break }
    let fundingRate = 0
    for (const f of fundingData) { if (f.time <= k.time) fundingRate = f.rate; else break }
    return { ...k, oi, fundingRate }
  })
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url)
  const force = url.searchParams.get('force') === 'true'
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()
  const tf = url.searchParams.get('tf') ?? '1h'

  const allowedSymbols = [
    'BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'SOLUSDT',
    'DOGEUSDT', 'OPUSDT', 'ARBUSDT', 'ADAUSDT',
    'SUIUSDT', 'AVAXUSDT', 'AAVEUSDT', 'LINKUSDT',
    'UNIUSDT', 'BNBUSDT', 'HYPEUSDT',
  ]
  if (!allowedSymbols.includes(symbol)) {
    return NextResponse.json({ error: `Symbole non supporté: ${symbol}` }, { status: 400 })
  }

  const config = TF_CONFIG[tf]
  if (!config) {
    return NextResponse.json({ error: `Timeframe non supporté: ${tf}. Utilise 1h, 30m, 15m, 5m, 4h ou 1d` }, { status: 400 })
  }

  const HISTORY_FILE = getHistoryFile(symbol, tf)

  try {
    // Cache 24h
    if (!force && fs.existsSync(HISTORY_FILE)) {
      const stat = fs.statSync(HISTORY_FILE)
      const ageHours = (Date.now() - stat.mtimeMs) / 1000 / 3600
      if (ageHours < 24) {
        const existing = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) as RawBar[]
        return NextResponse.json({
          message: `${symbol} ${tf} déjà à jour (cache 24h)`,
          symbol, tf,
          bars: existing.length,
          from: new Date((existing[0]?.time ?? 0) * 1000).toISOString(),
          to: new Date((existing[existing.length - 1]?.time ?? 0) * 1000).toISOString(),
          cached: true,
        })
      }
    }

    console.log(`[BACKTEST] Collecte ${symbol} ${tf} (${config.targetBars} bougies)...`)
    const klines = await fetchKlinesPaginated(symbol, config.interval, config.targetBars)
    console.log(`[BACKTEST] Klines ${symbol} ${tf}: ${klines.length}`)

    let merged: RawBar[]
    let oiPoints = 0
    let fundingPoints = 0

    if (config.priceOnly) {
      // Mode prix seul (5m ICT) : OI et funding non collectés (non utilisés par le BOS)
      merged = klines.map(k => ({ ...k, oi: 0, fundingRate: 0 }))
      console.log(`[BACKTEST] ${symbol} ${tf}: mode priceOnly, ${merged.length} bougies (sans OI/funding)`)
    } else {
      const oiData = await fetchOIPaginated(symbol, config.oiInterval, config.targetBars)
      const fundingData = await fetchFundingPaginated(symbol)
      merged = mergeData(klines, oiData, fundingData)
      oiPoints = oiData.length
      fundingPoints = fundingData.length
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(merged, null, 2), 'utf-8')

    return NextResponse.json({
      message: `${merged.length} bougies ${symbol} ${tf} collectées`,
      symbol, tf,
      bars: merged.length,
      from: new Date((merged[0]?.time ?? 0) * 1000).toISOString(),
      to: new Date((merged[merged.length - 1]?.time ?? 0) * 1000).toISOString(),
      oiPoints,
      fundingPoints,
      priceOnly: config.priceOnly ?? false,
      cached: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur collecte'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
