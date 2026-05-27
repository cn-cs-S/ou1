const DEFAULT_MMR_RATE = 0.004;

export function valuePositions(positionRows = [], markets = new Map()) {
  return positionRows
    .filter((item) => Number(item.pos || 0) !== 0)
    .map((item) => valuePosition(item, markets.get(item.instId)));
}

export function valueDemoPositions(positionRows = [], markets = new Map()) {
  return valuePositions(positionRows, markets);
}

function valuePosition(item, market) {
  const pos = Number(item.pos || 0);
  const avgPx = Number(item.avgPx || 0);
  const exchangeMarkPx = Number(item.markPx || 0);
  const exchangeUpl = Number(item.upl || 0);
  const lever = Math.max(Number(item.lever || 0), 1);
  const posSide = normalizeSide(item);
  const instType = String(item.instType || "").toUpperCase();
  const liveMarkPx = Number(market?.markPx || market?.lastPx || 0);
  const ctVal = Number(market?.instrument?.ctVal || item.ctVal || 1);
  const markPx = liveMarkPx || exchangeMarkPx;
  const entrySource = item.entrySource || "account-fill";

  if (instType === "SPOT" && liveMarkPx > 0 && avgPx > 0) {
    const units = Math.abs(pos);
    const cost = avgPx * units;
    const upl = (liveMarkPx - avgPx) * units;
    return {
      ...basePosition(item),
      markPx: liveMarkPx,
      upl,
      uplRatio: cost > 0 ? upl / cost : 0,
      liqPx: 0,
      bePx: avgPx,
      notionalUsd: liveMarkPx * units,
      margin: Number(item.capital || cost),
      ctVal: 1,
      exchangeMarkPx,
      exchangeUpl,
      entrySource,
      valuationSource: "live-public-last",
      valuationWarning: "现货盈亏按真实最新价在本地计算。",
      liquidationEstimated: false
    };
  }

  const linearUsdt = /-USDT(?:-|$)/.test(String(item.instId || ""))
    && ["SWAP", "FUTURES"].includes(instType);
  if (!linearUsdt || liveMarkPx <= 0 || avgPx <= 0) {
    return {
      ...basePosition(item),
      exchangeMarkPx,
      exchangeUpl,
      ctVal,
      entrySource,
      valuationSource: "market-unavailable-fallback",
      valuationWarning: "真实市场暂无对应报价，保留账户中的入场基准，暂不计算浮动盈亏。",
      liquidationEstimated: false
    };
  }

  const units = Math.abs(pos) * ctVal;
  const direction = posSide === "short" ? -1 : 1;
  const grossUpl = (markPx - avgPx) * units * direction;
  const initialMargin = Number(item.capital || 0) || avgPx * units / lever;
  const fundingRate = Number(market?.fundingRate || item.fundingRate || 0);
  const elapsedFundingIntervals = item.isTestPosition && Number(item.cTime || 0) > 0
    ? Math.floor((Date.now() - Number(item.cTime)) / (8 * 60 * 60 * 1000))
    : 0;
  const projectedFundingFee = -notionalFunding(markPx, units, fundingRate, posSide, elapsedFundingIntervals);
  const fundingFee = Number(item.fundingFee || 0) + projectedFundingFee;
  const upl = grossUpl + fundingFee;
  const costs = Math.max(0, -Number(item.fee || 0) - fundingFee);
  const bePx = units > 0
    ? avgPx + (posSide === "short" ? -1 : 1) * costs / units
    : avgPx;
  const notionalUsd = markPx * units;
  const maintenanceRate = maintenanceMarginRate(item, notionalUsd);
  const liqPx = liquidationPrice(avgPx, lever, maintenanceRate, posSide);

  return {
    ...basePosition(item),
    markPx,
    upl,
    uplRatio: initialMargin > 0 ? upl / initialMargin : 0,
    liqPx,
    bePx,
    notionalUsd,
    margin: initialMargin,
    ctVal,
    exchangeMarkPx,
    exchangeUpl,
    exchangeLiqPx: Number(item.liqPx || 0),
    fee: Number(item.fee || 0),
    fundingFee,
    fundingRate,
    entrySource,
    valuationSource: "live-public-mark",
    valuationWarning: String(item.mgnMode || "").toLowerCase() === "cross"
      ? "盈亏按真实标记价自算；全仓强平价为本地参考，无法替代交易所风控结果。"
      : "盈亏和强平参考按真实标记价、本地杠杆模型计算。",
    liquidationEstimated: true
  };
}

function notionalFunding(markPx, units, fundingRate, side, intervals) {
  const direction = side === "short" ? -1 : 1;
  return markPx * units * fundingRate * intervals * direction;
}

function basePosition(item) {
  return {
    instId: item.instId,
    instType: item.instType,
    posSide: item.posSide,
    pos: Number(item.pos || 0),
    avgPx: Number(item.avgPx || 0),
    markPx: Number(item.markPx || 0),
    upl: Number(item.upl || 0),
    uplRatio: Number(item.uplRatio || 0),
    lever: Number(item.lever || 0),
    liqPx: Number(item.liqPx || 0),
    bePx: Number(item.bePx || item.breakEvenPx || item.avgPx || 0),
    mgnMode: item.mgnMode || "",
    notionalUsd: Number(item.notionalUsd || item.notionalUsdForBorrow || 0),
    margin: Number(item.margin || item.imr || 0),
    capital: Number(item.capital || 0),
    fee: Number(item.fee || 0),
    fundingFee: Number(item.fundingFee || 0),
    entrySource: item.entrySource || "",
    isTestPosition: Boolean(item.isTestPosition),
    cTime: Number(item.cTime || 0)
  };
}

function maintenanceMarginRate(item, notionalUsd) {
  const rawMmr = Math.abs(Number(item.mmr || 0));
  if (rawMmr > 0 && notionalUsd > 0) {
    return clamp(rawMmr / notionalUsd, 0.0001, 0.2);
  }
  return DEFAULT_MMR_RATE;
}

function liquidationPrice(entry, leverage, maintenanceRate, side) {
  if (side === "short") return entry * (1 + 1 / leverage - maintenanceRate);
  return Math.max(0, entry * (1 - 1 / leverage + maintenanceRate));
}

function normalizeSide(item) {
  const raw = String(item.posSide || "").toLowerCase();
  if (raw === "short") return "short";
  if (raw === "long") return "long";
  return Number(item.pos || 0) < 0 ? "short" : "long";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
