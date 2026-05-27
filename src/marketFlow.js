const TRACK_LIMIT = 10;
const observationHistory = new Map();

export function buildMarketFlowReference({
  instId,
  orderBook = {},
  trades = [],
  candles = [],
  openInterest = {},
  fundingRate = {},
  contractValue = 1
}) {
  const book = analyzeOrderBook(orderBook);
  const flow = analyzeTrades(trades, contractValue);
  const relativeVolume = calculateRelativeVolume(candles);
  const observation = recordOpenInterest(instId, openInterest);
  const funding = Number(fundingRate.fundingRate || 0);
  let score = 50;

  if (book.imbalance >= 1.2) score += 12;
  else if (book.imbalance > 0 && book.imbalance <= 0.8) score -= 12;

  if (flow.deltaRatio >= 0.15) score += 16;
  else if (flow.deltaRatio <= -0.15) score -= 16;

  if (relativeVolume >= 1.5 && score > 50) score += 7;
  else if (relativeVolume >= 1.5 && score < 50) score -= 7;

  if (observation.anomaly === "rising" && score > 50) score += 8;
  else if (observation.anomaly === "rising" && score < 50) score -= 8;

  if (funding > 0.0005 && score > 50) score -= 4;
  else if (funding < -0.0005 && score < 50) score += 4;

  score = clamp(Math.round(score), 0, 100);
  const direction = score >= 62 ? "long" : score <= 38 ? "short" : "neutral";
  const label = direction === "long" ? "偏多资金压力" : direction === "short" ? "偏空资金压力" : "资金压力均衡";
  const confidence = Math.round(Math.abs(score - 50) * 2);
  const oiText = observation.samples >= 2
    ? `OI ${signedPercent(observation.changePct)}`
    : "OI 采样中";
  const summary = `${label} | 盘口 ${book.imbalance > 0 ? book.imbalance.toFixed(2) : "--"}x | Delta ${signedPercent(flow.deltaRatio * 100)} | 量比 ${relativeVolume > 0 ? relativeVolume.toFixed(2) : "--"}x | ${oiText}`;
  const interpretation = interpretFlow({
    score,
    direction,
    book,
    flow,
    relativeVolume,
    observation
  });

  return {
    score,
    direction,
    label,
    confidence,
    strongConflictThreshold: 68,
    bookImbalance: round(book.imbalance, 3),
    bidNotional: round(book.bidNotional, 2),
    askNotional: round(book.askNotional, 2),
    deltaNotional: round(flow.deltaNotional, 2),
    deltaRatio: round(flow.deltaRatio, 4),
    tradeCount: flow.tradeCount,
    relativeVolume: round(relativeVolume, 3),
    openInterestChangePct: round(observation.changePct, 3),
    openInterestSamples: observation.samples,
    openInterestAnomaly: observation.anomaly,
    ...interpretation,
    summary,
    caveat: "公开盘口和成交只能反映可见资金压力，挂单可撤销，不能确认主力真实意图。"
  };
}

function interpretFlow({ score, direction, book, flow, relativeVolume, observation }) {
  const aggressiveBuy = flow.deltaRatio >= 0.45;
  const aggressiveSell = flow.deltaRatio <= -0.45;
  const bidSupport = book.imbalance >= 1.2;
  const askPressure = book.imbalance > 0 && book.imbalance <= 0.8;
  const elevatedVolume = relativeVolume >= 1.5;
  const burstVolume = relativeVolume >= 2;
  const oiExpansion = observation.anomaly === "rising";

  if (aggressiveBuy && bidSupport && elevatedVolume && (oiExpansion || score >= 78)) {
    return createInsight({
      judgment: "疑似吸筹布局",
      bias: "long",
      level: "high",
      score,
      confirmations: [aggressiveBuy, bidSupport, elevatedVolume, oiExpansion],
      verdict: "主动买盘、买方盘口与成交放量同向增强，呈现吸筹式结构。",
      reasons: ["主动买入显著占优", "买方挂单承接偏厚", "成交量较近期均值放大", oiExpansion ? "持仓量连续扩张" : "资金压力达到极值"]
    });
  }

  if (aggressiveSell && askPressure && elevatedVolume && (oiExpansion || score <= 22)) {
    return createInsight({
      judgment: "疑似派发布局",
      bias: "short",
      level: "high",
      score,
      confirmations: [aggressiveSell, askPressure, elevatedVolume, oiExpansion],
      verdict: "主动卖盘、卖方盘口与成交放量同向增强，呈现派发式结构。",
      reasons: ["主动卖出显著占优", "卖方挂单压制偏厚", "成交量较近期均值放大", oiExpansion ? "持仓量连续扩张" : "资金压力达到极值"]
    });
  }

  if (flow.deltaRatio >= 0.9 && burstVolume) {
    return createInsight({
      judgment: "主动买盘冲击",
      bias: "long",
      level: "medium",
      score,
      confirmations: [true, burstVolume, bidSupport, oiExpansion],
      verdict: "放量主动买入集中出现，偏向短线买方冲击，尚不足以确认布局。",
      reasons: ["主动买入高度集中", "成交量明显放大", bidSupport ? "盘口提供买方承接" : "盘口未同步确认"]
    });
  }

  if (flow.deltaRatio <= -0.9 && burstVolume) {
    return createInsight({
      judgment: "主动卖盘冲击",
      bias: "short",
      level: "medium",
      score,
      confirmations: [true, burstVolume, askPressure, oiExpansion],
      verdict: "放量主动卖出集中出现，偏向短线卖方冲击，尚不足以确认布局。",
      reasons: ["主动卖出高度集中", "成交量明显放大", askPressure ? "盘口提供卖方压制" : "盘口未同步确认"]
    });
  }

  if (oiExpansion) {
    return createInsight({
      judgment: "持仓量异常放大",
      bias: direction,
      level: "high",
      score,
      confirmations: [oiExpansion, elevatedVolume, aggressiveBuy || aggressiveSell],
      verdict: "持仓量连续扩大，可能有新增资金建仓，方向仍需结合主动成交确认。",
      reasons: ["OI 在监测窗口持续上升", elevatedVolume ? "成交同步放量" : "成交尚未明显放量", direction === "neutral" ? "方向证据不足" : `当前压力${direction === "long" ? "偏多" : "偏空"}`]
    });
  }

  const quietBias = direction === "long" ? "偏多" : direction === "short" ? "偏空" : "均衡";
  return {
    aiJudgment: "暂无明显主力布局",
    aiBias: direction,
    aiLevel: "low",
    aiConfidence: clamp(Math.round(72 - Math.abs(score - 50) * 0.5), 38, 72),
    aiVerdict: `可见资金压力${quietBias}，但尚未形成可识别的主力布局组合信号。`,
    aiReasons: ["需等待盘口、主动成交、放量或持仓量出现更多同向确认"]
  };
}

function createInsight({ judgment, bias, level, score, confirmations, verdict, reasons }) {
  const confirmed = confirmations.filter(Boolean).length;
  return {
    aiJudgment: judgment,
    aiBias: bias,
    aiLevel: level,
    aiConfidence: clamp(Math.round(48 + confirmed * 9 + Math.abs(score - 50) * 0.35), 45, 92),
    aiVerdict: verdict,
    aiReasons: reasons
  };
}

function analyzeOrderBook(orderBook) {
  const bids = Array.isArray(orderBook?.bids) ? orderBook.bids : [];
  const asks = Array.isArray(orderBook?.asks) ? orderBook.asks : [];
  const bidNotional = sumLevels(bids);
  const askNotional = sumLevels(asks);
  return {
    bidNotional,
    askNotional,
    imbalance: askNotional > 0 ? bidNotional / askNotional : 0
  };
}

function analyzeTrades(trades, contractValue) {
  let buyNotional = 0;
  let sellNotional = 0;
  let tradeCount = 0;
  for (const item of Array.isArray(trades) ? trades : []) {
    const px = Number(item?.px || 0);
    const size = Number(item?.sz || 0);
    if (px <= 0 || size <= 0) continue;
    const notional = px * size * Math.max(Number(contractValue || 1), 0.00000001);
    if (String(item.side).toLowerCase() === "buy") buyNotional += notional;
    else sellNotional += notional;
    tradeCount += 1;
  }
  const total = buyNotional + sellNotional;
  return {
    tradeCount,
    deltaNotional: buyNotional - sellNotional,
    deltaRatio: total > 0 ? (buyNotional - sellNotional) / total : 0
  };
}

function calculateRelativeVolume(candles) {
  const confirmed = (Array.isArray(candles) ? candles : []).filter((item) => Number(item.volQuote || item.vol || 0) > 0);
  if (confirmed.length < 3) return 0;
  const current = Number(confirmed.at(-1).volQuote || confirmed.at(-1).vol || 0);
  const comparison = confirmed.slice(-21, -1).map((item) => Number(item.volQuote || item.vol || 0));
  const average = comparison.reduce((sum, item) => sum + item, 0) / comparison.length;
  return average > 0 ? current / average : 0;
}

function recordOpenInterest(instId, openInterest) {
  const value = Number(openInterest.oiUsd || openInterest.oiCcy || openInterest.oi || 0);
  if (!instId || value <= 0) return { samples: 0, changePct: 0, anomaly: "none" };
  const records = observationHistory.get(instId) || [];
  const last = records.at(-1);
  if (!last || Date.now() - last.ts >= 4_000) {
    records.push({ ts: Date.now(), value });
    if (records.length > TRACK_LIMIT) records.shift();
    observationHistory.set(instId, records);
  }
  const firstValue = records[0]?.value || value;
  const lastValue = records.at(-1)?.value || value;
  const changePct = firstValue > 0 ? (lastValue / firstValue - 1) * 100 : 0;
  let riseCount = 0;
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].value > records[index - 1].value) riseCount += 1;
  }
  const anomaly = records.length >= TRACK_LIMIT && riseCount >= 6 && changePct > 2 ? "rising" : "none";
  return { samples: records.length, changePct, anomaly };
}

function sumLevels(levels) {
  return levels.reduce((sum, level) => sum + Number(level?.[0] || 0) * Number(level?.[1] || 0), 0);
}

function signedPercent(value) {
  const normalized = Number(value || 0);
  return `${normalized >= 0 ? "+" : ""}${round(normalized, 2).toFixed(2)}%`;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
