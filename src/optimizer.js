export const DEFAULT_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "OKB-USDT"];

const OBJECTIVES = {
  balanced: {
    label: "均衡",
    returnWeight: 0.34,
    momentumWeight: 0.28,
    volatilityWeight: 0.24,
    drawdownWeight: 0.14,
    cashBase: 0.18
  },
  growth: {
    label: "进攻",
    returnWeight: 0.42,
    momentumWeight: 0.34,
    volatilityWeight: 0.14,
    drawdownWeight: 0.10,
    cashBase: 0.08
  },
  defensive: {
    label: "防守",
    returnWeight: 0.24,
    momentumWeight: 0.18,
    volatilityWeight: 0.36,
    drawdownWeight: 0.22,
    cashBase: 0.32
  }
};

export function sanitizeUniverse(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || DEFAULT_SYMBOLS.join(",")).split(/[,\s]+/);

  const seen = new Set();
  const symbols = [];

  for (const item of raw) {
    let symbol = String(item || "").trim().toUpperCase();
    if (!symbol) continue;
    if (!symbol.includes("-") && /^[A-Z0-9]+$/.test(symbol)) {
      symbol = `${symbol}-USDT`;
    }
    if (!/^[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)?$/.test(symbol)) continue;
    if (!seen.has(symbol)) {
      seen.add(symbol);
      symbols.push(symbol);
    }
  }

  return symbols.slice(0, 16);
}

export function buildInvestmentPlan(marketData, settings = {}) {
  const objectiveKey = OBJECTIVES[settings.objective] ? settings.objective : "balanced";
  const objective = OBJECTIVES[objectiveKey];
  const riskLevel = clamp(Number(settings.riskLevel || 5), 1, 10);
  const riskAppetite = riskLevel / 10;
  const suppliedBudget = Number(settings.budgetUsdt);
  const budgetUsdt = clamp(Number.isFinite(suppliedBudget) ? suppliedBudget : 1000, 0, 10_000_000);
  const maxAssetWeight = clamp(Number(settings.maxAssetWeight || 35) / 100, 0.05, 0.9);
  const minOrderUsdt = clamp(Number(settings.minOrderUsdt || 10), 1, 10_000);
  const rebalanceThreshold = clamp(Number(settings.rebalanceThreshold || 4) / 100, 0.005, 0.5);

  const assets = Object.entries(marketData)
    .map(([symbol, data]) => analyzeAsset(symbol, data))
    .filter(Boolean);

  if (!assets.length) {
    return {
      generatedAt: new Date().toISOString(),
      objective: objectiveKey,
      budgetUsdt,
      cashReserve: 1,
      confidence: 0,
      assets: [],
      allocations: [{ symbol: "USDT", weight: 1, valueUsdt: budgetUsdt }],
      orderPlan: [],
      equityCurve: [],
      notes: ["没有足够行情数据生成建议。"]
    };
  }

  const scored = scoreAssets(assets, objective, riskAppetite);
  const investableWeight = 1 - computeCashReserve(objective, riskAppetite, scored);
  const eligible = chooseEligibleAssets(scored, riskAppetite);
  const cappedWeights = capWeights(
    eligible.map((asset) => ({
      symbol: asset.symbol,
      raw: rawWeight(asset, objectiveKey, riskAppetite)
    })),
    investableWeight,
    maxAssetWeight
  );

  const allocations = scored.map((asset) => {
    const weight = cappedWeights.get(asset.symbol) || 0;
    return {
      ...asset,
      weight,
      valueUsdt: roundMoney(weight * budgetUsdt),
      targetPct: roundPct(weight)
    };
  }).sort((a, b) => b.weight - a.weight || b.score - a.score);

  const cashWeight = clamp(1 - sum(allocations.map((asset) => asset.weight)), 0, 1);
  const orderPlan = allocations
    .filter((asset) => asset.weight > 0.000001)
    .map((asset) => ({
      instId: asset.symbol,
      side: "buy",
      tdMode: "cash",
      ordType: "market",
      tgtCcy: "quote_ccy",
      quoteValueUsdt: roundMoney(asset.weight * budgetUsdt),
      sz: String(roundMoney(asset.weight * budgetUsdt)),
      reason: asset.reason
    }))
    .filter((order) => order.quoteValueUsdt >= minOrderUsdt);

  const confidence = computePlanConfidence(allocations, eligible, investableWeight);
  const best = allocations.find((asset) => asset.weight > 0) || allocations[0];

  return {
    generatedAt: new Date().toISOString(),
    objective: objectiveKey,
    objectiveLabel: objective.label,
    riskLevel,
    budgetUsdt,
    maxAssetWeight,
    minOrderUsdt,
    rebalanceThreshold,
    cashReserve: cashWeight,
    cashValueUsdt: roundMoney(cashWeight * budgetUsdt),
    confidence,
    best: best ? summarizeBest(best) : null,
    assets: allocations,
    allocations: [
      ...allocations
        .filter((asset) => asset.weight > 0.0001)
        .map((asset) => ({
          symbol: asset.symbol,
          weight: asset.weight,
          targetPct: asset.targetPct,
          valueUsdt: asset.valueUsdt,
          last: asset.last
        })),
      { symbol: "USDT", weight: cashWeight, targetPct: roundPct(cashWeight), valueUsdt: roundMoney(cashWeight * budgetUsdt), last: 1 }
    ],
    orderPlan,
    equityCurve: buildEquityCurve(allocations, cashWeight),
    notes: buildNotes(allocations, confidence, cashWeight, orderPlan)
  };
}

function analyzeAsset(symbol, data) {
  const candles = Array.isArray(data?.candles) ? data.candles.filter((candle) => Number.isFinite(candle.close)) : [];
  if (candles.length < 20) {
    return {
      symbol,
      available: false,
      score: 0,
      reason: "K 线少于 20 根，暂不纳入。"
    };
  }

  const closes = candles.map((candle) => candle.close);
  const returns = percentageReturns(closes);
  const last = Number(data?.ticker?.last || closes.at(-1));
  const bid = Number(data?.ticker?.bidPx || 0);
  const ask = Number(data?.ticker?.askPx || 0);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
  const spread = bid > 0 && ask > 0 ? (ask - bid) / mid : 0;
  const volumeQuote24h = Number(data?.ticker?.volCcyQuote24h || data?.ticker?.volCcy24h || 0) || Number(data?.ticker?.vol24h || 0) * last;

  const meanDaily = mean(returns);
  const dailyVol = stddev(returns);
  const annualReturn = meanDaily * 365;
  const annualVol = dailyVol * Math.sqrt(365);
  const downsideVol = stddev(returns.filter((item) => item < 0)) * Math.sqrt(365);
  const momentum7 = momentum(closes, 7);
  const momentum30 = momentum(closes, 30);
  const trend = ema(closes, 8) / ema(closes, 21) - 1;
  const maxDrawdown = computeMaxDrawdown(closes);
  const rsi14 = computeRsi(closes, 14);

  return {
    symbol,
    available: true,
    last,
    candles: candles.length,
    annualReturn,
    annualVol,
    downsideVol,
    momentum7,
    momentum30,
    trend,
    maxDrawdown,
    rsi14,
    spread,
    volumeQuote24h,
    closes,
    returns
  };
}

function scoreAssets(assets, objective, riskAppetite) {
  const available = assets.filter((asset) => asset.available);
  const norms = {
    annualReturn: normalizeMap(available, "annualReturn"),
    momentum30: normalizeMap(available, "momentum30"),
    trend: normalizeMap(available, "trend"),
    annualVol: normalizeMap(available, "annualVol", true),
    maxDrawdown: normalizeMap(available, "maxDrawdown", true),
    spread: normalizeMap(available, "spread", true),
    volumeQuote24h: normalizeMap(available, "volumeQuote24h")
  };

  return assets.map((asset) => {
    if (!asset.available) return asset;

    const momentumScore = (norms.momentum30.get(asset.symbol) * 0.7) + (norms.trend.get(asset.symbol) * 0.3);
    const quality =
      (norms.annualReturn.get(asset.symbol) * objective.returnWeight) +
      (momentumScore * objective.momentumWeight) +
      (norms.annualVol.get(asset.symbol) * objective.volatilityWeight) +
      (norms.maxDrawdown.get(asset.symbol) * objective.drawdownWeight);
    const executionPenalty = clamp(asset.spread * 35, 0, 0.18) + (1 - norms.volumeQuote24h.get(asset.symbol)) * 0.08;
    const overboughtPenalty = asset.rsi14 > 78 ? 0.08 : 0;
    const riskBonus = riskAppetite * Math.max(asset.momentum30, 0) * 0.35;
    const score = clamp(quality + riskBonus - executionPenalty - overboughtPenalty, 0, 1);

    return {
      ...asset,
      score,
      rankScore: score,
      reason: explainAsset(asset, score)
    };
  }).sort((a, b) => (b.score || 0) - (a.score || 0));
}

function chooseEligibleAssets(scored, riskAppetite) {
  const available = scored.filter((asset) => asset.available);
  const threshold = riskAppetite >= 0.7 ? 0.2 : riskAppetite <= 0.35 ? 0.34 : 0.28;
  const eligible = available.filter((asset) => asset.score >= threshold && asset.spread <= 0.01);
  return (eligible.length ? eligible : available.slice(0, Math.min(3, available.length))).slice(0, 8);
}

function rawWeight(asset, objectiveKey, riskAppetite) {
  const volFloor = objectiveKey === "defensive" ? 0.18 : 0.26;
  const volPenalty = 1 / Math.max(asset.annualVol, volFloor);
  const momentumBoost = 1 + clamp(asset.momentum30, -0.35, 0.6) * (0.6 + riskAppetite);
  const scoreCurve = Math.pow(Math.max(asset.score, 0.03), 0.65 + riskAppetite * 0.45);
  return Math.max(scoreCurve * volPenalty * momentumBoost, 0.0001);
}

function computeCashReserve(objective, riskAppetite, scored) {
  const available = scored.filter((asset) => asset.available);
  const averageVol = mean(available.map((asset) => asset.annualVol).filter(Number.isFinite));
  const weakMomentum = available.filter((asset) => asset.momentum30 < 0).length / Math.max(available.length, 1);
  return clamp(objective.cashBase + (1 - riskAppetite) * 0.28 + weakMomentum * 0.14 + clamp(averageVol - 0.7, 0, 1) * 0.12, 0.05, 0.72);
}

function capWeights(items, totalWeight, maxWeight) {
  const weights = new Map();
  let remaining = clamp(totalWeight, 0, 1);
  let pool = items.filter((item) => item.raw > 0);

  while (pool.length && remaining > 0.000001) {
    const rawSum = sum(pool.map((item) => item.raw));
    const nextPool = [];
    let redistributed = false;

    for (const item of pool) {
      const proposed = remaining * item.raw / rawSum;
      if (proposed > maxWeight) {
        weights.set(item.symbol, (weights.get(item.symbol) || 0) + maxWeight);
        remaining -= maxWeight;
        redistributed = true;
      } else {
        nextPool.push(item);
      }
    }

    if (!redistributed) {
      for (const item of nextPool) {
        const proposed = remaining * item.raw / rawSum;
        weights.set(item.symbol, (weights.get(item.symbol) || 0) + proposed);
      }
      remaining = 0;
    }

    pool = nextPool;
  }

  return weights;
}

function buildEquityCurve(allocations, cashWeight) {
  const active = allocations.filter((asset) => asset.weight > 0 && Array.isArray(asset.returns));
  const minLength = active.length ? Math.min(...active.map((asset) => asset.returns.length)) : 0;
  if (!active.length || !Number.isFinite(minLength) || minLength < 2) return [];

  const start = Math.max(0, minLength - 60);
  let equity = 100;
  const curve = [{ index: 0, value: round(equity, 2) }];

  for (let i = start; i < minLength; i += 1) {
    let weightedReturn = 0;
    for (const asset of active) {
      const returns = asset.returns.slice(-minLength);
      weightedReturn += asset.weight * returns[i];
    }
    weightedReturn += cashWeight * 0.00002;
    equity *= 1 + weightedReturn;
    curve.push({ index: curve.length, value: round(equity, 2) });
  }

  return curve;
}

function computePlanConfidence(allocations, eligible, investableWeight) {
  const weightedConfidence = sum(allocations.map((asset) => {
    if (!asset.available) return 0;
    const dataQuality = clamp(asset.candles / 90, 0.2, 1);
    const riskQuality = clamp(1 - asset.annualVol / 2.8, 0.15, 1);
    const executionQuality = clamp(1 - asset.spread * 80, 0.2, 1);
    return asset.weight * (dataQuality * 0.45 + riskQuality * 0.35 + executionQuality * 0.2);
  }));
  const breadth = clamp(eligible.length / 4, 0.25, 1);
  return Math.round(clamp((weightedConfidence / Math.max(investableWeight, 0.01)) * 78 + breadth * 22, 1, 96));
}

function buildNotes(allocations, confidence, cashWeight, orderPlan) {
  const notes = [];
  if (confidence < 55) notes.push("置信度偏低，建议保持半自动或仅观察。");
  if (cashWeight > 0.45) notes.push("现金仓位较高，说明当前波动或趋势条件不够友好。");
  if (!orderPlan.length) notes.push("当前没有分配金额达到最小下单额的订单；权重为 0 的候选仅供观察。");

  const concentrated = allocations.find((asset) => asset.weight > 0.38);
  if (concentrated) notes.push(`${concentrated.symbol} 权重较高，请确认单币种上限符合你的风险承受能力。`);

  const overbought = allocations.filter((asset) => asset.weight > 0 && asset.rsi14 > 78);
  if (overbought.length) notes.push(`${overbought.map((asset) => asset.symbol).join(", ")} RSI 偏高，追涨风险上升。`);

  return notes.length ? notes : ["组合条件正常，仍需在本地测试账户中观察真实行情下的风险变化。"];
}

function summarizeBest(asset) {
  return {
    symbol: asset.symbol,
    targetPct: asset.targetPct,
    score: round(asset.score * 100, 1),
    last: asset.last,
    reason: asset.reason
  };
}

function explainAsset(asset, score) {
  const parts = [];
  if (asset.momentum30 > 0.08) parts.push("30 日动量强");
  if (asset.trend > 0.03) parts.push("短中期均线向上");
  if (asset.annualVol < 0.75) parts.push("波动相对克制");
  if (asset.maxDrawdown < 0.18) parts.push("回撤较浅");
  if (asset.rsi14 > 78) parts.push("短期偏热");
  if (asset.spread > 0.004) parts.push("点差偏高");
  if (!parts.length) parts.push(score >= 0.5 ? "综合评分靠前" : "综合条件一般");
  return parts.join("、");
}

function percentageReturns(values) {
  const returns = [];
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const current = values[i];
    if (prev > 0 && current > 0) returns.push(current / prev - 1);
  }
  return returns;
}

function momentum(values, periods) {
  if (values.length <= periods) return 0;
  const current = values.at(-1);
  const previous = values.at(-(periods + 1));
  return previous > 0 ? current / previous - 1 : 0;
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) {
    current = values[i] * k + current * (1 - k);
  }
  return current;
}

function computeMaxDrawdown(values) {
  let peak = values[0] || 0;
  let maxDrawdown = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
    }
  }
  return maxDrawdown;
}

function computeRsi(values, period) {
  if (values.length <= period) return 50;
  const changes = [];
  for (let i = 1; i < values.length; i += 1) changes.push(values[i] - values[i - 1]);
  const recent = changes.slice(-period);
  const gains = recent.filter((item) => item > 0);
  const losses = recent.filter((item) => item < 0).map(Math.abs);
  const avgGain = mean(gains);
  const avgLoss = mean(losses);
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function normalizeMap(items, key, inverse = false) {
  const values = items.map((item) => Number(item[key])).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const map = new Map();

  for (const item of items) {
    let normalized = max === min ? 0.5 : (Number(item[key]) - min) / (max - min);
    if (inverse) normalized = 1 - normalized;
    map.set(item.symbol, clamp(normalized, 0, 1));
  }

  return map;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? sum(clean) / clean.length : 0;
}

function stddev(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const avg = mean(clean);
  const variance = mean(clean.map((item) => (item - avg) ** 2));
  return Math.sqrt(variance);
}

function sum(values) {
  return values.reduce((total, item) => total + item, 0);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundMoney(value) {
  return round(value, 2);
}

function roundPct(value) {
  return round(value * 100, 2);
}
