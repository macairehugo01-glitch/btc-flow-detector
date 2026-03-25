'use client'

export default function EconomicCalendarPanel() {
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
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: 8,
        }}
      >
        News (2★ / 3★)
      </div>

      <iframe
        src="https://www.investing.com/economic-calendar/"
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
          borderRadius: 8,
          background: '#13151c',
        }}
        title="Economic Calendar"
      />
    </div>
  )
}
