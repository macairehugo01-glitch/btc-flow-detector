import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const API_KEY = '3C1HR6UVHPU8UJZM'

async function fetchText(url: string) {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: '*/*',
      },
    })

    const text = await res.text()

    return {
      ok: res.ok,
      status: res.status,
      text: text.slice(0, 500),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : 'unknown fetch error',
    }
  }
}

async function fetchJson(url: string) {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: 'application/json,*/*',
      },
    })

    const text = await res.text()

    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {}

    return {
      ok: res.ok,
      status: res.status,
      text: text.slice(0, 500),
      json,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: error instanceof Error ? error.message : 'unknown fetch error',
      json: null,
    }
  }
}

export async function GET() {
  const [dxy, vix, us10y] = await Promise.all([
    fetchText('https://stooq.com/q/d/?s=dx.f'),
    fetchText('https://fred.stlouisfed.org/series/VIXCLS'),
    fetchJson(
      `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${API_KEY}`
    ),
  ])

  return NextResponse.json({
    dxy,
    vix,
    us10y,
    lastUpdate: Date.now(),
  })
}
