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
        overflow: 'hidden',
      }}
    >
      {/* Header */}
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
        Macro News (Live)
      </div>

      {/* Feed X */}
      <iframe
        src="https://twitframe.com/show?url=https://twitter.com/FinancialJuice"
        style={{
          width: '100%',
          flex: 1,
          border: 'none',
          borderRadius: 8,
          background: '#13151c',
        }}
        title="Macro News Feed"
      />
    </div>
  )
}
