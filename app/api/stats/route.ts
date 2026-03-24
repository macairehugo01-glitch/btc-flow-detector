import { NextResponse } from 'next/server'
import { getRecentSetups, getStats } from '../../../store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    recentSetups: getRecentSetups(),
    stats: getStats(),
  })
}
