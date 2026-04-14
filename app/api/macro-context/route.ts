import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type MacroSeriesPoint = {
  label: string
  value: number | null
  previous: number | null
  change: number | null
  unit: string
  bias: 'bullish' | 'bearish' | 'neutral'
  interpretation: string
}

function extractObservations(html: string): number[] {
  const matches = [...html.matchAll(/202\d-\d\d-\d\d:\s*([0-9]+(?:\.[0-9]+)?)/g)]
  return matches
    .map((m) => Number(m[1]))
    .filter((n) => !Number.isNaN(n))
}

async function fetchFredSeries(url: string) {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  })

  const html = await res.text()

  if (!res.ok) {
    throw new Error(`Macro source error ${res.status}: ${html.slice(0, 200)}`)
  }

  const values = extractObservations(html)
  return {
    latest: values[0] ?? null,
    previous: values[1] ?? null,
  }
}

function buildChange(latest: number | null, previous: number | null) {
  if (latest == null || previous == null) return null
  return latest - previous
}

export async function GET() {
  try {
    const [dxyRaw, vixRaw, us10yRaw] = await Promise.all([
      fetchFredSeries('https://fred.stlouisfed.org/series/DTWEXBGS'),
      fetchFredSeries('https://fred.stlouisfed.org/series/VIXCLS'),
      fetchFredSeries('https://fred.stlouisfed.org/series/DGS10'),
    ])

    const dxyChange = buildChange(dxyRaw.latest, dxyRaw.previous)
    const vixChange = buildChange(vixRaw.latest, vixRaw.previous)
    const us10yChange = buildChange(us10yRaw.latest, us10yRaw.previous)

    const dxy: MacroSeriesPoint = {
      label: 'DXY Broad',
      value: dxyRaw.latest,
      previous: dxyRaw.previous,
      change: dxyChange,
      unit: 'index',
      bias:
        dxyChange == null ? 'neutral' : dxyChange < 0 ? 'bullish' : 'bearish',
      interpretation:
        dxyChange == null
          ? 'Dollar proxy unavailable'
          : dxyChange < 0
          ? 'Dollar softer → supports risk assets'
          : 'Dollar firmer → pressure on risk assets',
    }

    const vix: MacroSeriesPoint = {
      label: 'VIX',
      value: vixRaw.latest,
      previous: vixRaw.previous,
      change: vixChange,
      unit: 'index',
      bias:
        vixRaw.latest == null
          ? 'neutral'
          : vixRaw.latest < 15
          ? 'bullish'
          : vixRaw.latest > 25
          ? 'bearish'
          : 'neutral',
      interpretation:
        vixRaw.latest == null
          ? 'Volatility unavailable'
          : vixRaw.latest < 15
          ? 'Low stress / calm regime'
          : vixRaw.latest > 25
          ? 'High stress / risk-off regime'
          : 'Mixed volatility regime',
    }

    const us10y: MacroSeriesPoint = {
      label: 'US 10Y',
      value: us10yRaw.latest,
      previous: us10yRaw.previous,
      change: us10yChange,
      unit: '%',
      bias:
        us10yChange == null ? 'neutral' : us10yChange < 0 ? 'bullish' : 'bearish',
      interpretation:
        us10yChange == null
          ? 'Yield unavailable'
          : us10yChange < 0
          ? 'Yields easing → less pressure on risk'
          : 'Yields rising → tighter financial conditions',
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
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown macro context error'

    return NextResponse.json(
      {
        error: message,
        dxy: null,
        vix: null,
        us10y: null,
        macroScore: 0,
        macroBias: 'NEUTRAL',
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
