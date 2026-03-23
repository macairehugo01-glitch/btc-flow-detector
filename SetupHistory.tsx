/**
 * app/api/setups/route.ts
 * Return stored setup history from SQLite
 */

import { NextResponse } from 'next/server'
import { getRecentSetups, getSetupStats } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const setups = getRecentSetups(30)
    const stats = getSetupStats()

    return NextResponse.json({ setups, stats })
  } catch (err) {
    console.error('Setups API error:', err)
    return NextResponse.json({ setups: [], stats: { total: 0, longs: 0, shorts: 0 } })
  }
}
