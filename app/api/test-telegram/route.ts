import { sendTelegramMessage } from '../../../lib/telegram'
import { NextResponse } from 'next/server'

export async function GET() {
  await sendTelegramMessage('✅ *TEST* - Telegram fonctionne bien !')
  return NextResponse.json({ ok: true })
}
