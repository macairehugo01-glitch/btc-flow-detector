'use client'

import { useEffect, useState } from 'react'

type NewsItem = {
  id: string
  title: string
  link: string
  pubDate: string
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function highlight(title: string) {
  const t = title.toLowerCase()

  if (
    t.includes('war') ||
    t.includes('conflict') ||
    t.includes('trump')
  ) {
    return 'var(--accent-red)'
  }

  if (
    t.includes('oil') ||
    t.includes('gold') ||
    t.includes('bitcoin') ||
    t.includes('crypto') ||
    t.includes('fed') ||
    t.includes('inflation')
  ) {
    return 'var(--accent-yellow)'
  }

  return 'var(--text-primary)'
}

export default function EconomicCalendarPanel() {
  const [items, setItems] = useState<NewsItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const res = await fetch('/api/calendar', { cache: 'no-store' })
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load news')
        }

        if (!cancelled) {
          setItems(data.items || [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
        }
      }
    }

    load()
    const interval = setInterval(load, 30000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 12,
        padding: 12,
        height: 320,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--text-muted)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        Macro News (Live)
      </div>

      {error ? (
        <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>
          ⚠ {error}
        </div>
      ) : (
        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {items.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  border: '1px solid var(--bg-border)',
                  borderRadius: 10,
                  padding: 10,
                  background: 'rgba(255,255,255,0.02)',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    marginBottom: 4,
                    fontFamily: 'monospace',
                  }}
                >
                  {formatTime(item.pubDate)}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: highlight(item.title),
                    lineHeight: 1.35,
                  }}
                >
                  {item.title}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
