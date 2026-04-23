import { openPosition } from '../../../store'
import { sendTelegramMessage } from '../../../lib/telegram'
import { NextResponse } from 'next/server'

export async function GET() {
  await sendTelegramMessage('✅ AVANT openPosition')
  await openPosition({
    timestamp: Date.now(),
    timeframe: '5m',
    action: 'BUY',
    confidence: 5,
    entryPrice: 90000,
    referenceBarKey: 'test-bar-2',
    signalType: 'continuation_long',
    marketRegime: 'trend',
    vwapDistancePct: 0.1,
    volatilityBucket: 'medium',
  })
  await sendTelegramMessage('✅ APRES openPosition')
  return NextResponse.json({ ok: true })
}
