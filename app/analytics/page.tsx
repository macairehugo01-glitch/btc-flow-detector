'use client'

import AnalyticsPanel from '../../AnalyticsPanel'

export default function AnalyticsPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        padding: 16,
      }}
    >
      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            fontFamily: 'monospace',
          }}
        >
          Analytics
        </div>

        <AnalyticsPanel />
      </div>
    </main>
  )
}
