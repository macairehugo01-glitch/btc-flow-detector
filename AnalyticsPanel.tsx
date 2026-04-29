'use client'

import { useAnalytics, type AnalyticsRow } from './useAnalytics'
import HeatmapPanel from './HeatmapPanel'

function Table({
  title,
  rows,
}: {
  title: string
  rows: AnalyticsRow[]
}) {
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
        {title}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bg-border)' }}>
              {['Label', 'Trades', 'WR', 'R', 'Exp', 'PF'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: 'left',
                    padding: '0 12px 8px 0',
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                style={{ borderBottom: '1px solid var(--bg-border)' }}
              >
                <td style={{ padding: '8px 12px 8px 0' }}>{r.label}</td>
                <td style={{ paddingRight: 12 }}>{r.trades}</td>
                <td style={{ paddingRight: 12 }}>{(r.winrate ?? 0).toFixed(1)}%</td>
                <td style={{ paddingRight: 12 }}>{(r.rTotal ?? 0).toFixed(2)}</td>
                <td style={{ paddingRight: 12 }}>{(r.expectancy ?? 0).toFixed(3)}</td>
                <td style={{ paddingRight: 12 }}>{(r.profitFactor ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AnalyticsPanel() {
  const { analytics, loading, error } = useAnalytics()

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
        Chargement analytics...
      </div>
    )
  }

  if (error || !analytics) {
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
        ⚠ {error || 'No analytics'}
      </div>
    )
  }

  const overview = analytics.overview

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          Analytics
        </div>

        <a
          href="/api/analytics/export"
          style={{
            textDecoration: 'none',
            border: '1px solid var(--bg-border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            borderRadius: 8,
            padding: '8px 12px',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Export CSV
        </a>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {[
          ['Trades', overview.trades],
          ['WR', `${(overview.winrate ?? 0).toFixed(1)}%`],
          ['R Total', (overview.rTotal ?? 0).toFixed(2)],
          ['Expectancy', (overview.expectancy ?? 0).toFixed(3)],
          ['PF', (overview.profitFactor ?? 0).toFixed(2)],
          ['Avg DD', (overview.avgDrawdownR ?? 0).toFixed(2)],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--bg-border)',
              borderRadius: 12,
              padding: 14,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontFamily: 'monospace',
                color: 'var(--text-muted)',
                marginBottom: 8,
                textTransform: 'uppercase',
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        <Table title="By Session" rows={analytics.bySession} />
        <Table title="By Hour" rows={analytics.byHour} />
        <Table title="By Timeframe" rows={analytics.byTimeframe} />
        <Table title="By Direction" rows={analytics.byDirection} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
        }}
      >
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--text-muted)',
              marginBottom: 10,
              textTransform: 'uppercase',
            }}
          >
            Streaks
          </div>

          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
          >
            <div>Max Win Streak: {analytics.streaks.maxWinStreak}</div>
            <div>Max Loss Streak: {analytics.streaks.maxLossStreak}</div>
            <div>Current Win Streak: {analytics.streaks.currentWinStreak}</div>
            <div>Current Loss Streak: {analytics.streaks.currentLossStreak}</div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)',
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              color: 'var(--text-muted)',
              marginBottom: 10,
              textTransform: 'uppercase',
            }}
          >
            Drawdown
          </div>

          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}
          >
            <div>Max DD: {(analytics.drawdown.maxDrawdownR ?? 0).toFixed(2)}R</div>
            <div>Current DD: {(analytics.drawdown.currentDrawdownR ?? 0).toFixed(2)}R</div>
          </div>
        </div>
      </div>

      <HeatmapPanel heatmap={analytics.heatmap} />
    </div>
  )
}
