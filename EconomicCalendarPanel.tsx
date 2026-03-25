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
          Live
        </div>
      </div>

      <div
        className="tradingview-widget-container"
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#13151c',
        }}
      >
        <div
          className="tradingview-widget-container__widget"
          style={{ height: '100%', width: '100%' }}
        />

        <Script
          id="te-calendar-widget"
          src="https://s3.tradingeconomics.com/te_widget.js"
          strategy="afterInteractive"
        />

        <Script id="te-calendar-widget-init" strategy="afterInteractive">
          {`
            (function () {
              function mountWidget() {
                if (typeof window === 'undefined') return;
                if (typeof window.te_economic_calendar !== 'function') return;

                const target = document.querySelector('.tradingview-widget-container__widget');
                if (!target) return;

                target.innerHTML = '';

                window.te_economic_calendar({
                  container: target,
                  width: "100%",
                  height: "100%",
                  importance: "2,3",
                  countries: "all",
                  theme: "dark",
                  language: "en"
                });
              }

              let tries = 0;
              const timer = setInterval(function () {
                tries += 1;
                if (typeof window !== 'undefined' && typeof window.te_economic_calendar === 'function') {
                  clearInterval(timer);
                  mountWidget();
                }
                if (tries > 40) {
                  clearInterval(timer);
                }
              }, 250);
            })();
          `}
        </Script>
      </div>
    </div>
  )
}
