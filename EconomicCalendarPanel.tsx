'use client'

import { useEffect, useState } from 'react'

type CalendarItem = {
  CalendarID?: string
  Date?: string
  Country?: string
  Event?: string
  Actual?: string
  Previous?: string
  Forecast?: string
  Importance?: number
  Currency?: string
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function starLabel(importance?: number) {
  if (importance === 3) return '★★★'
  if (importance === 2) return '★★'
  return '★'
}

function starColor(importance?: number) {
  if (importance === 3) return 'var(--accent-red)'
  if (importance === 2) return 'var(--accent-yellow)'
  return 'var(--text-muted)'
}

export default function EconomicCalendarPanel() {
  const [items, setItems] = useState<CalendarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number | null>(null)
  const [debug, setDebug] = useState<{ totalRaw?: number; totalFiltered?: number }>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setError(null)
        const res = await fetch('/api/calendar', {
          cache: 'no-store',
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load calendar')
        }

        if (!cancelled) {
          setItems(data.items ?? [])
          setLastUpdate(data.lastUpdate ?? Date.now())
          setDebug({
            totalRaw: data.totalRaw,
            totalFiltered: data.totalFiltered,
          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    const timer = setInterval(load, 60_000)

    return () => {
      cancelled = true
      clearInterval(timer)
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
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          News (2★ / 3★)
        </div>

        <div
          style={{
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
          }}
        >
          {lastUpdate
            ? `MAJ ${new Date(lastUpdate).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
              })}`
            : 'MAJ —'}
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Chargement du calendrier...
        </div>
      ) : error ? (
        <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>
          ⚠ {error}
        </div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          <div>Aucune news 2★ / 3★ trouvée.</div>
          <div>Raw: {debug.totalRaw ?? 0}</div>
          <div>Filtered: {debug.totalFiltered ?? 0}</div>
        </div>
      ) : (
        <div
          style={{
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            paddingRight: 4,
          }}
        >
          {items.map((item, idx) => (
            <div
              key={`${item.CalendarID ?? item.Event}-${idx}`}
              style={{
                border: '1px solid var(--bg-border)',
                borderRadius: 10,
                padding: 10,
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 6,
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {formatTime(item.Date)}
                </span>

                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: starColor(item.Importance),
                  }}
                >
                  {starLabel(item.Importance)}
                </span>
              </div>

              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: 6,
                  lineHeight: 1.3,
                }}
              >
                {item.Country || '—'} — {item.Event || '—'}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                    Actual
                  </div>
                  <div>{item.Actual || '—'}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                    Forecast
                  </div>
                  <div>{item.Forecast || '—'}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
                    Previous
                  </div>
                  <div>{item.Previous || '—'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
