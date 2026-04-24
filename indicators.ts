import type { KlineBar, VWAPBar, CVDBar } from './useMarketStore'

type AggTrade = {
  time: number   // MILLISECONDES (depuis binance.ts)
  price: number
  quantity: number
  isBuyerMaker: boolean
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

export function calculateCVD(trades: AggTrade[], klines: KlineBar[]): CVDBar[] {
  if (!klines.length) return []

  let runningCvd = 0

  return klines.map((kline, index) => {
    // kline.time est en SECONDES → convertir en ms pour matcher les trades
    const startMs = kline.time * 1000
    const endMs = index < klines.length - 1
      ? klines[index + 1].time * 1000
      : Infinity

    const delta = trades
      .filter((trade) => trade.time >= startMs && trade.time < endMs)
      .reduce((sum, trade) => {
        const signedQty = trade.isBuyerMaker ? -trade.quantity : trade.quantity
        return sum + signedQty
      }, 0)

    runningCvd += delta

    return {
      time: kline.time,
      delta,
      cvd: runningCvd,
    }
  })
}
