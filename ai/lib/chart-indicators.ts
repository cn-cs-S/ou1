import type { CandleData } from '@/lib/mock-data'

export interface MacdSnapshot {
  dif: number
  dea: number
  hist: number
  previousHist: number
  cross: 'golden' | 'death' | 'none'
  bias: 'bullish' | 'bearish' | 'neutral'
}

export interface BollSnapshot {
  upper: number
  middle: number
  lower: number
  widthPct: number
}

export function latestMacd(candles: CandleData[], fast = 12, slow = 26, signal = 9): MacdSnapshot | null {
  const closes = candles.map((item) => Number(item.close)).filter(Number.isFinite)
  if (closes.length < slow + signal) return null
  const fastEma = emaSeries(closes, fast)
  const slowEma = emaSeries(closes, slow)
  const dif = closes.map((_, index) => fastEma[index] - slowEma[index])
  const dea = emaSeries(dif, signal)
  const lastDif = dif.at(-1) || 0
  const lastDea = dea.at(-1) || 0
  const prevDif = dif.at(-2) || 0
  const prevDea = dea.at(-2) || 0
  const hist = (lastDif - lastDea) * 2
  const previousHist = (prevDif - prevDea) * 2
  const cross = previousHist <= 0 && hist > 0 ? 'golden' : previousHist >= 0 && hist < 0 ? 'death' : 'none'
  return {
    dif: round(lastDif, 4),
    dea: round(lastDea, 4),
    hist: round(hist, 4),
    previousHist: round(previousHist, 4),
    cross,
    bias: Math.abs(hist) < 0.000001 ? 'neutral' : hist > 0 ? 'bullish' : 'bearish',
  }
}

export function latestBoll(candles: CandleData[], period = 20, multiplier = 2): BollSnapshot | null {
  const closes = candles.map((item) => Number(item.close)).filter(Number.isFinite)
  if (closes.length < period) return null
  const sample = closes.slice(-period)
  const middle = sample.reduce((sum, value) => sum + value, 0) / sample.length
  const deviation = Math.sqrt(sample.reduce((sum, value) => sum + (value - middle) ** 2, 0) / sample.length)
  const upper = middle + deviation * multiplier
  const lower = middle - deviation * multiplier
  return {
    upper: round(upper, priceDecimals(upper)),
    middle: round(middle, priceDecimals(middle)),
    lower: round(lower, priceDecimals(lower)),
    widthPct: middle > 0 ? round((upper - lower) / middle * 100, 2) : 0,
  }
}

function emaSeries(values: number[], period: number) {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const output = [values[0]]
  for (let index = 1; index < values.length; index += 1) {
    output.push(values[index] * k + output[index - 1] * (1 - k))
  }
  return output
}

function priceDecimals(value: number) {
  if (Math.abs(value) >= 100) return 2
  if (Math.abs(value) >= 1) return 4
  return 8
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}
