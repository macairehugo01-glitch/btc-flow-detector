import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

const DEFAULT_RR = 2
const DEFAULT_CONFIRM_WINDOW_5M = 6
const DEFAULT_OI_SMA = 5
const DEFAULT_CVD_SMA = 10
const DEFAULT_STALL_LOOKBACK = 8
const DEFAULT_VWAP_WINDOW_30M = 48
const PIVOT_LEFT = 3
const PIVOT_RIGHT = 3
const MAX_BARS_TO_RESOLVE_30M = 16
const MAX_BARS_TO_RESOLVE_5M = 96
const COOLDOWN_30M = 4

type RawBar = { time:number;open:number;high:number;low:number;close:number;volume:number;oi:number;fundingRate:number }
type PriceBar = { time:number;open:number;high:number;low:number;close:number;volume:number }

type Direction = 'buy' | 'sell'
type Outcome = 'win' | 'loss' | 'timeout_close'
type StrictClass = 'pin_only' | 'pin_strict'
type EntryTiming = 'pin_close' | 'strict_5m_confirm'

type IctEvent = {
  pinTime:number; direction:Direction; entryTiming:EntryTiming; entryTime:number
  entryPrice:number; vwapAtPin:number; slPrice:number; tpPrice:number; distToSlPct:number
  strict:StrictClass; bosConfirmed:boolean; fvgConfirmed:boolean; barsToStrict?:number
  outcome:Outcome; rMultiple:number; barsToClose?:number
}
type StatBlock = {
  trades:number; wins:number; losses:number; timeouts:number
  winRate:number; tpHitRate:number; avgR:number; expectancy:number
}

function sma(v:number[],p:number,e:number):number{ if(e<p-1){let s=0;for(let i=0;i<=e;i++)s+=v[i];return s/(e+1)} let s=0;for(let i=e-p+1;i<=e;i++)s+=v[i];return s/p }
function computeVWAP30m(b:RawBar[],i:number,w:number):number{ const st=Math.max(0,i-w+1);let pv=0,vol=0;for(let k=st;k<=i;k++){const x=b[k];const tp=(x.high+x.low+x.close)/3;pv+=tp*x.volume;vol+=x.volume}return vol>0?pv/vol:b[i].close }
function computeCVDArray(b:RawBar[]):number[]{const c:number[]=new Array(b.length);let cum=0;for(let i=0;i<b.length;i++){const x=b[i];const d=x.close>x.open?x.volume:x.close<x.open?-x.volume:0;cum+=d;c[i]=cum}return c}
function computeOIDeltaArray(b:RawBar[]):number[]{const d:number[]=new Array(b.length);for(let i=0;i<b.length;i++)d[i]=i===0?0:b[i].oi-b[i-1].oi;return d}

type TrapState={longsTrapped:boolean;shortsTrapped:boolean;vwap:number}
function computeTrapStateAt(b:RawBar[],cvd:number[],oiD:number[],i:number,p:{oiSma:number;cvdSma:number;stallLookback:number;vwapWindow:number}):TrapState{
  const oiUp=sma(oiD,p.oiSma,i)>0
  const cS=sma(cvd,p.cvdSma,i)
  const cUp=cvd[i]>cS, cDn=cvd[i]<cS
  let sH=false,sL=false
  if(i>=p.stallLookback){let hp=-Infinity,lp=Infinity;for(let k=i-p.stallLookback;k<=i-1;k++){if(b[k].high>hp)hp=b[k].high;if(b[k].low<lp)lp=b[k].low}sH=b[i].high<=hp;sL=b[i].low>=lp}
  return {longsTrapped:oiUp&&cUp&&sH,shortsTrapped:oiUp&&cDn&&sL,vwap:computeVWAP30m(b,i,p.vwapWindow)}
}
function lastConfirmedSwing(b:PriceBar[],j:number,side:'high'|'low'):number|null{
  for(let p=j-PIVOT_RIGHT;p>=PIVOT_LEFT;p--){let ok=true
    if(side==='high'){for(let k=p-PIVOT_LEFT;k<=p+PIVOT_RIGHT;k++){if(k===p)continue;if(b[k].high>=b[p].high){ok=false;break}}if(ok)return b[p].high}
    else{for(let k=p-PIVOT_LEFT;k<=p+PIVOT_RIGHT;k++){if(k===p)continue;if(b[k].low<=b[p].low){ok=false;break}}if(ok)return b[p].low}}
  return null
}
function bosAt(b:PriceBar[],j:number,d:Direction):boolean{ if(d==='buy'){const s=lastConfirmedSwing(b,j,'high');return s!==null&&b[j].close>s}const s=lastConfirmedSwing(b,j,'low');return s!==null&&b[j].close<s}
function fvgAt(b:PriceBar[],j:number,d:Direction):boolean{ if(j<2)return false;if(d==='buy')return b[j-2].high<b[j].low;return b[j-2].low>b[j].high}
function firstFiveMinAfter(b:PriceBar[],t:number):number{let lo=0,hi=b.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(b[m].time>=t){r=m;hi=m-1}else lo=m+1}return r}

function resolveGeneric(
  getBar:(idx:number)=>{high:number;low:number;close:number},
  n:number, startIdx:number, maxBars:number, dir:Direction, entry:number, sl:number, rr:number
){
  const risk=Math.abs(entry-sl)
  const tp=dir==='buy'?entry+risk*rr:entry-risk*rr
  const lastIdx=Math.min(startIdx+maxBars,n-1)
  for(let j=startIdx+1;j<=lastIdx;j++){
    const b=getBar(j); const btc=j-startIdx
    if(dir==='buy'){ if(b.low<=sl)return{outcome:'loss' as Outcome,rMultiple:-1,barsToClose:btc,tpPrice:tp}; if(b.high>=tp)return{outcome:'win' as Outcome,rMultiple:rr,barsToClose:btc,tpPrice:tp} }
    else { if(b.high>=sl)return{outcome:'loss' as Outcome,rMultiple:-1,barsToClose:btc,tpPrice:tp}; if(b.low<=tp)return{outcome:'win' as Outcome,rMultiple:rr,barsToClose:btc,tpPrice:tp} }
  }
  const exitClose=getBar(lastIdx).close
  const rPartial = dir==='buy' ? (exitClose-entry)/risk : (entry-exitClose)/risk
  return {outcome:'timeout_close' as Outcome, rMultiple:Math.round(rPartial*1000)/1000, barsToClose:lastIdx-startIdx, tpPrice:tp}
}

function calcStats(events:IctEvent[]):StatBlock{
  const n=events.length
  const wins=events.filter(e=>e.outcome==='win').length
  const losses=events.filter(e=>e.outcome==='loss').length
  const timeouts=events.filter(e=>e.outcome==='timeout_close').length
  const sumR=events.reduce((s,e)=>s+e.rMultiple,0)
  const expectancy=n>0?sumR/n:0
  const tpHitRate=n>0?wins/n:0
  const positive=events.filter(e=>e.rMultiple>0).length
  const winRate=n>0?positive/n:0
  return {
    trades:n, wins, losses, timeouts,
    winRate:Math.round(winRate*1000)/10,
    tpHitRate:Math.round(tpHitRate*1000)/10,
    avgR:Math.round(expectancy*1000)/1000,
    expectancy:Math.round(expectancy*1000)/1000,
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const symbol = (url.searchParams.get('symbol') ?? 'BTCUSDT').toUpperCase()

  const rrRaw = url.searchParams.get('rr')
  const RR = (rrRaw !== null && Number(rrRaw) > 0) ? Number(rrRaw) : DEFAULT_RR
  const cwRaw = url.searchParams.get('confirmWindow')
  const CONFIRM_WINDOW_5M = (cwRaw !== null && Number(cwRaw) > 0) ? Number(cwRaw) : DEFAULT_CONFIRM_WINDOW_5M

  const allowed = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT']
  if (!allowed.includes(symbol)) {
    return NextResponse.json({ error: `Symbole non supporté: ${symbol}` }, { status: 400 })
  }

  const FILE_30M = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-30m.json`)
  const FILE_5M = path.join(DATA_DIR, `backtest-history-${symbol.toLowerCase()}-5m.json`)
  if (!fs.existsSync(FILE_30M)) return NextResponse.json({ error: `Données 30m manquantes. Lance /api/backtest/collect?symbol=${symbol}&tf=30m d'abord.` }, { status: 400 })
  if (!fs.existsSync(FILE_5M)) return NextResponse.json({ error: `Données 5m manquantes. Lance /api/backtest/collect?symbol=${symbol}&tf=5m d'abord.` }, { status: 400 })

  try {
    const bars30: RawBar[] = JSON.parse(fs.readFileSync(FILE_30M, 'utf-8'))
    const bars5: PriceBar[] = JSON.parse(fs.readFileSync(FILE_5M, 'utf-8'))

    const params = { oiSma:DEFAULT_OI_SMA, cvdSma:DEFAULT_CVD_SMA, stallLookback:DEFAULT_STALL_LOOKBACK, vwapWindow:DEFAULT_VWAP_WINDOW_30M }
    const cvd = computeCVDArray(bars30)
    const oiD = computeOIDeltaArray(bars30)
    const events: IctEvent[] = []
    let lastPin = -Infinity
    const minStart = Math.max(params.oiSma, params.cvdSma, params.stallLookback, params.vwapWindow) + 1

    for (let i = minStart; i < bars30.length - MAX_BARS_TO_RESOLVE_30M; i++) {
      if (i - lastPin < COOLDOWN_30M) continue
      const st = computeTrapStateAt(bars30, cvd, oiD, i, params)
      const close = bars30[i].close
      let dir: Direction | null = null
      if (st.shortsTrapped && close > st.vwap) dir = 'buy'
      else if (st.longsTrapped && close < st.vwap) dir = 'sell'
      if (!dir) continue
      lastPin = i

      const ct30 = bars30[i].time + 30 * 60
      const start5 = firstFiveMinAfter(bars5, ct30)
      let bosC = false, fvgC = false, cIdx = -1, bts: number | undefined = undefined
      if (start5 !== -1) {
        const end5 = Math.min(start5 + CONFIRM_WINDOW_5M, bars5.length)
        for (let j = start5; j < end5; j++) {
          if (j < 2) continue
          if (bosAt(bars5, j, dir)) bosC = true
          if (fvgAt(bars5, j, dir)) fvgC = true
          if (bosC && fvgC) { cIdx = j; bts = j - start5; break }
        }
      }

      const sl = st.vwap

      if (bosC && fvgC && cIdx !== -1) {
        const entry = bars5[cIdx].close
        const dpct = Math.abs((entry - sl) / entry) * 100
        const r = resolveGeneric(k => bars5[k], bars5.length, cIdx, MAX_BARS_TO_RESOLVE_5M, dir, entry, sl, RR)
        events.push({ pinTime: bars30[i].time, direction: dir, entryTiming: 'strict_5m_confirm', entryTime: bars5[cIdx].time, entryPrice: entry, vwapAtPin: st.vwap, slPrice: sl, tpPrice: r.tpPrice, distToSlPct: Math.round(dpct*1000)/1000, strict: 'pin_strict', bosConfirmed: true, fvgConfirmed: true, barsToStrict: bts, outcome: r.outcome, rMultiple: r.rMultiple, barsToClose: r.barsToClose })
      } else {
        const entry = close
        const dpct = Math.abs((entry - sl) / entry) * 100
        const r = resolveGeneric(k => bars30[k], bars30.length, i, MAX_BARS_TO_RESOLVE_30M, dir, entry, sl, RR)
        events.push({ pinTime: bars30[i].time, direction: dir, entryTiming: 'pin_close', entryTime: bars30[i].time, entryPrice: entry, vwapAtPin: st.vwap, slPrice: sl, tpPrice: r.tpPrice, distToSlPct: Math.round(dpct*1000)/1000, strict: 'pin_only', bosConfirmed: bosC, fvgConfirmed: fvgC, barsToStrict: bts, outcome: r.outcome, rMultiple: r.rMultiple, barsToClose: r.barsToClose })
      }
    }

    const buy = events.filter(e => e.direction === 'buy')
    const sell = events.filter(e => e.direction === 'sell')
    const pinOnly = events.filter(e => e.strict === 'pin_only')
    const pinStrict = events.filter(e => e.strict === 'pin_strict')
    const strictClean = pinStrict.filter(e => e.distToSlPct >= 0.15)

    const results = {
      generatedAt: new Date().toISOString(),
      symbol,
      method: 'v3 — timeouts fermés au marché (R partiel réel, tous trades comptés)',
      paramsUsed: { rr: RR, confirmWindow5m: CONFIRM_WINDOW_5M, oiSma: params.oiSma, cvdSma: params.cvdSma, stallLookback: params.stallLookback, vwapWindow: params.vwapWindow },
      bars30: bars30.length,
      bars5: bars5.length,
      totalPins: events.length,
      strictCount: pinStrict.length,
      strictRatePct: events.length > 0 ? Math.round((pinStrict.length / events.length) * 1000) / 10 : 0,
      overall: calcStats(events),
      byDirection: { buy: calcStats(buy), sell: calcStats(sell) },
      byStrict: { pin_only: calcStats(pinOnly), pin_strict: calcStats(pinStrict) },
      strictCleanStats: { note: 'pin_strict filtré sur distToSlPct>=0.15%', count: strictClean.length, stats: calcStats(strictClean) },
      crossBreakdown: {
        buy_pin_only: calcStats(buy.filter(e => e.strict === 'pin_only')),
        buy_pin_strict: calcStats(buy.filter(e => e.strict === 'pin_strict')),
        sell_pin_only: calcStats(sell.filter(e => e.strict === 'pin_only')),
        sell_pin_strict: calcStats(sell.filter(e => e.strict === 'pin_strict')),
      },
      events: events.slice(-300),
    }

    const RESULTS_FILE = path.join(DATA_DIR, `ict-backtest-results-${symbol.toLowerCase()}.json`)
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8')
    return NextResponse.json(results)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur backtest ICT'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
