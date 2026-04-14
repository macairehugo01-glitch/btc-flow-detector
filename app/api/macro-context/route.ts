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
    return await res.json()
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const [vixRes, us10yRes] = await Promise.all([
      fetchJSON(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=^VIX&apikey=${API_KEY}`
      ),
      fetchJSON(
        `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${API_KEY}`
      ),
    ])

    // VIX
    const vixPrice = Number(vixRes?.['Global Quote']?.['05. price']) || null
    const vixChange =
      Number(vixRes?.['Global Quote']?.['09. change']) || null

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

    // US10Y
    const us10yValue =
      Number(us10yRes?.data?.[0]?.value) || null
    const us10yPrev =
      Number(us10yRes?.data?.[1]?.value) || null

    const us10yChange =
      us10yValue && us10yPrev ? us10yValue - us10yPrev : null

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

    // DXY proxy simple (EURUSD inverse)
    const eurusdRes = await fetchJSON(
      `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=EUR&to_currency=USD&apikey=${API_KEY}`
    )

    const eurusd =
      Number(
        eurusdRes?.['Realtime Currency Exchange Rate']?.[
          '5. Exchange Rate'
        ]
      ) || null

    const dxy: Macro = {
      label: 'DXY (proxy)',
      value: eurusd,
      change: null,
      bias:
        eurusd == null
          ? 'neutral'
          : eurusd > 1.08
          ? 'bearish' // USD weak
          : eurusd < 1.06
          ? 'bullish' // USD strong
          : 'neutral',
    }

    // SCORE
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
  } catch (err) {
    return NextResponse.json({
      error: 'Macro fetch failed',
      macroScore: 0,
      macroBias: 'NEUTRAL',
    })
  }
}
