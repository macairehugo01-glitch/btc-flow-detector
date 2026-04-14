'use client'

import { useMacroContext } from './useMacroContext'

function colorFromBias(bias?: 'bullish' | 'bearish' | 'neutral') {
  if (bias === 'bullish') return 'var(--accent-green)'
  if (bias === 'bearish') return 'var(--accent-red)'
  return 'var(--accent-yellow)'
}

function scoreColor(score: number) {
  if (score >= 2) return 'var(--accent-green)'
  if (score <= -2) return 'var(--accent-red)'
  return 'var(--accent-yellow)'
}

export default function MacroPanel() {
  const { data, loading, error } = useMacroContext()

  if (loading) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)',
          borderRadius: 12,
          padding: 16,
        }}
      >
        Chargement macro...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--bg-border)',
          borderRadius: 12,
          padding: 16,
          color: 'var(--accent-red)',
        }}
      >
        ⚠ {error || 'No macro data'}
      </div>
    )
  }

  const rows = [data.dxy, data.vix, data.us10y].filter(Boolean)

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
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
          Macro Context
        </div>

        <div
          style={{
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 700,
            color: scoreColor(data.macroScore),
          }}
        >
          {data.macroBias} ({data.macroScore})
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => (
          <div
            key={row!.label}
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
                alignItems: 'center',
                gap: 10,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                }}
              >
                {row!.label}
              </div>

              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: colorFromBias(row!.bias),
                }}
              >
                {row!.value != null ? row!.value.toFixed(2) : '—'}
                {row!.unit === '%' ? '%' : ''}
              </div>
            </div>

            <div
              style={{
                fontSize: 12,
                fontFamily: 'monospace',
                color:
                  row!.change == null
                    ? 'var(--text-muted)'
                    : row!.change >= 0
                    ? 'var(--accent-green)'
                    : 'var(--accent-red)',
                marginBottom: 6,
              }}
            >
              Δ {row!.change != null ? row!.change.toFixed(2) : '—'}
            </div>

            <div
              style={{
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.35,
              }}
            >
              {row!.interpretation}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
