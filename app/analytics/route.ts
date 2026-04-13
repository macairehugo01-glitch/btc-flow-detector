import { NextResponse } from 'next/server'
import { getTradeJournal } from '../../../store'
import { getAnalyticsSnapshot } from '../../../analytics'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const analytics = getAnalyticsSnapshot(getTradeJournal())

    return NextResponse.json({
      analytics,
      lastUpdate: Date.now(),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown analytics route error'

    return NextResponse.json(
      {
        error: message,
        analytics: null,
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
