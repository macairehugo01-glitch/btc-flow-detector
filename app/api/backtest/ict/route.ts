import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'

// ─── PARAMÈTRES PAR DÉFAUT ─────────────────────────────────────────────────
const DEFAULT_RR = 2
const DEFAULT_CONFIRM_WINDOW_5M = 6   // 6 bougies 5m = 30 min après le pin
const DEFAULT_OI_SMA = 5
const DEFAULT_CVD_SMA = 10
const DEFAULT_STALL_LOOKBACK = 8
const DEFAULT_VWAP_WINDOW_30M = 48
const PIVOT_LEFT = 3
const PIVOT_RIGHT = 3
const MAX_BARS_TO_RESOLVE_30M = 16
const MAX_BARS_TO_RESOLVE_5M = 96     // 8h en 5m = même horizon temporel que 16 bougies 30m
const COOLDOWN_30M = 4

type RawBar = { time:number;open:number;high:number;low:number;close:number;volume:number;oi:number;fundingRate:number }
type PriceBar = { time:number;open:number;high:number;low:number;close:number;volume:number }

type Direction = 'buy' | 'sell'
type Outcome = 'win' | 'loss' | 'breakeven' | 'unresolved'
type StrictClass = 'pin_only' | 'pin_strict'
type EntryTiming = 'pin_close' | 'strict_5m_confirm'

type IctEvent = {
  pinTime:number; direction:Direction; entryTiming:EntryTiming; entryTime:number
  entryPrice:number; vwapAtPin:number; slPrice:number; tpPrice:number; distToSlPct:number
  strict:StrictClass; bosConfirmed:boolean; fvgConfirmed:boolean; barsToStrict?:number
  outcome:Outcome; rMultiple:number; barsToClose?:number
}
type StatBlock = { trades:number; wins:number; winRate:number; avgR:number; expectancy:number }

function sma(values:number[], period:number, endIdx:number):number {
  if (endIdx < period-1){ let s=0; for(let i=0;i<=endIdx;i++)s+=values[i]; return s/(endIdx+1) }
  let s=0; for(let i=endIdx-period+1;i<=endIdx;i++)s+=values[i]; return s/period
}
function computeVWAP30m(bars30:RawBar[], i:number, window:number):number {
  const start=Math.max(0,i-window+1); let pv=0,vol=0
  for(let k=start;k<=i;k++){ const b=bars30[k]; const tp=(b.high+b.low+b.close)/3; pv+=tp*b.volume; vol+=b.volume }
  return vol>0?pv/vol:bars30[i].close
}
function computeCVDArray(bars30:RawBar[]):number[] {
  const cvd:number[]=new Array(bars30.length); let cum=0
  for(let i=0;i<bars30.length;i++){ const b=bars30[i]; const d=b.close>b.open?b.volume:b.close<b.open?-b.volume:0; cum+=d; cvd[i]=cum }
  return cvd
}
function computeOIDeltaArray(bars30:RawBar[]):number[] {
  const d:number[]=new Array(bars30.length)
  for(let i=0;i<bars30.length;i++) d[i]= i===0?0:bars30[i].oi-bars30[i-1].oi
  return d
}
type TrapState = { longsTrapped:boolean; shortsTrapped:boolean; vwap:number }
function computeTrapStateAt(bars30:RawBar[], cvd:number[], oiDelta:number[], i:number,
  params:{oiSma:number;cvdSma:number;stallLookback:number;vwapWindow:number}):TrapState {
  const oiUpState = sma(oiDelta,params.oiSma,i)>0
  const cvdSmaVal = sma(cvd,params.cvdSma,i)
  const cvdUpState = cvd[i]>cvdSmaVal
  const cvdDownState = cvd[i]<cvdSmaVal
  let stallHigh=false, stallLow=false
  if(i>=params.stallLookback){
    let hp=-Infinity, lp=Infinity
    for(let k=i-params.stallLookback;k<=i-1;k++){ if(bars30[k].high>hp)hp=bars30[k].high; if(bars30[k].low<lp)lp=bars30[k].low }
    stallHigh=bars30[i].high<=hp; stallLow=bars30[i].low>=lp
  }
  return {
    longsTrapped: oiUpState&&cvdUpState&&stallHigh,
    shortsTrapped: oiUpState&&cvdDownState&&stallLow,
    vwap: computeVWAP30m(bars30,i,params.vwapWindow),
  }
}
function lastConfirmedSwing(bars5:PriceBar[], j:number, side:'high'|'low'):number|null {
  for(let p=j-PIVOT_RIGHT;p>=PIVOT_LEFT;p--){
    let ok=true
    if(side==='high'){ for(let k=p-PIVOT_LEFT;k<=p+PIVOT_RIGHT;k++){ if(k===p)continue; if(bars5[k].high>=bars5[p].high){ok=false;break} } if(ok)return bars5[p].high }
    else { for(let k=p-PIVOT_LEFT;k<=p+PIVOT_RIGHT;k++){ if(k===p)continue; if(bars5[k].low<=bars5[p].low){ok=false;break} } if(ok)return bars5[p].low }
  }
  return null
}
function bosAt(bars5:PriceBar[], j:number, dir:Direction):boolean {
  if(dir==='buy'){ const sh=lastConfirmedSwing(bars5,j,'high'); return sh!==null&&bars5[j].close>sh }
  const sl=lastConfirmedSwing(bars5,j,'low'); return sl!==null&&bars5[j].close<sl
}
function fvgAt(bars5:PriceBar[], j:number, dir:Direction):boolean {
  if(j<2)return false
  if(dir==='buy')return bars5[j-2].high<bars5[j].low
  return bars5[j-2].low>bars5[j].high
}
function firstFiveMinAfter(bars5:PriceBar[], closeTime30:number):number {
  let lo=0,hi=bars5.length-1,res=-1
  while(lo<=hi){ const mid=(lo+hi)>>1; if(bars5[mid].time>=closeTime30){res=mid;hi=mid-1} else lo=mid+1 }
  return res
}
function resolveOn30m(bars30:RawBar[], startIdx:number, dir:Direction, entry:number, sl:number, rr:number){
  const risk=Math.abs(entry-sl)
  const tp=dir==='buy'?entry+risk*rr:entry-risk*rr
  for(let j=startIdx+1;j<Math.min(startIdx+1+MAX_BARS_TO_RESOLVE_30M,bars30.length);j++){
    const b=bars30[j]; const btc=j-startIdx
    if(dir==='buy'){ if(b.low<=sl)return{outcome:'loss' as Outcome,rMultiple:-1,barsToClose:btc,tpPrice:tp}; if(b.high>=tp)return{outcome:'win' as Outcome,rMultiple:rr,barsToClose:btc,tpPrice:tp} }
    else { if(b.high>=sl)return{outcome:'loss' as Outcome,rMultiple:-1,barsToClose:btc,tpPrice:tp}; if(b.low<=tp)return{outcome:'win' as Outcome,rMultiple:rr,barsToClose:btc,tpPrice:tp} }
  }
  return {outcome:'unresolved' as Outcome,rMultiple:0,barsToClose:MAX_BARS_TO_RESOLVE_30M,tpPrice:tp}
}
function resolveOn5m(bars5:PriceBar[], startIdx:number, dir:Direction, entry:number, sl:number, rr:number){
  const risk=Math.abs(entry-sl)
  const tp=dir==='buy'?entry+risk*rr:entry-risk*rr
  for(let j=startIdx+1;j<Math.min(startIdx+1+MAX_BARS_TO_RESOLVE_5M,bars5.length);j++){
    const b=bars5[j]; const btc=j-startIdx
    if(dir==='buy'){ if(b.low<=sl)return{outcome:'loss' as Outcome,rMultiple:-1,barsToClose:btc,tpPrice:tp}; if(b.high>=tp)return{outcome:'win' as Outcome,rMultiple:rr,barsToClose:btc,tpPrice:tp} }
    else { if(b.high>=sl)return{outcome:'loss' as Outcome,rMultiple:-1,barsToClose:btc,tpPrice:tp}; if(b.low<=tp)return{outcome:'win' as Outcome,rMultiple:rr,barsToClose:btc,tpPrice:tp} }
  }
  return {outcome:'unresolved' as Outcome,rMultiple:0,barsToClose:MAX_BARS_TO_RESOLVE_5M,tpPrice:tp}
}
function calcStats(events:IctEvent[], rr:number):StatBlock {
  const closed=events.filter(e=>e.outcome==='win'||e.outcome==='loss')
  const wins=closed.filter(e=>e.outcome==='win')
  const wr=closed.length>0?wins.length/closed.length:0
  const avgR=closed.length>0?closed.reduce((s,e)=>s+e.rMultiple,0)/closed.length:0
  const exp=wr*rr-(1-wr)*1
  return { trades:closed.length, wins:wins.length, winRate:Math.round(wr*1000)/10, avgR:Math.round(avgR*1000)/1000, expectancy:Math.round(exp*1000)/1000 }
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
    const oiDelta = computeOIDeltaArray(bars30)
    const events: IctEvent[] = []
    let lastPinIdx = -Infinity
    const minStart = Math.max(params.oiSma, params.cvdSma, params.stallLookback, params.vwapWindow) + 1

    for (let i = minStart; i < bars30.length - MAX_BARS_TO_RESOLVE_30M; i++) {
      if (i - lastPinIdx < COOLDOWN_30M) continue
      const st = computeTrapStateAt(bars30, cvd, oiDelta, i, params)
      const close = bars30[i].close
      let dir: Direction | null = null
      if (st.shortsTrapped && close > st.vwap) dir = 'buy'
      else if (st.longsTrapped && close < st.vwap) dir = 'sell'
      if (!dir) continue
      lastPinIdx = i

      const closeTime30 = bars30[i].time + 30 * 60
      const start5 = firstFiveMinAfter(bars5, closeTime30)
      let bosC = false, fvgC = false, confirmIdx5 = -1, barsToStrict: number | undefined = undefined
      if (start5 !== -1) {
        const end5 = Math.min(start5 + CONFIRM_WINDOW_5M, bars5.length)
        for (let j = start5; j < end5; j++) {
          if (j < 2) continue
          if (bosAt(bars5, j, dir)) bosC = true
          if (fvgAt(bars5, j, dir)) fvgC = true
          if (bosC && fvgC) { confirmIdx5 = j; barsToStrict = j - start5; break }
        }
      }

      const slPrice = st.vwap   // option 1 : SL au VWAP du pin (fixe)

      if (bosC && fvgC && confirmIdx5 !== -1) {
        const entryPrice = bars5[confirmIdx5].close
        const distToSlPct = Math.abs((entryPrice - slPrice) / entryPrice) * 100
        const r = resolveOn5m(bars5, confirmIdx5, dir, entryPrice, slPrice, RR)
        events.push({
          pinTime: bars30[i].time, direction: dir, entryTiming: 'strict_5m_confirm', entryTime: bars5[confirmIdx5].time,
          entryPrice, vwapAtPin: st.vwap, slPrice, tpPrice: r.tpPrice, distToSlPct: Math.round(distToSlPct*1000)/1000,
          strict: 'pin_strict', bosConfirmed: true, fvgConfirmed: true, barsToStrict,
          outcome: r.outcome, rMultiple: r.rMultiple, barsToClose: r.barsToClose,
        })
      } else {
        const entryPrice = close
        const distToSlPct = Math.abs((entryPrice - slPrice) / entryPrice) * 100
        const r = resolveOn30m(bars30, i, dir, entryPrice, slPrice, RR)
        events.push({
          pinTime: bars30[i].time, direction: dir, entryTiming: 'pin_close', entryTime: bars30[i].time,
          entryPrice, vwapAtPin: st.vwap, slPrice, tpPrice: r.tpPrice, distToSlPct: Math.round(distToSlPct*1000)/1000,
          strict: 'pin_only', bosConfirmed: bosC, fvgConfirmed: fvgC, barsToStrict,
          outcome: r.outcome, rMultiple: r.rMultiple, barsToClose: r.barsToClose,
        })
      }
    }

    const buy = events.filter(e => e.direction === 'buy')
    const sell = events.filter(e => e.direction === 'sell')
    const pinOnly = events.filter(e => e.strict === 'pin_only')
    const pinStrict = events.filter(e => e.strict === 'pin_strict')

    // Garde-fou R aberrants : stats des stricts filtrées sur distToSl >= 0.15%
    const strictClean = pinStrict.filter(e => e.distToSlPct >= 0.15)

    const results = {
      generatedAt: new Date().toISOString(),
      symbol,
      paramsUsed: { rr: RR, confirmWindow5m: CONFIRM_WINDOW_5M, oiSma: params.oiSma, cvdSma: params.cvdSma, stallLookback: params.stallLookback, vwapWindow: params.vwapWindow },
      bars30: bars30.length,
      bars5: bars5.length,
      totalPins: events.length,
      strictCount: pinStrict.length,
      strictRatePct: events.length > 0 ? Math.round((pinStrict.length / events.length) * 1000) / 10 : 0,
      overall: calcStats(events, RR),
      byDirection: { buy: calcStats(buy, RR), sell: calcStats(sell, RR) },
      byStrict: { pin_only: calcStats(pinOnly, RR), pin_strict: calcStats(pinStrict, RR) },
      strictCleanStats: { note: 'pin_strict filtré sur distToSlPct>=0.15% (retire les SL aberrants)', count: strictClean.length, stats: calcStats(strictClean, RR) },
      crossBreakdown: {
        buy_pin_only: calcStats(buy.filter(e => e.strict === 'pin_only'), RR),
        buy_pin_strict: calcStats(buy.filter(e => e.strict === 'pin_strict'), RR),
        sell_pin_only: calcStats(sell.filter(e => e.strict === 'pin_only'), RR),
        sell_pin_strict: calcStats(sell.filter(e => e.strict === 'pin_strict'), RR),
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
