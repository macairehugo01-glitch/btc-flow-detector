import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

type RawBar = { time:number; open:number; high:number; low:number; close:number; volume:number }

// Seuils de récupération mesurés (poussés jusqu'à 20% pour capter les gros V-shapes)
const RECOVERY_THRESHOLDS = [0.5, 1, 2, 3, 5, 10, 15, 20]

// Horizons fixes mesurés en heures réelles : 1h, 4h, 8h, 24h, 48h, 72h (3j), 168h (1sem), 336h (2sem), 720h (1mois)
const HORIZONS_HOURS = [1, 4, 8, 24, 48, 72, 168, 336, 720]

type TimeMultiFrame = {
  m15: number | null
  h1:  number | null   // ÷4
  h4:  number | null   // ÷16
  d1:  number | null   // ÷96
}

type Episode = {
  startTime: number; endBarIdx: number
  duration: number
  endReason: 'volume_exhaustion' | 'bullish_reversal' | 'max_bars'
  maxRvol: number; totalDumpPct: number
  hour: number; dayOfWeek: number
  // Recovery % à chaque horizon fixe (clé = heures)
  recoveryAtHorizon: Record<number, number>
  // Max recovery global sur toute la fenêtre étendue
  maxRecoveryExtended: number
  // Temps pour atteindre chaque seuil (null = jamais dans la fenêtre max)
  barsTo: Record<number, number | null>        // key = % seuil
}

function r(v:number, d=4):number { return Math.round(v*Math.pow(10,d))/Math.pow(10,d) }
function avg(arr:number[]):number { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0 }
function med(arr:(number|null)[]):number|null {
  const v = (arr.filter(x=>x!=null) as number[]).sort((a,b)=>a-b)
  if (!v.length) return null
  const m = Math.floor(v.length/2)
  return v.length%2===0 ? (v[m-1]+v[m])/2 : v[m]
}
function pct(arr:boolean[]):number { return arr.length ? r(arr.filter(Boolean).length/arr.length*100,1) : 0 }

function toMultiFrame(bars_m15: number|null): TimeMultiFrame {
  if (bars_m15 === null) return { m15:null, h1:null, h4:null, d1:null }
  return {
    m15: bars_m15,
    h1:  r(bars_m15/4, 1),
    h4:  r(bars_m15/16, 1),
    d1:  r(bars_m15/96, 2),
  }
}

function computeStats(episodes: Episode[]) {
  if (!episodes.length) return null
  const n = episodes.length

  const recoveryRate: Record<string, number> = {}
  for (const thr of RECOVERY_THRESHOLDS) {
    recoveryRate[`reach_${thr}pct`] = pct(episodes.map(e => (e.barsTo[thr] ?? null) !== null))
  }

  const timeToRecover: Record<string, TimeMultiFrame> = {}
  for (const thr of RECOVERY_THRESHOLDS) {
    timeToRecover[`median_to_${thr}pct`] = toMultiFrame(med(episodes.map(e => e.barsTo[thr] ?? null)))
  }

  const recoveryAtHorizon: Record<string, { label:string; avgRecoveryPct:number; pctPositive:number }> = {}
  for (const h of HORIZONS_HOURS) {
    const vals = episodes.map(e => e.recoveryAtHorizon[h] ?? 0)
    let label = `${h}h`
    if (h === 168) label = '1w'
    if (h === 336) label = '2w'
    if (h === 720) label = '1m'
    
    recoveryAtHorizon[label] = {
      label,
      avgRecoveryPct: r(avg(vals)),
      pctPositive: pct(vals.map(v => v > 0)),
    }
  }

  return {
    count: n,
    episodesPerYear: null as number | null,
    avgDuration: r(avg(episodes.map(e=>e.duration)), 2),
    avgMaxRvol: r(avg(episodes.map(e=>e.maxRvol)), 2),
    avgTotalDump: r(avg(episodes.map(e=>e.totalDumpPct)), 4),
    pctEndByExhaustion: r(episodes.filter(e=>e.endReason==='volume_exhaustion').length/n*100, 1),
    avgMaxRecoveryMaxWindow: r(avg(episodes.map(e=>e.maxRecoveryExtended))),
    recoveryRate,
    timeToRecover,
    recoveryAtHorizon,
  }
}

function group(episodes:Episode[], fn:(e:Episode)=>string, years:number) {
  const b: Record<string,Episode[]> = {}
  for (const e of episodes) { const k=fn(e); if(!b[k])b[k]=[]; b[k].push(e) }
  return Object.fromEntries(
    Object.entries(b)
      .sort((a,b)=>b[1].length-a[1].length)
      .map(([k,v]) => {
        const s = computeStats(v)!
        s.episodesPerYear = r(v.length/years, 1)
        return [k, s]
      })
  )
}

// Segmentation fine des tranches RVOL pour traquer la frontière du chaos jusqu'à x20+
function rvolLabel(v:number):string { 
  if(v<2)return '1.5-2x'; 
  if(v<3)return '2-3x'; 
  if(v<5)return '3-5x'; 
  if(v<8)return '5-8x'; 
  if(v<12)return '8-12x'; 
  if(v<20)return '12-20x'; 
  return '>20x' 
}
function dumpLabel(p:number):string { if(p<1)return '<1%'; if(p<2)return '1-2%'; if(p<3)return '2-3%'; if(p<5)return '3-5%'; return '>5%' }
function durLabel(d:number):string { if(d===1)return '1 bar'; if(d<=3)return '2-3 bars'; if(d<=6)return '4-6 bars'; return '>6 bars' }
function sesLabel(h:number):string { if(h<7)return 'Asia (00-07h)'; if(h<13)return 'London (07-13h)'; return 'NewYork (13-23h)' }
function dayLabel(d:number):string { return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d] }

export async function GET(req:Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get('symbol')?? 'BTCUSDT').toUpperCase()
  const tf = url.searchParams.get('tf') ?? '15m'
  const rvolMin = Number(url.searchParams.get('rvolMin') ?? 1.5)
  const bodyMinPct = Number(url.searchParams.get('bodyMinPct') ?? 0.3)
  const rvolWindow = Number(url.searchParams.get('rvolWindow') ?? 20)
  const maxEpisodeBars = Number(url.searchParams.get('maxEpisodeBars') ?? 30)

  const FILE = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-${tf}.json`)
  if (!fs.existsSync(FILE)) {
    return NextResponse.json(
      { error: `Données manquantes. Lance /api/backtest/collect?symbol=${symbol}&tf=${tf}` },
      { status: 400 }
    )
  }

  const bars: RawBar[] = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  const barMinutes = tf==='15m'?15 : tf==='1h'?60 : tf==='4h'?240 : tf==='1d'?1440 : 15
  
  // Configuration dynamique de la fenêtre d'observation selon l'UT :
  // Si UT >= 1d -> Horizon poussé à 30 jours (720h) pour analyser les structures macro.
  // Si UT < 1d  -> Horizon poussé à 2 semaines (336h) pour capturer les flux intra-day profonds.
  const maxHorizonHours = barMinutes >= 1440 ? 720 : 336
  const RECOVERY_WINDOW = Math.round(maxHorizonHours * 60 / barMinutes)
  const episodes: Episode[] = []

  let i = rvolWindow
  while (i < bars.length - RECOVERY_WINDOW) {
    const bar = bars[i]
    const volWin = bars.slice(i-rvolWindow, i).map(b=>b.volume)
    const avgVol = volWin.reduce((s,v)=>s+v,0)/volWin.length
    if (!avgVol) { i++; continue }

    const rvol = bar.volume/avgVol
    const bodyPct = bar.close<bar.open ? ((bar.open-bar.close)/bar.open)*100 : 0

    if (bar.close>=bar.open || bodyPct<bodyMinPct || rvol<rvolMin) { i++; continue }

    const startIdx = i; const startOpen = bar.open
    let lowestClose=bar.close, lowestIdx=i
    let maxRvol=rvol, sumRvol=rvol, bearishCount=1
    let endIdx=i, endReason:'volume_exhaustion'|'bullish_reversal'|'max_bars'='max_bars'

    let j=i+1
    while (j<bars.length && j-startIdx<maxEpisodeBars) {
      const next=bars[j]; const nRvol=next.volume/avgVol
      if (next.close>next.open) { endIdx=j-1; endReason='bullish_reversal'; break }
      if (next.close<next.open && nRvol<1.0) { endIdx=j-1; endReason='volume_exhaustion'; break }
      if (next.close<next.open) {
        bearishCount++; sumRvol+=nRvol
        if (nRvol>maxRvol) maxRvol=nRvol
        if (next.close<lowestClose) { lowestClose=next.close; lowestIdx=j }
      }
      endIdx=j; j++
    }
    if (endReason==='max_bars') endIdx=j-1

    const ref = lowestClose
    const a = lowestIdx+1

    // Calcul de la performance aux horizons étendus (exprimés en heures réelles)
    const recoveryAtHorizon: Record<number,number> = {}
    for (const hHours of HORIZONS_HOURS) {
      const hBars = Math.round(hHours * 60 / barMinutes)
      const idx = a + hBars - 1
      recoveryAtHorizon[hHours] = idx<bars.length ? r(((bars[idx].close-ref)/ref)*100) : 0
    }

    let maxRec=0
    const barsTo: Record<number,number|null> = {}
    for (const thr of RECOVERY_THRESHOLDS) barsTo[thr]=null

    for (let k=1; k<=RECOVERY_WINDOW && a+k-1<bars.length; k++) {
      const hp = ((bars[a+k-1].high-ref)/ref)*100
      if (hp>maxRec) maxRec=hp
      
      // Normalisation systématique en équivalent bougies M15 pour garder des métriques cohérentes
      const kM15 = k * barMinutes / 15
      for (const thr of RECOVERY_THRESHOLDS) {
        if (barsTo[thr]===null && hp>=thr) barsTo[thr]=kM15
      }
    }

    const d = new Date(bars[startIdx].time*1000)
    episodes.push({
      startTime: bars[startIdx].time, endBarIdx: endIdx,
      duration: endIdx-startIdx+1, endReason,
      maxRvol: r(maxRvol,2),
      totalDumpPct: r(((startOpen-lowestClose)/startOpen)*100,4),
      hour: d.getUTCHours(), dayOfWeek: d.getUTCDay(),
      recoveryAtHorizon, maxRecoveryExtended: r(maxRec), barsTo,
    })

    i = endIdx+1
  }

  const years = bars.length/(365*24*60/barMinutes)
  const overall = computeStats(episodes)
  if (overall) overall.episodesPerYear = r(episodes.length/years,1)

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    symbol, timeframe: tf,
    paramsUsed: { rvolMin, bodyMinPct, rvolWindow, maxEpisodeBars },
    totalBars: bars.length, yearsOfData: r(years,2),
    totalEpisodes: episodes.length,
    episodesPerYear: r(episodes.length/years,1),
    maxHorizonObserved: `${maxHorizonHours} heures`,
    overall,
    byRvol: group(episodes, e=>rvolLabel(e.maxRvol), years),
    byDump: group(episodes, e=>dumpLabel(e.totalDumpPct), years),
    byDuration: group(episodes, e=>durLabel(e.duration), years),
    bySession: group(episodes, e=>sesLabel(e.hour), years),
    byDayOfWeek: group(episodes, e=>dayLabel(e.dayOfWeek), years),
    byRvolXDump: group(episodes, e=>`RVOL ${rvolLabel(e.maxRvol)} + dump ${dumpLabel(e.totalDumpPct)}`, years),
    topByRvol: episodes
      .sort((a,b)=>b.maxRvol-a.maxRvol).slice(0,15)
      .map(e=>({
        date: new Date(e.startTime*1000).toISOString(),
        duration: e.duration, endReason: e.endReason,
        maxRvol: e.maxRvol, totalDumpPct: e.totalDumpPct,
        maxRecoveryInWindow: e.maxRecoveryExtended,
        reachedIn: {
          '1pct': toMultiFrame(e.barsTo[1]),
          '5pct': toMultiFrame(e.barsTo[5]),
          '10pct': toMultiFrame(e.barsTo[10]),
          '20pct': toMultiFrame(e.barsTo[20]),
        },
        recoveryAt: {
          '1h':  e.recoveryAtHorizon[1],
          '24h': e.recoveryAtHorizon[24],
          '72h': e.recoveryAtHorizon[72],
          '1w':  e.recoveryAtHorizon[168],
          '2w':  e.recoveryAtHorizon[336],
        }
      })),
  })
}
