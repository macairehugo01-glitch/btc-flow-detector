import { NextResponse } from 'next/server'
import { getTradeJournal } from '../../../../store'

export const dynamic = 'force-dynamic'

function csvEscape(value: unknown) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET() {
  try {
    const journal = getTradeJournal()

    const headers = [
      'id',
      'timestamp',
      'closedAt',
      'session',
      'weekday',
      'hourBucket',
      'timeframe',
      'action',
      'confidence',
      'signalType',
      'marketRegime',
      'vwapSide',
      'vwapDistancePct',
      'volatilityBucket',
      'entryPrice',
      'stopLoss',
      'takeProfit',
      'rr',
      'riskPercent',
      'status',
      'exitPrice',
      'rMultiple',
      'drawdownR',
      'durationMinutes',
      'referenceBarKey',
    ]

    const rows = journal.map((t) =>
      [
        t.id,
        t.timestamp,
        t.closedAt ?? '',
        t.session,
        t.weekday,
        t.hourBucket,
        t.timeframe,
        t.action,
        t.confidence,
        t.signalType,
        t.marketRegime,
        t.vwapSide,
        t.vwapDistancePct,
        t.volatilityBucket,
        t.entryPrice,
        t.stopLoss,
        t.takeProfit,
        t.rr,
        t.riskPercent,
        t.status,
        t.exitPrice ?? '',
        t.rMultiple ?? '',
        t.drawdownR ?? '',
        t.durationMinutes ?? '',
        t.referenceBarKey,
      ].map(csvEscape).join(',')
    )

    const csv = [headers.join(','), ...rows].join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="trade-journal.csv"',
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'CSV export failed',
      },
      { status: 500 }
    )
  }
}
