export const OKX_LEVERAGE_TIERS = [1, 2, 3, 5, 10, 20, 50];

export function snapOkxLeverage(value, upperBound = 50) {
  const capped = Math.min(clamp(Number(value || 1), 1, 50), clamp(Number(upperBound || 1), 1, 50));
  return OKX_LEVERAGE_TIERS.filter((tier) => tier <= capped).at(-1) || 1;
}

export function buildContractRiskPlan({ instId, side = "long", ticker = {}, candles = [], instrument = {}, fundingRate = {}, openInterest = {}, marketFlow = null, account = {}, riskPct = 1, maxLeverage = 10, capitalBudget = null, feeRate = 0.0005, feeSource = "estimated" }) {
  const price = Number(ticker.last || candles.at(-1)?.close || 0);
  const closes = candles.map((item) => item.close).filter(Number.isFinite);
  const atr14 = atr(candles, 14);
  const volatility = annualizedVol(closes);
  const signal = quickSignal(closes);
  const requestedMaxLeverage = snapOkxLeverage(maxLeverage);
  const instrumentMaxLeverage = clamp(Number(instrument.lever || 1), 1, 50);
  const exchangeMaxLeverage = snapOkxLeverage(instrumentMaxLeverage, instrumentMaxLeverage);
  const maxLev = Math.min(requestedMaxLeverage, exchangeMaxLeverage);
  const recommendedLeverage = recommendLeverage({ maxLev, volatility, signal });
  const stopDistance = Math.max(atr14 * 2, price * 0.012);
  const stop = side === "short" ? price + stopDistance : price - stopDistance;
  const target1 = side === "short" ? price - stopDistance * 1.6 : price + stopDistance * 1.6;
  const target2 = side === "short" ? price - stopDistance * 2.4 : price + stopDistance * 2.4;
  const ctVal = Number(instrument.ctVal || contractValueFallback(instId));
  const equity = Number(account.totalEqUsd || 0);
  const availableUsdt = Number(account.availableUsdt || 0);
  const riskUsd = equity * clamp(Number(riskPct || 1), 0.1, 10) / 100;
  const riskPerContract = Math.abs(price - stop) * Math.max(ctVal, 0.00000001);
  const contractsByRisk = riskPerContract > 0 ? Math.floor(riskUsd / riskPerContract) : 0;
  const hasCapitalBudget = capitalBudget !== null && capitalBudget !== undefined && Number.isFinite(Number(capitalBudget));
  const budget = hasCapitalBudget ? Math.max(Number(capitalBudget), 0) : 0;
  const capitalPerContract = price * ctVal / recommendedLeverage + price * ctVal * Math.max(Number(feeRate || 0), 0);
  const contractsByBudget = hasCapitalBudget
    ? Math.floor(budget / Math.max(capitalPerContract, 0.00000001))
    : contractsByRisk;
  const contracts = Math.min(contractsByRisk, contractsByBudget);
  const notional = contracts * ctVal * price;
  const margin = recommendedLeverage > 0 ? notional / recommendedLeverage : notional;
  const liqPx = liquidationEstimate(price, recommendedLeverage, side);
  const stopBeforeLiq = side === "short" ? stop < liqPx : stop > liqPx;
  const funding = Number(fundingRate.fundingRate || 0);
  const fundingDirection = side === "short" ? -1 : 1;
  const weeklyFundingCost = notional * funding * 3 * 7 * fundingDirection;
  const entryFee = notional * Math.max(Number(feeRate || 0), 0);
  const roundTripFee = entryFee * 2;
  const estimatedSevenDayCost = weeklyFundingCost + roundTripFee;
  const oi = Number(openInterest.oiCcy || openInterest.oi || 0);
  const riskScore = clamp(Math.round(volatility * 35 + recommendedLeverage * 2.5 + (stopBeforeLiq ? 5 : 22)), 1, 100);
  const timing = entryTiming({ side, signal, price, stop, target1, target2, volatility, marketFlow });
  const trailingStop = side === "short" ? price - stopDistance * 0.35 : price + stopDistance * 0.35;

  return {
    instId,
    side,
    generatedAt: new Date().toISOString(),
    price: roundPrice(price),
    account: {
      totalEqUsd: round(equity, 2),
      availableUsdt: round(availableUsdt, 2),
      riskPct: Number(riskPct || 1)
    },
    market: {
      atr14: roundPrice(atr14),
      annualizedVolatility: round(volatility, 4),
      signal,
      fundingRate: round(funding, 8),
      openInterest: round(oi, 2),
      orderFlow: marketFlow
    },
    recommendation: {
      leverage: recommendedLeverage,
      maxLeverage: maxLev,
      exchangeMaxLeverage,
      instrumentMaxLeverage,
      requestedMaxLeverage,
      entry: roundPrice(price),
      stop: roundPrice(stop),
      target1: roundPrice(target1),
      target2: roundPrice(target2),
      contracts,
      contractValue: ctVal,
      notional: round(notional, 2),
      marginRequired: round(margin, 2),
      capitalRequired: round(margin + entryFee, 2),
      dollarRisk: round(contracts * riskPerContract, 2),
      liquidationPrice: roundPrice(liqPx),
      stopBeforeLiquidation: stopBeforeLiq,
      weeklyFundingCost: round(weeklyFundingCost, 4),
      feeRate: round(Number(feeRate || 0), 8),
      feeSource,
      estimatedEntryFee: round(entryFee, 4),
      estimatedRoundTripFee: round(roundTripFee, 4),
      estimatedSevenDayCost: round(estimatedSevenDayCost, 4),
      riskScore,
      riskLevel: riskScore >= 70 ? "高" : riskScore >= 40 ? "中" : "低",
      timing,
      tpSl: {
        stopLoss: roundPrice(stop),
        takeProfit1: roundPrice(target1),
        takeProfit2: roundPrice(target2),
        trailingStopAfterTp1: roundPrice(trailingStop),
        invalidation: timing.invalidation
      },
      notes: buildNotes({
        contractsByRisk: contracts,
        margin,
        availableUsdt,
        stopBeforeLiq,
        weeklyFundingCost,
        volatility,
        requestedMaxLeverage,
        exchangeMaxLeverage,
        marketFlow
      })
    },
    tiers: buildTiers({ price, stopDistance, side, ctVal, equity, riskPct, maxLev })
  };
}

function entryTiming({ side, signal, price, stop, target1, target2, volatility, marketFlow }) {
  const aligned = side === "short" ? -signal : signal;
  const pullback = Math.abs(price - stop) * 0.28;
  const betterEntry = side === "short" ? price + pullback : price - pullback;
  const flowConflict = marketFlow
    && marketFlow.direction !== "neutral"
    && marketFlow.direction !== side
    && Number(marketFlow.confidence || 0) >= Number(marketFlow.strongConflictThreshold || 68);
  if (flowConflict) {
    return {
      state: "wait",
      label: "等待资金流转向",
      reason: `当前订单流与计划方向冲突：${marketFlow.summary}。`,
      entryZone: [roundPrice(betterEntry), roundPrice(price)],
      exitHint: `若已持有，优先观察 ${roundPrice(stop)} 附近的防守线。`,
      invalidation: side === "short" ? `突破 ${roundPrice(stop)} 后空头逻辑失效` : `跌破 ${roundPrice(stop)} 后多头逻辑失效`
    };
  }
  if (aligned <= -0.25) {
    return {
      state: "wait",
      label: "暂不建议入场",
      reason: "当前短线动量与选择方向不一致，追单胜率偏低。",
      entryZone: [roundPrice(betterEntry), roundPrice(price)],
      exitHint: `若已持有，优先观察 ${roundPrice(stop)} 附近的防守线。`,
      invalidation: side === "short" ? `突破 ${roundPrice(stop)} 后空头逻辑失效` : `跌破 ${roundPrice(stop)} 后多头逻辑失效`
    };
  }
  if (aligned >= 0.35 && volatility < 1.15) {
    const flowConfirmation = marketFlow && marketFlow.direction === side
      ? ` 订单流同向确认：${marketFlow.label}。`
      : "";
    return {
      state: "enter",
      label: "可小仓试入",
      reason: `方向动量与交易方向一致，波动未进入极端区间。${flowConfirmation}`,
      entryZone: [roundPrice(betterEntry), roundPrice(price)],
      exitHint: `第一止盈 ${roundPrice(target1)}，剩余仓位看 ${roundPrice(target2)}。`,
      invalidation: side === "short" ? `突破 ${roundPrice(stop)} 后停止做空` : `跌破 ${roundPrice(stop)} 后停止做多`
    };
  }
  return {
    state: "watch",
    label: "等待确认",
    reason: "指标尚未形成高置信入场点，适合等回踩/反抽确认。",
    entryZone: [roundPrice(betterEntry), roundPrice(price)],
    exitHint: `只在接近计划区间成交，止损固定在 ${roundPrice(stop)}。`,
    invalidation: side === "short" ? `突破 ${roundPrice(stop)} 后空头计划失效` : `跌破 ${roundPrice(stop)} 后多头计划失效`
  };
}

function buildTiers({ price, stopDistance, side, ctVal, equity, riskPct, maxLev }) {
  return [
    { name: "保守", riskFactor: 0.5, leverage: snapOkxLeverage(3, maxLev), rr: 1.4 },
    { name: "均衡", riskFactor: 1, leverage: snapOkxLeverage(5, maxLev), rr: 1.8 },
    { name: "进攻", riskFactor: 1.5, leverage: snapOkxLeverage(10, maxLev), rr: 2.4 }
  ].map((tier) => {
    const stop = side === "short" ? price + stopDistance * tier.riskFactor : price - stopDistance * tier.riskFactor;
    const target = side === "short" ? price - stopDistance * tier.riskFactor * tier.rr : price + stopDistance * tier.riskFactor * tier.rr;
    const riskUsd = equity * Number(riskPct || 1) * tier.riskFactor / 100;
    const riskPerContract = Math.abs(price - stop) * Math.max(ctVal, 0.00000001);
    const contracts = riskPerContract > 0 ? Math.floor(riskUsd / riskPerContract) : 0;
    const notional = contracts * ctVal * price;
    return {
      name: tier.name,
      leverage: tier.leverage,
      entry: roundPrice(price),
      stop: roundPrice(stop),
      target: roundPrice(target),
      contracts,
      notional: round(notional, 2),
      marginRequired: round(tier.leverage > 0 ? notional / tier.leverage : notional, 2),
      dollarRisk: round(contracts * riskPerContract, 2)
    };
  });
}

function recommendLeverage({ maxLev, volatility, signal }) {
  let base = signal > 0.35 ? 8 : signal < -0.35 ? 4 : 5;
  if (volatility > 1.25) base -= 3;
  else if (volatility > 0.85) base -= 1;
  else if (volatility < 0.45) base += 1;
  return snapOkxLeverage(base, maxLev);
}

function quickSignal(closes) {
  if (closes.length < 30) return 0;
  const current = closes.at(-1);
  const prev7 = closes.at(-8);
  const prev30 = closes.at(-31);
  const momentum7 = prev7 > 0 ? current / prev7 - 1 : 0;
  const momentum30 = prev30 > 0 ? current / prev30 - 1 : 0;
  return clamp(momentum7 * 3 + momentum30, -1, 1);
}

function atr(candles, period) {
  if (candles.length <= period) return Number(candles.at(-1)?.close || 0) * 0.02;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  return mean(trs.slice(-period));
}

function annualizedVol(closes) {
  if (closes.length < 20) return 0.8;
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
  }
  return stddev(returns.slice(-60)) * Math.sqrt(365 * 24);
}

function liquidationEstimate(entry, leverage, side) {
  const mmr = 0.004;
  if (side === "short") return entry * (1 + 1 / leverage - mmr);
  return entry * (1 - 1 / leverage + mmr);
}

function buildNotes({ contractsByRisk, margin, availableUsdt, stopBeforeLiq, weeklyFundingCost, volatility, requestedMaxLeverage, exchangeMaxLeverage, marketFlow }) {
  const notes = [];
  if (requestedMaxLeverage > exchangeMaxLeverage) notes.push(`该合约在真实市场的最大可用杠杆为 ${exchangeMaxLeverage}x，建议已按上限收敛。`);
  if (contractsByRisk <= 0) notes.push("账户风险预算不足以形成最小合约仓位。");
  if (margin > availableUsdt) notes.push("预估保证金高于可用 USDT，需要降低杠杆仓位或补充测试账户资金。");
  if (!stopBeforeLiq) notes.push("止损价可能晚于预估强平价，必须降低杠杆或缩小止损距离。");
  if (Math.abs(weeklyFundingCost) > Math.max(5, availableUsdt * 0.002)) notes.push("资金费率成本对持仓影响较明显。");
  if (volatility > 1.2) notes.push("近期波动偏高，建议使用保守档或半仓验证。");
  if (marketFlow?.summary) notes.push(`资金异动参考：${marketFlow.summary}。`);
  if (marketFlow?.openInterestAnomaly === "rising") notes.push("OI 连续采样出现放大，参考了旧项目连续上涨窗口逻辑；方向仍须结合主动成交与盘口判断。");
  return notes.length ? notes : ["风险参数处于可控区间，仍建议先干跑和小额模拟验证。"];
}

function contractValueFallback(instId) {
  if (/BTC/.test(instId)) return 0.01;
  if (/ETH/.test(instId)) return 0.1;
  if (/DOGE/.test(instId)) return 100;
  return 1;
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, item) => sum + item, 0) / clean.length : 0;
}

function stddev(values) {
  const avg = mean(values);
  return Math.sqrt(mean(values.map((item) => (item - avg) ** 2)));
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

function roundPrice(value) {
  if (!Number.isFinite(value) || value === 0) return 0;
  const magnitude = Math.abs(value);
  const digits = magnitude >= 1
    ? 6
    : Math.min(14, Math.max(6, Math.ceil(-Math.log10(magnitude)) + 4));
  return round(value, digits);
}
