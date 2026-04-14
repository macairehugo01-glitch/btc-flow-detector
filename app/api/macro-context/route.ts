import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const API_KEY = '3C1HR6UVHPU8UJZM'

type Macro = {
  label: string
  value: number | null
  change: number | null
  bias: 'bullish' | 'bearish' | 'neutral'
}

async function fetchJSON(url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function fetchYahoo(symbol: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
      { cache: 'no-store' }
    )

    if (!res.ok) return null

    const json = await res.json()
    const result = json?.quoteResponse?.result?.[0]

    if (!result) return null

    return {
      price:
        typeof result.regularMarketPrice === 'number'
          ? result.regularMarketPrice
          : null,
      change:
        typeof result.regularMarketChange === 'number'
          ? result.regularMarketChange
          : null,
    }
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const [dxyRaw, vixRaw, us10yRes] = await Promise.all([
      fetchYahoo('DX-Y.NYB'),
      fetchYahoo('^VIX'),
      fetchJSON(
        `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${API_KEY}`
      ),
    ])

    const dxy: Macro = {
      label: 'DXY',
      value: dxyRaw?.price ?? null,
      change: dxyRaw?.change ?? null,
      bias:
        dxyRaw?.change == null
          ? 'neutral'
          : dxyRaw.change < 0
          ? 'bullish'
          : 'bearish',
    }

    const vixPrice = vixRaw?.price ?? null
    const vixChange = vixRaw?.change ?? null

    const vix: Macro = {
      label: 'VIX',
      value: vixPrice,
      change: vixChange,
      bias:
        vixPrice == null
          ? 'neutral'
          : vixPrice < 15
          ? 'bullish'
          : vixPrice > 25
          ? 'bearish'
          : 'neutral',
    }

    const us10yValue =
      typeof us10yRes?.data?.[0]?.value === 'string' ||
      typeof us10yRes?.data?.[0]?.value === 'number'
        ? Number(us10yRes.data[0].value)
        : null

    const us10yPrev =
      typeof us10yRes?.data?.[1]?.value === 'string' ||
      typeof us10yRes?.data?.[1]?.value === 'number'
        ? Number(us10yRes.data[1].value)
        : null

    const us10yChange =
      us10yValue != null && us10yPrev != null ? us10yValue - us10yPrev : null

    const us10y: Macro = {
      label: 'US10Y',
      value: us10yValue,
      change: us10yChange,
      bias:
        us10yChange == null
          ? 'neutral'
          : us10yChange < 0
          ? 'bullish'
          : 'bearish',
    }

    const score =
      (dxy.bias === 'bullish' ? 1 : dxy.bias === 'bearish' ? -1 : 0) +
      (vix.bias === 'bullish' ? 1 : vix.bias === 'bearish' ? -1 : 0) +
      (us10y.bias === 'bullish' ? 1 : us10y.bias === 'bearish' ? -1 : 0)

    const macroBias =
      score >= 2 ? 'RISK-ON' : score <= -2 ? 'RISK-OFF' : 'NEUTRAL'

    return NextResponse.json({
      dxy,
      vix,
      us10y,
      macroScore: score,
      macroBias,
      lastUpdate: Date.now(),
    })
  } catch {
    return NextResponse.json({
      dxy: null,
      vix: null,
      us10y: null,
      macroScore: 0,
      macroBias: 'NEUTRAL',
      error: 'Macro fetch failed',
      lastUpdate: Date.now(),
    })
  }
}
