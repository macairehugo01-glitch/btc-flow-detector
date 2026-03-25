import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type NewsItem = {
  id: string
  title: string
  link: string
  pubDate: string
}

function extractTag(content: string, tag: string) {
  const match = content.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'))
  return match ? match[1] : ''
}

function clean(text: string) {
  return text
    .replace(/<!\\[CDATA\\[(.*?)\\]\\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .trim()
}

export async function GET() {
  try {
    const res = await fetch('https://feeds.reuters.com/reuters/businessNews', {
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`RSS error ${res.status}`)
    }

    const xml = await res.text()
    const itemsRaw = xml.split('<item>').slice(1)

    const items: NewsItem[] = itemsRaw.slice(0, 20).map((item, i) => {
      const title = clean(extractTag(item, 'title'))
      const link = extractTag(item, 'link')
      const pubDate = extractTag(item, 'pubDate')

      return {
        id: link || `${title}-${i}`,
        title,
        link,
        pubDate,
      }
    })

    return NextResponse.json({
      items,
      lastUpdate: Date.now(),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch RSS'

    return NextResponse.json(
      {
        error: message,
        items: [],
        lastUpdate: Date.now(),
      },
      { status: 500 }
    )
  }
}
