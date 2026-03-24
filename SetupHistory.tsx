'use client'

import { useMarketStore } from './useMarketStore'

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function SetupHistory() {
  const { setupHistory, setupStats, sessionStats } = useMarketStore()

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
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
        <span
          style={{
            fontSize: 11,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: 'var(--text-muted)',
          }}
        >
          ⏱ Historique des Setups
        </span>

        <div
          style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
          }}
        >
          <span>Total: {setupStats.total}</span>
          <span style={{ color: 'var(--accent-green)' }}>
            Wins: {setupStats.wins}
          </span>
          <span style={{ color: 'var(--accent-red)' }}>
            Losses: {setupStats.losses}
          </span>
          <span>Open: {setupStats.open}</span>
          <span>WR 2R: {setupStats.winrate.toFixed(1)}%</span>
        </div>
      </div>

      {sessionStats.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
          }}
        >
          {sessionStats.map((s) => (
            <div
              key={s.session}
              style={{
                border: '1px solid var(--bg-border)',
                borderRadius: 10,
                padding: 12,
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 8,
                }}
              >
                {s.session}
              </div>

              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <div>Total: {s.total}</div>
                <div style={{ color: 'var(--accent-green)' }}>Wins: {s.wins}</div>
                <div style={{ color: 'var(--accent-red)' }}>Losses: {s.losses}</div>
                <div>Open: {s.open}</div>
                <div>WR: {s.winrate.toFixed(1)}%</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {setupHistory.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '24px 0',
            color: 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Aucun setup 4/5+ enregistré
        </div>
      ) : (
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
                {[
                  'Heure',
                  'Session',
                  'TF',
                  'Action',
                  'Conf',
                  'Entry',
                  'SL',
                  'TP',
                  'RR',
                  'Status',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      paddingBottom: 8,
                      paddingRight: 12,
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
              {setupHistory.map((s) => {
                const actionColor =
                  s.action === 'BUY'
                    ? 'var(--accent-green)'
                    : 'var(--accent-red)'

                const statusColor =
                  s.status === 'win'
                    ? 'var(--accent-green)'
                    : s.status === 'loss'
                    ? 'var(--accent-red)'
                    : 'var(--accent-yellow)'

                return (
                  <tr
                    key={s.id}
                    style={{ borderBottom: '1px solid var(--bg-border)' }}
                  >
                    <td
                      style={{
                        padding: '8px 12px 8px 0',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {fmt(s.timestamp)}
                    </td>
                    <td style={{ paddingRight: 12 }}>{s.session}</td>
                    <td style={{ paddingRight: 12 }}>{s.timeframe}</td>
                    <td
                      style={{
                        paddingRight: 12,
                        color: actionColor,
                        fontWeight: 700,
                      }}
                    >
                      {s.action}
                    </td>
                    <td style={{ paddingRight: 12 }}>{s.confidence}/5</td>
                    <td style={{ paddingRight: 12 }}>
                      ${s.entryPrice.toFixed(2)}
                    </td>
                    <td style={{ paddingRight: 12 }}>
                      ${s.stopLoss.toFixed(2)}
                    </td>
                    <td style={{ paddingRight: 12 }}>
                      ${s.takeProfit.toFixed(2)}
                    </td>
                    <td style={{ paddingRight: 12 }}>{s.rr}</td>
                    <td
                      style={{
                        paddingRight: 12,
                        color: statusColor,
                        fontWeight: 700,
                      }}
                    >
                      {s.status.toUpperCase()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
