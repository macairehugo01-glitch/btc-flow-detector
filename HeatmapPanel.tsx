'use client'

type HeatmapCell = {
  weekday: string
  hourBucket: string
  trades: number
  expectancy: number
  rTotal: number
}

function cellColor(value: number) {
  if (value > 0.4) return 'rgba(0,212,168,0.35)'
  if (value > 0.15) return 'rgba(0,212,168,0.18)'
  if (value < -0.4) return 'rgba(255,71,87,0.35)'
  if (value < -0.15) return 'rgba(255,71,87,0.18)'
  return 'rgba(255,255,255,0.04)'
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function buildHourBuckets() {
  return Array.from({ length: 24 }, (_, h) => {
    const next = (h + 1) % 24
    return `${String(h).padStart(2, '0')}:00-${String(next).padStart(2, '0')}:00`
  })
}

export default function HeatmapPanel({
  heatmap,
}: {
  heatmap: HeatmapCell[]
}) {
  const hourBuckets = buildHourBuckets()

  function findCell(weekday: string, hourBucket: string) {
    return heatmap.find(
      (c) => c.weekday === weekday && c.hourBucket === hourBucket
    )
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
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
        Heatmap (Expectancy par jour / heure)
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            borderCollapse: 'separate',
            borderSpacing: 4,
            fontSize: 11,
            fontFamily: 'monospace',
            minWidth: 1100,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  color: 'var(--text-muted)',
                  paddingRight: 8,
                }}
              >
                Jour
              </th>
              {hourBuckets.map((hour) => (
                <th
                  key={hour}
                  style={{
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    padding: '0 4px 6px 4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {hour.slice(0, 5)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {WEEKDAYS.map((day) => (
              <tr key={day}>
                <td
                  style={{
                    color: 'var(--text-secondary)',
                    paddingRight: 8,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {day}
                </td>

                {hourBuckets.map((hour) => {
                  const cell = findCell(day, hour)
                  const expectancy = cell?.expectancy ?? 0
                  const trades = cell?.trades ?? 0

                  return (
                    <td key={`${day}-${hour}`}>
                      <div
                        title={`${day} ${hour}
Trades: ${trades}
Expectancy: ${expectancy.toFixed(3)}
R Total: ${(cell?.rTotal ?? 0).toFixed(2)}`}
                        style={{
                          width: 34,
                          height: 28,
                          borderRadius: 6,
                          background: cellColor(expectancy),
                          border: '1px solid var(--bg-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color:
                            trades > 0
                              ? 'var(--text-primary)'
                              : 'var(--text-muted)',
                          fontSize: 10,
                        }}
                      >
                        {trades > 0 ? trades : ''}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--text-secondary)',
        }}
      >
        <span>Vert = expectancy positive</span>
        <span>Rouge = expectancy négative</span>
        <span>Nombre = trades</span>
      </div>
    </div>
  )
}
