import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type TECalendarItem = {
  CalendarID?: string
  Date: string
  Country: string
  Event: string
  Actual?: string
  Previous?: string
  Forecast?: string
  Importance: number
  Currency?: string
}

export async function GET() {
  try {
    const res = await fetch(
      'https://api.tradingeconomics.com/calendar?c=guest:guest&f=json',
      {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`TradingEconomics error ${res.status}: ${text}`)
    }

    const raw = (await res.json()) as TECalendarItem[]

    const filtered = raw
      .filter((item) => item.Importance === 2 || item.Importance === 3)
      .sort((a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime())
      .slice(0, 20)

    return NextResponse.json({
      items: filtered,
      lastUpdate: Date.now(),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown calendar route error'

    return NextResponse.json(
      {
        error: message,
        items: [],
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
