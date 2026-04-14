import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const API_KEY = '3C1HR6UVHPU8UJZM'

type Macro = {
  label: string
  value: number | null
  change: number | null
  bias: 'bullish' | 'bearish' | 'neutral'
}

async function fetchText(url: string, timeoutMs = 8000) {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    return text
  } finally {
    clearTimeout(timer)
  }
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

function parseDxyFromStooq(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const liveMatch = text.match(
    /\b\d{1,2}\s\w{3},\s\d{2}:\d{2}\s+([0-9]+(?:\.[0-9]+)?)\s+([+-]?[0-9]+(?:\.[0-9]+)?)\s+\(([+-]?[0-9]+(?:\.[0-9]+)?)%\)/
  )

  if (liveMatch) {
    return {
      price: Number(liveMatch[1]),
      change: Number(liveMatch[2]),
    }
  }

  const histMatch = text.match(
    /\b\d{1,2}\s\w{3}\s20\d{2}\s[0-9.]+\s[0-9.]+\s[0-9.]+\s([0-9.]+)\s([+-]?[0-9.]+)/
  )

  if (histMatch) {
    return {
      price: Number(histMatch[1]),
      change: Number(histMatch[2]),
    }
  }

  return null
}

function parseFredObservations(html: string) {
  const matches = [...html.matchAll(/20\d{2}-\d{2}-\d{2}:\s*([0-9]+(?:\.[0-9]+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => !Number.isNaN(n))

  return {
    latest: matches[0] ?? null,
    previous: matches[1] ?? null,
  }
}

export async function GET() {
  try {
    const [dxyHtml, vixHtml, us10yRes] = await Promise.all([
      fetchText('https://stooq.com/q/d/?s=dx.f').catch(() => null),
      fetchText('https://fred.stlouisfed.org/series/VIXCLS').catch(() => null),
      fetchJSON(
        `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${API_KEY}`
      ),
    ])

    const dxyParsed = dxyHtml ? parseDxyFromStooq(dxyHtml) : null
    const vixParsed = vixHtml ? parseFredObservations(vixHtml) : { latest: null, previous: null }

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

    const dxy: Macro = {
      label: 'DXY',
      value: dxyParsed?.price ?? null,
      change: dxyParsed?.change ?? null,
      bias:
        dxyParsed?.change == null
          ? 'neutral'
          : dxyParsed.change < 0
          ? 'bullish'
          : 'bearish',
    }

    const vixChange =
      vixParsed.latest != null && vixParsed.previous != null
        ? vixParsed.latest - vixParsed.previous
        : null

    const vix: Macro = {
      label: 'VIX',
      value: vixParsed.latest,
      change: vixChange,
      bias:
        vixParsed.latest == null
          ? 'neutral'
          : vixParsed.latest < 15
          ? 'bullish'
          : vixParsed.latest > 25
          ? 'bearish'
          : 'neutral',
    }

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
  } catch (error) {
    return NextResponse.json({
      dxy: { label: 'DXY', value: null, change: null, bias: 'neutral' },
      vix: { label: 'VIX', value: null, change: null, bias: 'neutral' },
      us10y: { label: 'US10Y', value: null, change: null, bias: 'neutral' },
      macroScore: 0,
      macroBias: 'NEUTRAL',
      error: error instanceof Error ? error.message : 'Macro fetch failed',
      lastUpdate: Date.now(),
    })
  }
}
