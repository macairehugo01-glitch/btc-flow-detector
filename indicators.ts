import type { KlineBar, VWAPBar, CVDBar } from './useMarketStore'

type AggTrade = {
  time: number
  price: number
  quantity: number
  isBuyerMaker: boolean
}

// On étend KlineBar pour inclure takerBuyVolume si présent
type KlineWithTaker = KlineBar & {
  takerBuyVolume?: number
}

export function calculateVWAP(klines: KlineBar[], limit: number): VWAPBar[] {
  const sliced = klines.slice(-limit)
  let cumulativePV = 0
  let cumulativeVolume = 0

  return sliced.map((k) => {
    const typicalPrice = (k.high + k.low + k.close) / 3
    cumulativePV += typicalPrice * k.volume
    cumulativeVolume += k.volume
    return {
      time: k.time,
      vwap: cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : k.close,
    }
  })
}

/**
 * CVD calculé depuis le takerBuyVolume des klines Binance.
 *
 * Pour chaque bougie :
 *   takerBuyVolume = volume acheté agressivement (market buy)
 *   takerSellVolume = volume total - takerBuyVolume
 *   delta = takerBuyVolume - takerSellVolume
 *
 * Si takerBuyVolume n'est pas disponible (ancienne kline ou autre source),
 * on fall back sur la direction de la bougie (close > open = buy).
 */
export function calculateCVD(trades: AggTrade[], klines: KlineWithTaker[]): CVDBar[] {
  if (!klines.length) return []

  let runningCvd = 0

  return klines.map((kline) => {
    let delta = 0

    if (kline.takerBuyVolume !== undefined && kline.volume > 0) {
      // Méthode principale : takerBuyVolume depuis Binance Futures klines
      const takerBuyVol = kline.takerBuyVolume
      const takerSellVol = kline.volume - takerBuyVol
      delta = takerBuyVol - takerSellVol
    } else {
      // Fallback : direction de la bougie
      delta = kline.close >= kline.open ? kline.volume : -kline.volume
    }

    runningCvd += delta

    return {
      time: kline.time,
      delta,
      cvd: runningCvd,
    }
  })
}
