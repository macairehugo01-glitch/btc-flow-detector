import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/data'
const SIGNAL_LOG = path.join(DATA_DIR, 'signal-log.csv')

export async function GET() {
  try {
    if (!fs.existsSync(SIGNAL_LOG)) {
      return NextResponse.json({ error: 'Pas encore de logs — attendre le prochain cycle.' }, { status: 404 })
    }

    const content = fs.readFileSync(SIGNAL_LOG, 'utf-8')

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="signal-log-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE pour vider le log
export async function DELETE() {
  try {
    if (fs.existsSync(SIGNAL_LOG)) {
      fs.unlinkSync(SIGNAL_LOG)
    }
    return NextResponse.json({ message: 'Log vidé avec succès' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
