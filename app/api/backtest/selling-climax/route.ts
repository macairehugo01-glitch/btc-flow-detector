import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

type RawBar = { time:number; open:number; high:number; low:number; close:number; volume:number }

// Seuils de récupération mesurés
const RECOVERY_THRESHOLDS = [0.5, 1, 2, 3, 5, 10]

// Horizons fixes mesurés (en bougies M15, exprimés ensuite en multi-TF)
// 4 = 1h | 16 = 4h | 32 = 8h | 96 = 24h | 192 = 48h | 288 = 72h
const HORIZONS_M15 = [4, 16, 32, 96, 192, 288]

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
  // Recovery % à chaque horizon fixe
  recoveryAtHorizon: Record<number, number>   // key = M15 bars
  // Max recovery sur 288 bougies
  maxRecovery288: number
  // Temps pour atteindre chaque seuil (null = jamais dans les 288 bars)
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

  // % de fois que le prix remonte de X% (depuis le plus bas)
  const recoveryRate: Record<string, number> = {}
  for (const thr of RECOVERY_THRESHOLDS) {
    recoveryRate[`reach_${thr}pct`] = pct(episodes.map(e => (e.barsTo[thr] ?? null) !== null))
  }

  // Temps médian pour atteindre chaque seuil, exprimé en 4 timeframes
  const timeToRecover: Record<string, TimeMultiFrame> = {}
  for (const thr of RECOVERY_THRESHOLDS) {
    timeToRecover[`median_to_${thr}pct`] = toMultiFrame(med(episodes.map(e => e.barsTo[thr] ?? null)))
  }

  // % recovery à chaque horizon fixe
  const recoveryAtHorizon: Record<string, { label:string; avgRecoveryPct:number; pctPositive:number }> = {}
  for (const h of HORIZONS_M15) {
    const vals = episodes.map(e => e.recoveryAtHorizon[h] ?? 0)
    const label = h===4?'1h' : h===16?'4h' : h===32?'8h' : h===96?'24h' : h===192?'48h' : '72h'
    recoveryAtHorizon[label] = {
      label,
      avgRecoveryPct: r(avg(vals)),
      pctPositive: pct(vals.map(v => v > 0)),
    }
  }

  return {
    count: n,
    episodesPerYear: null as number | null,  // rempli plus bas
    avgDuration: r(avg(episodes.map(e=>e.duration)), 2),
    avgMaxRvol: r(avg(episodes.map(e=>e.maxRvol)), 2),
    avgTotalDump: r(avg(episodes.map(e=>e.totalDumpPct)), 4),
    pctEndByExhaustion: r(episodes.filter(e=>e.endReason==='volume_exhaustion').length/n*100, 1),
    avgMaxRecovery288: r(avg(episodes.map(e=>e.maxRecovery288))),
    // Combien de % de fois ça remonte de X%
    recoveryRate,
    // En combien de bougies (M15 / H1 / H4 / Daily)
    timeToRecover,
    // % recovery moyen à chaque horizon temporel
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

function rvolLabel(v:number):string { if(v<2)return '1.5-2x'; if(v<3)return '2-3x'; if(v<5)return '3-5x'; if(v<10)return '5-10x'; return '>10x' }
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

  // Le backtest est conçu pour tourner sur des données M15.
  // Les temps de récupération sont toujours exprimés en M15/H1/H4/Daily
  // quel que soit le tf des données source, pour faciliter la comparaison.
  const FILE = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-${tf}.json`)
  if (!fs.existsSync(FILE)) {
    return NextResponse.json(
      { error: `Données manquantes. Lance /api/backtest/collect?symbol=${symbol}&tf=${tf}` },
      { status: 400 }
    )
  }

  const bars: RawBar[] = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  const barMinutes = tf==='15m'?15 : tf==='1h'?60 : tf==='4h'?240 : tf==='1d'?1440 : 15
  // Fenêtre de récupération en nombre de bougies (toujours 72h en temps réel)
  const RECOVERY_WINDOW = Math.round(72 * 60 / barMinutes)
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

    // ── Construction de l'épisode ──────────────────────────────────────
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

    // ── Mesure de récupération depuis le PLUS BAS ──────────────────────
    const ref = lowestClose
    const a = lowestIdx+1

    // Recovery % à chaque horizon fixe
    // On convertit les horizons M15 en nombre de bougies pour ce TF
    const recoveryAtHorizon: Record<number,number> = {}
    for (const hM15 of HORIZONS_M15) {
      // Convertit l'horizon M15 en bougies du TF courant
      const hBars = Math.round(hM15 * 15 / barMinutes)
      const idx = a + hBars - 1
      recoveryAtHorizon[hM15] = idx<bars.length ? r(((bars[idx].close-ref)/ref)*100) : 0
    }

    // Scan de la fenêtre de récupération
    let maxRec=0
    const barsTo: Record<number,number|null> = {}
    for (const thr of RECOVERY_THRESHOLDS) barsTo[thr]=null

    for (let k=1; k<=RECOVERY_WINDOW && a+k-1<bars.length; k++) {
      const hp = ((bars[a+k-1].high-ref)/ref)*100
      if (hp>maxRec) maxRec=hp
      // On convertit k (bougies du TF courant) en équivalent M15 pour normaliser
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
      recoveryAtHorizon, maxRecovery288: r(maxRec), barsTo,
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
    // Légende des horizons temporels
    horizons: {
      '1h':'4 bougies M15 | 1 bougie H1',
      '4h':'16 bougies M15 | 4 bougies H1 | 1 bougie H4',
      '8h':'32 bougies M15 | 8 bougies H1 | 2 bougies H4',
      '24h':'96 bougies M15 | 24 bougies H1 | 6 bougies H4 | 1 bougie Daily',
      '48h':'192 bougies M15 | 48 bougies H1 | 12 bougies H4 | 2 bougies Daily',
      '72h':'288 bougies M15 | 72 bougies H1 | 18 bougies H4 | 3 bougies Daily',
    },
    endReasons: {
      volume_exhaustion: episodes.filter(e=>e.endReason==='volume_exhaustion').length,
      bullish_reversal:  episodes.filter(e=>e.endReason==='bullish_reversal').length,
      max_bars:          episodes.filter(e=>e.endReason==='max_bars').length,
    },
    // ── VUE GLOBALE ──────────────────────────────────────────────────────
    // recoveryRate   : % de fois que le prix remonte de X% dans les 72h
    // timeToRecover  : en combien de bougies (M15/H1/H4/Daily) en médiane
    // recoveryAtHorizon : % recovery moyen à chaque horizon temporel
    overall,
    // ── PAR RVOL ─────────────────────────────────────────────────────────
    // Question : est-ce que les dumps plus violents rebondissent MIEUX ?
    byRvol: group(episodes, e=>rvolLabel(e.maxRvol), years),
    // ── PAR AMPLITUDE DU DUMP ─────────────────────────────────────────────
    byDump: group(episodes, e=>dumpLabel(e.totalDumpPct), years),
    // ── PAR DURÉE DE L'ÉPISODE ───────────────────────────────────────────
    byDuration: group(episodes, e=>durLabel(e.duration), years),
    // ── PAR SESSION ──────────────────────────────────────────────────────
    bySession: group(episodes, e=>sesLabel(e.hour), years),
    // ── PAR JOUR DE LA SEMAINE ───────────────────────────────────────────
    byDayOfWeek: group(episodes, e=>dayLabel(e.dayOfWeek), years),
    // ── CROISÉ RVOL × DUMP ───────────────────────────────────────────────
    byRvolXDump: group(episodes, e=>`RVOL ${rvolLabel(e.maxRvol)} + dump ${dumpLabel(e.totalDumpPct)}`, years),
    // ── TOP 15 ÉPISODES LES PLUS VIOLENTS ────────────────────────────────
    topByRvol: episodes
      .sort((a,b)=>b.maxRvol-a.maxRvol).slice(0,15)
      .map(e=>({
        date: new Date(e.startTime*1000).toISOString(),
        duration: e.duration, endReason: e.endReason,
        maxRvol: e.maxRvol, totalDumpPct: e.totalDumpPct,
        maxRecovery72h: e.maxRecovery288,
        reachedIn: {
          '1pct': toMultiFrame(e.barsTo[1]),
          '2pct': toMultiFrame(e.barsTo[2]),
          '5pct': toMultiFrame(e.barsTo[5]),
        },
        recoveryAt: {
          '1h':  e.recoveryAtHorizon[4],
          '4h':  e.recoveryAtHorizon[16],
          '24h': e.recoveryAtHorizon[96],
          '72h': e.recoveryAtHorizon[288],
        }
      })),
  })
}
