'use client'

import Script from 'next/script'

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
        Macro News Feed
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <a
          className="twitter-timeline"
          data-theme="dark"
          data-height="100%"
          href="https://twitter.com/FinancialJuice"
        >
          Tweets by FinancialJuice
        </a>

        <Script
          src="https://platform.twitter.com/widgets.js"
          strategy="afterInteractive"
        />
      </div>
    </div>
  )
}
