import { NextResponse } from 'next/server'
import { getRecentSetups, getStats } from '@/lib/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ setups: getRecentSetups(30), stats: getStats() })
}
