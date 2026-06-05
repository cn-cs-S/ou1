const FRAME_WEIGHTS = {
  "15m": 0.18,
  "1H": 0.24,
  "4H": 0.32,
  "1D": 0.26
};

const SHORT_FRAMES = new Set(["15m", "1H"]);
const LONG_FRAMES = new Set(["4H", "1D"]);

export function buildTrendAlignment(frames = {}) {
  const frameRows = Object.entries(FRAME_WEIGHTS)
    .map(([frame, weight]) => analyzeFrame(frame, frames[frame] || [], weight))
    .filter(Boolean);

  if (!frameRows.length) {
    return emptyTrendAlignment("K 线数据不足，无法进行多周期趋势一致性判断。");
  }

  const totalWeight = sum(frameRows.map((item) => item.weight));
  const totalScore = weightedAverage(frameRows, "score", totalWeight);
  const shortRows = frameRows.filter((item) => SHORT_FRAMES.has(item.frame));
  const longRows = frameRows.filter((item) => LONG_FRAMES.has(item.frame));
  const shortScore = weightedAverage(shortRows, "score");
  const longScore = weightedAverage(longRows, "score");
  const direction = classifyDirection(totalScore);
  const longDirection = classifyDirection(longScore);
  const shortDirection = classifyDirection(shortScore);
  const alignedWeight = frameRows
    .filter((item) => direction !== "neutral" && item.direction === direction)
    .reduce((acc, item) => acc + item.weight, 0);
  const conflictWeight = frameRows
    .filter((item) => direction !== "neutral" && item.direction !== "neutral" && item.direction !== direction)
    .reduce((acc, item) => acc + item.weight, 0);
  const consistency = direction === "neutral"
    ? clamp(45 - Math.abs(totalScore) * 0.35, 10, 55)
    : clamp(alignedWeight / Math.max(totalWeight, 0.0001) * 100 - conflictWeight * 35, 0, 100);
  const confidence = clamp(Math.abs(totalScore) * 0.58 + consistency * 0.42, 0, 100);
  const longShortConflict = longDirection !== "neutral" && shortDirection !== "neutral" && longDirection !== shortDirection;

  return {
    generatedAt: new Date().toISOString(),
    direction,
    longDirection,
    shortDirection,
    score: round(totalScore, 2),
    shortScore: round(shortScore, 2),
    longScore: round(longScore, 2),
    consistency: Math.round(consistency),
    confidence: Math.round(confidence),
    state: trendState({ direction, confidence, consistency, longShortConflict }),
    longShortConflict,
    frames: frameRows,
    sides: {
      long: sideView("long", { direction, longDirection, shortDirection, totalScore, shortScore, longScore, consistency, confidence, longShortConflict }),
      short: sideView("short", { direction, longDirection, shortDirection, totalScore, shortScore, longScore, consistency, confidence, longShortConflict })
    },
    summary: buildSummary({ direction, longDirection, shortDirection, confidence, consistency, longShortConflict })
  };
}

function emptyTrendAlignment(reason) {
  return {
    generatedAt: new Date().toISOString(),
    direction: "neutral",
    longDirection: "neutral",
    shortDirection: "neutral",
    score: 0,
    shortScore: 0,
    longScore: 0,
    consistency: 0,
    confidence: 0,
    state: "insufficient",
    longShortConflict: false,
    frames: [],
    sides: {
      long: { side: "long", confidence: 0, consistency: 0, aligned: false, blocked: false, reason },
      short: { side: "short", confidence: 0, consistency: 0, aligned: false, blocked: false, reason }
    },
    summary: reason
  };
}

function analyzeFrame(frame, candles, weight) {
  const closes = (Array.isArray(candles) ? candles : [])
    .map((item) => Number(item.close))
    .filter((value) => Number.isFinite(value) && value > 0);
  const volumes = (Array.isArray(candles) ? candles : [])
    .map((item) => Number(item.volQuote || item.vol || 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (closes.length < 35) return null;

  const ema21Series = emaSeries(closes, 21);
  const ema55Series = emaSeries(closes, 55);
  const ema21 = ema21Series.at(-1) || 0;
  const ema55 = ema55Series.at(-1) || 0;
  const macd = macdSnapshot(closes);
  const rsi = rsi14(closes);
  const current = closes.at(-1);
  const momentumFast = momentum(closes, frame === "15m" ? 12 : 8);
  const momentumSlow = momentum(closes, frame === "1D" ? 20 : 24);
  const emaSpread = ema55 > 0 ? ema21 / ema55 - 1 : 0;
  const emaSlope = slopePct(ema21Series, frame === "15m" ? 10 : 8);
  const macdPct = current > 0 ? macd.hist / current : 0;
  const rsiBias = (rsi - 50) / 50;
  const volumeImpulse = relativeVolume(volumes);
  const rawScore =
    emaSpread * 950 +
    emaSlope * 680 +
    macdPct * 1200 +
    momentumFast * 260 +
    momentumSlow * 180 +
    rsiBias * 24 +
    Math.sign(momentumFast || emaSpread) * Math.min(Math.max(volumeImpulse - 1, 0), 2) * 5;
  const score = clamp(rawScore, -100, 100);
  const direction = classifyDirection(score);

  return {
    frame,
    weight,
    direction,
    score: round(score, 2),
    emaSpread: round(emaSpread * 100, 3),
    emaSlope: round(emaSlope * 100, 3),
    macdHistPct: round(macdPct * 100, 4),
    momentumFast: round(momentumFast * 100, 3),
    momentumSlow: round(momentumSlow * 100, 3),
    rsi: round(rsi, 2),
    relativeVolume: round(volumeImpulse, 2),
    reason: frameReason({ direction, score, emaSpread, macdPct, rsi, momentumFast, momentumSlow })
  };
}

function sideView(side, input) {
  const sideSign = side === "long" ? 1 : -1;
  const total = input.totalScore * sideSign;
  const shortTerm = input.shortScore * sideSign;
  const longTerm = input.longScore * sideSign;
  const longBlocked = longTerm < -18 && Math.abs(input.longScore) >= 22;
  const shortBlocked = shortTerm < -35 && Math.abs(input.shortScore) >= 42;
  const conflictPenalty = input.longShortConflict ? 18 : 0;
  const confidence = clamp(total * 0.38 + longTerm * 0.32 + shortTerm * 0.22 + input.consistency * 0.42 - conflictPenalty, 0, 100);
  const aligned = confidence >= 62 && longTerm > 8 && shortTerm > -12;
  const blocked = longBlocked || shortBlocked || confidence < 34;
  const reason = blocked
    ? `多周期趋势未支持${side === "long" ? "做多" : "做空"}：长线 ${round(longTerm, 1)}，短线 ${round(shortTerm, 1)}，一致性 ${Math.round(input.consistency)}%。`
    : aligned
      ? `长短周期基本同向：长线 ${round(longTerm, 1)}，短线 ${round(shortTerm, 1)}，一致性 ${Math.round(input.consistency)}%。`
      : `趋势仍需确认：长线 ${round(longTerm, 1)}，短线 ${round(shortTerm, 1)}，一致性 ${Math.round(input.consistency)}%。`;

  return {
    side,
    confidence: Math.round(confidence),
    consistency: Math.round(input.consistency),
    longScore: round(longTerm, 2),
    shortScore: round(shortTerm, 2),
    aligned,
    blocked,
    longBlocked,
    shortBlocked,
    reason
  };
}

function classifyDirection(score) {
  if (score >= 18) return "long";
  if (score <= -18) return "short";
  return "neutral";
}

function trendState({ direction, confidence, consistency, longShortConflict }) {
  if (direction === "neutral") return "range";
  if (longShortConflict) return "mixed";
  if (confidence >= 68 && consistency >= 62) return "aligned";
  if (confidence >= 48) return "developing";
  return "weak";
}

function buildSummary({ direction, longDirection, shortDirection, confidence, consistency, longShortConflict }) {
  const dirLabel = direction === "long" ? "偏多" : direction === "short" ? "偏空" : "震荡";
  const longLabel = longDirection === "long" ? "长线偏多" : longDirection === "short" ? "长线偏空" : "长线中性";
  const shortLabel = shortDirection === "long" ? "短线偏多" : shortDirection === "short" ? "短线偏空" : "短线中性";
  const conflict = longShortConflict ? "，长短周期存在冲突" : "";
  return `${dirLabel}，${longLabel} / ${shortLabel}${conflict}，一致性 ${Math.round(consistency)}%，置信度 ${Math.round(confidence)}%。`;
}

function frameReason({ direction, score, emaSpread, macdPct, rsi, momentumFast, momentumSlow }) {
  const dir = direction === "long" ? "偏多" : direction === "short" ? "偏空" : "中性";
  return `${dir}(${round(score, 1)})；EMA差 ${round(emaSpread * 100, 2)}%，MACD ${round(macdPct * 100, 4)}%，RSI ${round(rsi, 1)}，快/慢动量 ${round(momentumFast * 100, 2)}%/${round(momentumSlow * 100, 2)}%。`;
}

function macdSnapshot(values) {
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const macd = fast.map((value, index) => value - slow[index]);
  const signal = emaSeries(macd, 9);
  return {
    macd: macd.at(-1) || 0,
    signal: signal.at(-1) || 0,
    hist: (macd.at(-1) || 0) - (signal.at(-1) || 0)
  };
}

function rsi14(values) {
  if (values.length < 15) return 50;
  let gains = 0;
  let losses = 0;
  const slice = values.slice(-15);
  for (let i = 1; i < slice.length; i += 1) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / Math.max(losses, 0.00000001);
  return 100 - 100 / (1 + rs);
}

function emaSeries(values, period) {
  const alpha = 2 / (period + 1);
  const out = [];
  let prev = values[0] || 0;
  for (const value of values) {
    prev = prev + alpha * (value - prev);
    out.push(prev);
  }
  return out;
}

function slopePct(values, lookback = 8) {
  if (!Array.isArray(values) || values.length <= lookback) return 0;
  const current = values.at(-1);
  const previous = values.at(-(lookback + 1));
  return previous > 0 ? current / previous - 1 : 0;
}

function momentum(values, periods) {
  if (values.length <= periods) return 0;
  const current = values.at(-1);
  const previous = values.at(-(periods + 1));
  return previous > 0 ? current / previous - 1 : 0;
}

function relativeVolume(values) {
  if (values.length < 20) return 1;
  const recent = mean(values.slice(-5));
  const base = mean(values.slice(-35, -5));
  return base > 0 ? recent / base : 1;
}

function weightedAverage(rows, key, totalWeight = null) {
  if (!rows.length) return 0;
  const weight = totalWeight || sum(rows.map((item) => item.weight));
  return rows.reduce((acc, item) => acc + Number(item[key] || 0) * item.weight, 0) / Math.max(weight, 0.000001);
}

function sum(values) {
  return values.reduce((acc, item) => acc + Number(item || 0), 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
