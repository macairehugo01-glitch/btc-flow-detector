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

function buildChange(latest: number | null, previous: number | null) {
  if (latest == null || previous == null) return null
  return latest - previous
}

function parseFredHtmlValue(html: string): { latest: number | null; previous: number | null } {
  const matches = [...html.matchAll(/20\d{2}-\d{2}-\d{2}:\s*([0-9]+(?:\.[0-9]+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => !Number.isNaN(n))

  return {
    latest: matches[0] ?? null,
    previous: matches[1] ?? null,
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    })

    const text = await res.text()

    if (!res.ok) {
      throw new Error(`Source ${res.status}: ${text.slice(0, 200)}`)
    }

    return text
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFredSeries(url: string) {
  try {
    const html = await fetchWithTimeout(url, 8000)
    return parseFredHtmlValue(html)
  } catch {
    return {
      latest: null,
      previous: null,
    }
  }
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
    return NextResponse.json({
      dxy: {
        label: 'DXY Broad',
        value: null,
        previous: null,
        change: null,
        unit: 'index',
        bias: 'neutral',
        interpretation: 'Unavailable',
      },
      vix: {
        label: 'VIX',
        value: null,
        previous: null,
        change: null,
        unit: 'index',
        bias: 'neutral',
        interpretation: 'Unavailable',
      },
      us10y: {
        label: 'US 10Y',
        value: null,
        previous: null,
        change: null,
        unit: '%',
        bias: 'neutral',
        interpretation: 'Unavailable',
      },
      macroScore: 0,
      macroBias: 'NEUTRAL',
      error: error instanceof Error ? error.message : 'Unknown macro error',
      lastUpdate: Date.now(),
    })
  }
}
