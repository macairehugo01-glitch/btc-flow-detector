import { openPosition } from '../../../store'
import { NextResponse } from 'next/server'

export async function GET() {
  await openPosition({
    timestamp: Date.now(),
    timeframe: '5m',
    action: 'BUY',
    confidence: 5,
    entryPrice: 90000,
    referenceBarKey: 'test-bar',
    signalType: 'continuation_long',
    marketRegime: 'trend',
    vwapDistancePct: 0.1,
    volatilityBucket: 'medium',
  })
  return NextResponse.json({ ok: true })
}
