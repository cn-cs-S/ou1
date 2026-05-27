export function buildIndicatorPack(candles, ticker = {}) {
  const clean = candles.filter((item) => Number.isFinite(item.close) && item.close > 0);
  const closes = clean.map((item) => item.close);
  const highs = clean.map((item) => item.high);
  const lows = clean.map((item) => item.low);
  const volumes = clean.map((item) => item.volQuote || item.vol || 0);

  const ma7 = smaSeries(closes, 7);
  const ma25 = smaSeries(closes, 25);
  const ma99 = smaSeries(closes, 99);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const bb = bollinger(closes, 20, 2);
  const macd = macdSeries(closes);

  const oscillators = [
    indicatorRow("RSI(14)", rsi(closes, 14), classifyRsi(rsi(closes, 14))),
    indicatorRow("Stochastic %K (14, 3, 3)", stochasticK(highs, lows, closes, 14), classifyCentered(stochasticK(highs, lows, closes, 14), 20, 80, true)),
    indicatorRow("CCI(20)", cci(highs, lows, closes, 20), classifyCentered(cci(highs, lows, closes, 20), -100, 100)),
    indicatorRow("ADX(14)", adx(highs, lows, closes, 14), classifyAdx(adx(highs, lows, closes, 14))),
    indicatorRow("AO", awesomeOscillator(highs, lows), classifyZero(awesomeOscillator(highs, lows))),
    indicatorRow("Momentum(10)", momentum(closes, 10), classifyZero(momentum(closes, 10))),
    indicatorRow("MACD Level (12, 26)", last(macd.macd), classifyZero(last(macd.histogram))),
    indicatorRow("Williams %R(14)", williamsR(highs, lows, closes, 14), classifyWilliams(williamsR(highs, lows, closes, 14))),
    indicatorRow("Bollinger %B(20)", bollingerPercentB(closes, bb), classifyCentered(bollingerPercentB(closes, bb), 0.2, 0.8, true))
  ];

  const movingAverages = [
    maRow("SMA(7)", last(ma7), Number(ticker.last || last(closes))),
    maRow("SMA(25)", last(ma25), Number(ticker.last || last(closes))),
    maRow("SMA(99)", last(ma99), Number(ticker.last || last(closes))),
    maRow("EMA(12)", last(ema12), Number(ticker.last || last(closes))),
    maRow("EMA(26)", last(ema26), Number(ticker.last || last(closes))),
    maRow("Bollinger Upper(20)", last(bb.upper), Number(ticker.last || last(closes)), true),
    maRow("Bollinger Basis(20)", last(bb.middle), Number(ticker.last || last(closes))),
    maRow("Bollinger Lower(20)", last(bb.lower), Number(ticker.last || last(closes)), true)
  ];

  return {
    overlays: {
      ma7,
      ma25,
      ma99,
      bbUpper: bb.upper,
      bbMiddle: bb.middle,
      bbLower: bb.lower,
      ema12,
      ema26
    },
    macd,
    volumeMa: smaSeries(volumes, 20),
    indicators: {
      oscillators,
      movingAverages,
      summary: summarizeSignals([...oscillators, ...movingAverages])
    }
  };
}

function indicatorRow(name, value, action) {
  return {
    name,
    value: round(value, Math.abs(value) >= 1000 ? 1 : 2),
    action
  };
}

function maRow(name, value, price, band = false) {
  if (!Number.isFinite(value) || !Number.isFinite(price)) return indicatorRow(name, value, "中立");
  const diff = price / value - 1;
  if (band && /Upper/.test(name)) return indicatorRow(name, value, price > value ? "卖出" : "中立");
  if (band && /Lower/.test(name)) return indicatorRow(name, value, price < value ? "买入" : "中立");
  return indicatorRow(name, value, diff > 0.0015 ? "买入" : diff < -0.0015 ? "卖出" : "中立");
}

function summarizeSignals(rows) {
  const buy = rows.filter((item) => item.action === "买入").length;
  const sell = rows.filter((item) => item.action === "卖出").length;
  const neutral = rows.length - buy - sell;
  let action = "中立";
  if (buy - sell >= 4) action = "买入";
  if (sell - buy >= 4) action = "卖出";
  if (buy - sell >= 7) action = "强烈买入";
  if (sell - buy >= 7) action = "强烈卖出";
  return { buy, sell, neutral, action, score: clamp(Math.round(((buy - sell) / Math.max(rows.length, 1)) * 50 + 50), 0, 100) };
}

function classifyRsi(value) {
  if (!Number.isFinite(value)) return "中立";
  if (value < 30) return "买入";
  if (value > 70) return "卖出";
  return "中立";
}

function classifyCentered(value, low, high, reverse = false) {
  if (!Number.isFinite(value)) return "中立";
  if (reverse) {
    if (value < low) return "买入";
    if (value > high) return "卖出";
    return "中立";
  }
  if (value > high) return "买入";
  if (value < low) return "卖出";
  return "中立";
}

function classifyZero(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return "中立";
  return value > 0 ? "买入" : "卖出";
}

function classifyAdx(value) {
  if (!Number.isFinite(value)) return "中立";
  return value >= 25 ? "趋势" : "中立";
}

function classifyWilliams(value) {
  if (!Number.isFinite(value)) return "中立";
  if (value < -80) return "买入";
  if (value > -20) return "卖出";
  return "中立";
}

function smaSeries(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    return mean(values.slice(index + 1 - period, index + 1));
  });
}

function emaSeries(values, period) {
  const result = [];
  const k = 2 / (period + 1);
  let current = null;
  values.forEach((value, index) => {
    current = current === null ? value : value * k + current * (1 - k);
    result.push(index + 1 < period ? null : current);
  });
  return result;
}

function bollinger(values, period, multiplier) {
  const middle = smaSeries(values, period);
  const upper = [];
  const lower = [];
  values.forEach((_, index) => {
    if (index + 1 < period) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const window = values.slice(index + 1 - period, index + 1);
    const sd = stddev(window);
    upper.push(middle[index] + sd * multiplier);
    lower.push(middle[index] - sd * multiplier);
  });
  return { upper, middle, lower };
}

function macdSeries(values) {
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  const macd = values.map((_, index) => {
    if (ema12[index] === null || ema26[index] === null) return null;
    return ema12[index] - ema26[index];
  });
  const signal = emaSeries(macd.map((item) => item ?? 0), 9).map((item, index) => (macd[index] === null ? null : item));
  const histogram = macd.map((item, index) => (item === null || signal[index] === null ? null : item - signal[index]));
  return { macd, signal, histogram };
}

function rsi(values, period) {
  if (values.length <= period) return NaN;
  const changes = [];
  for (let i = 1; i < values.length; i += 1) changes.push(values[i] - values[i - 1]);
  const recent = changes.slice(-period);
  const gains = recent.filter((item) => item > 0);
  const losses = recent.filter((item) => item < 0).map(Math.abs);
  const avgGain = mean(gains);
  const avgLoss = mean(losses);
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function stochasticK(highs, lows, closes, period) {
  if (closes.length < period) return NaN;
  const high = Math.max(...highs.slice(-period));
  const low = Math.min(...lows.slice(-period));
  return high === low ? 50 : ((last(closes) - low) / (high - low)) * 100;
}

function cci(highs, lows, closes, period) {
  if (closes.length < period) return NaN;
  const typical = closes.map((close, index) => (highs[index] + lows[index] + close) / 3);
  const window = typical.slice(-period);
  const avg = mean(window);
  const meanDeviation = mean(window.map((item) => Math.abs(item - avg)));
  return meanDeviation === 0 ? 0 : (last(typical) - avg) / (0.015 * meanDeviation);
}

function adx(highs, lows, closes, period) {
  if (closes.length <= period + 1) return NaN;
  const trs = [];
  const plusDm = [];
  const minusDm = [];
  for (let i = 1; i < closes.length; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const atr = mean(trs.slice(-period));
  if (!atr) return 0;
  const plus = 100 * mean(plusDm.slice(-period)) / atr;
  const minus = 100 * mean(minusDm.slice(-period)) / atr;
  return plus + minus === 0 ? 0 : 100 * Math.abs(plus - minus) / (plus + minus);
}

function awesomeOscillator(highs, lows) {
  const median = highs.map((high, index) => (high + lows[index]) / 2);
  const fast = last(smaSeries(median, 5));
  const slow = last(smaSeries(median, 34));
  return Number.isFinite(fast) && Number.isFinite(slow) ? fast - slow : NaN;
}

function momentum(values, period) {
  if (values.length <= period) return NaN;
  return last(values) - values[values.length - 1 - period];
}

function williamsR(highs, lows, closes, period) {
  if (closes.length < period) return NaN;
  const high = Math.max(...highs.slice(-period));
  const low = Math.min(...lows.slice(-period));
  return high === low ? -50 : ((high - last(closes)) / (high - low)) * -100;
}

function bollingerPercentB(closes, bb) {
  const upper = last(bb.upper);
  const lower = last(bb.lower);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper === lower) return NaN;
  return (last(closes) - lower) / (upper - lower);
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, item) => sum + item, 0) / clean.length : 0;
}

function stddev(values) {
  const avg = mean(values);
  return Math.sqrt(mean(values.map((item) => (item - avg) ** 2)));
}

function last(values) {
  return values[values.length - 1];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
