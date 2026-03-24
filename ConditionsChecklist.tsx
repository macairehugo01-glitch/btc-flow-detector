'use client'

import { useMarketStore } from './useMarketStore'

function Row({
  label,
  ok,
}: {
  label: string
  ok: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid var(--bg-border)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontFamily: 'monospace',
          fontWeight: 700,
          color: ok ? 'var(--accent-green)' : 'var(--accent-red)',
        }}
      >
        {ok ? 'OK' : 'NO'}
      </span>
    </div>
  )
}

export default function ConditionsChecklist() {
  const { klines, vwap, cvd, oi, funding, signal } = useMarketStore()

  const lastK = klines.at(-1)
  const prevK = klines.at(-2)

  const lastV = vwap.at(-1)
  const prevV = vwap.at(-2)

  const lastCvd = cvd.at(-1)
  const prevCvd = cvd.at(-2)

  const lastOi = oi.at(-1)
  const prevOi = oi.at(-2)

  const fundingRate = funding?.rate ?? 0
  const action = signal?.action ?? 'STABLE'

  const priceAboveVwap =
    !!lastK && !!lastV && lastK.close > lastV.vwap

  const priceBelowVwap =
    !!lastK && !!lastV && lastK.close < lastV.vwap

  const reclaimVwap =
    !!lastK &&
    !!prevK &&
    !!lastV &&
    !!prevV &&
    prevK.close <= prevV.vwap &&
    lastK.close > lastV.vwap

  const rejectVwap =
    !!lastK &&
    !!prevK &&
    !!lastV &&
    !!prevV &&
    prevK.close >= prevV.vwap &&
    lastK.close < lastV.vwap

  const cvdBull =
    !!lastCvd && !!prevCvd && lastCvd.cvd > prevCvd.cvd && lastCvd.delta > 0

  const cvdBear =
    !!lastCvd && !!prevCvd && lastCvd.cvd < prevCvd.cvd && lastCvd.delta < 0

  const oiRising =
    !!lastOi && !!prevOi && lastOi.openInterest > prevOi.openInterest

  const oiFalling =
    !!lastOi && !!prevOi && lastOi.openInterest < prevOi.openInterest

  const fundingLongOk = fundingRate <= 0.001
  const fundingShortOk = fundingRate >= -0.001

  const longMode = action === 'BUY'
  const shortMode = action === 'SELL'

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: 12,
        }}
      >
        Conditions Checklist
      </div>

      <div
        style={{
          marginBottom: 12,
          fontSize: 13,
          fontWeight: 700,
          color:
            action === 'BUY'
              ? 'var(--accent-green)'
              : action === 'SELL'
              ? 'var(--accent-red)'
              : 'var(--accent-yellow)',
        }}
      >
        Mode actuel : {action}
      </div>

      {longMode && (
        <>
          <Row label="Prix au-dessus de la VWAP" ok={priceAboveVwap} />
          <Row label="Reclaim de la VWAP" ok={reclaimVwap} />
          <Row label="CVD bullish" ok={cvdBull} />
          <Row label="OI en hausse" ok={oiRising} />
          <Row label="Funding acceptable long" ok={fundingLongOk} />
        </>
      )}

      {shortMode && (
        <>
          <Row label="Prix sous la VWAP" ok={priceBelowVwap} />
          <Row label="Rejet / perte de la VWAP" ok={rejectVwap} />
          <Row label="CVD bearish" ok={cvdBear} />
          <Row label="OI en hausse" ok={oiRising} />
          <Row label="Funding acceptable short" ok={fundingShortOk} />
        </>
      )}

      {!longMode && !shortMode && (
        <>
          <Row label="Prix au-dessus de la VWAP" ok={priceAboveVwap} />
          <Row label="Prix sous la VWAP" ok={priceBelowVwap} />
          <Row label="CVD bullish" ok={cvdBull} />
          <Row label="CVD bearish" ok={cvdBear} />
          <Row label="OI en hausse" ok={oiRising} />
          <Row label="OI en baisse" ok={oiFalling} />
        </>
      )}
    </div>
  )
}
