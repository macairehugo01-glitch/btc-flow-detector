import { sendTelegramMessage } from '../../../lib/telegram'
import { NextResponse } from 'next/server'

export async function GET() {
  await sendTelegramMessage('✅ TEST DIRECT telegram')
  return NextResponse.json({ ok: true })
}
