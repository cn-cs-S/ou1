import fs from "node:fs";
import path from "node:path";

const DEFAULT_EQUITY = 1_000_000;

export function createTestAccountRegistry({ defaultFilePath, directoryPath, catalogPath, initialEquity = DEFAULT_EQUITY }) {
  let catalog = readCatalog(catalogPath);
  const accounts = new Map();
  const defaultEntry = {
    id: "default",
    purpose: "manual-test",
    label: "默认测试账户",
    filePath: defaultFilePath,
    createdAt: catalog.find((entry) => entry.id === "default")?.createdAt || new Date().toISOString()
  };
  catalog = [
    defaultEntry,
    ...catalog.filter((entry) => entry.id !== "default").map((entry) => ({
      ...entry,
      filePath: path.join(directoryPath, `${entry.id}.json`)
    }))
  ];
  saveCatalog();

  function list() {
    return catalog.map(({ filePath: ignored, ...entry }) => ({ ...entry }));
  }

  function descriptor(id = "default") {
    const entry = catalog.find((item) => item.id === id);
    if (!entry) throw new Error("测试账户不存在。");
    return entry;
  }

  function get(id = "default") {
    const entry = descriptor(id);
    if (!accounts.has(entry.id)) {
      accounts.set(entry.id, createTestAccount(entry.filePath, initialEquity));
    }
    return accounts.get(entry.id);
  }

  function create({ label, initialEquityUsdt, purpose }) {
    const normalizedLabel = String(label || "").trim().slice(0, 24) || `测试账户 ${catalog.length}`;
    const normalizedPurpose = String(purpose || "manual-test").trim().slice(0, 40) || "manual-test";
    const id = `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const entry = {
      id,
      label: normalizedLabel,
      purpose: normalizedPurpose,
      filePath: path.join(directoryPath, `${id}.json`),
      createdAt: new Date().toISOString()
    };
    catalog.push(entry);
    saveCatalog();
    const account = get(id);
    account.reset(positiveNumber(initialEquityUsdt, initialEquity));
    return { ...entry, filePath: undefined };
  }

  function remove(id) {
    if (!id || id === "default") throw new Error("默认测试账户不能删除。");
    const entry = catalog.find((item) => item.id === id);
    if (!entry) throw new Error("测试账户不存在。");
    catalog = catalog.filter((item) => item.id !== id);
    accounts.delete(id);
    saveCatalog();
    if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath);
  }

  function saveCatalog() {
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    const records = catalog.map(({ filePath: ignored, ...entry }) => entry);
    fs.writeFileSync(catalogPath, `${JSON.stringify({ version: 1, accounts: records }, null, 2)}\n`, "utf8");
  }

  return { list, descriptor, get, create, remove };
}

export function createTestAccount(filePath, initialEquity = DEFAULT_EQUITY) {
  let state = readState(filePath, initialEquity);

  function snapshot() {
    return structuredClone(state);
  }

  function reset(nextEquity = initialEquity) {
    const equity = positiveNumber(nextEquity, DEFAULT_EQUITY);
    state = createEmptyState(equity);
    save();
    return snapshot();
  }

  function symbols() {
    return state.positions.map((position) => position.instId);
  }

  function positions() {
    return state.positions.map((position) => ({ ...position }));
  }

  function adjust(input, market, instrument = {}) {
    const instId = String(input.instId || "").trim().toUpperCase();
    const instType = input.instType === "SWAP" ? "SWAP" : "SPOT";
    const action = ["add", "reduce", "close"].includes(input.action) ? input.action : "add";
    const side = input.side === "short" && instType === "SWAP" ? "short" : "long";
    const price = Number(market?.markPx || market?.lastPx || 0);
    if (!instId || price <= 0) throw new Error("无法取得真实市场价格，测试账户未修改。");

    const existingIndex = state.positions.findIndex((position) => position.instId === instId);
    const existing = existingIndex >= 0 ? state.positions[existingIndex] : null;
    if (action !== "add" && !existing) throw new Error("测试账户中没有该持仓。");

    if (action === "add") {
      if (existing && existing.posSide !== side) {
        throw new Error("测试账户已有相反方向持仓，请先平仓后再改变方向。");
      }
      const productMaxLeverage = instType === "SWAP" ? Math.max(Number(instrument.lever || 1), 1) : 1;
      const leverage = instType === "SWAP"
        ? Math.min(Math.max(Number(input.leverage || 1), 1), productMaxLeverage)
        : 1;
      const requestedNotional = positiveNumber(input.notionalUsd, Math.max(state.initialEquityUsdt * 0.05, 10));
      const ctVal = instType === "SWAP" ? positiveNumber(instrument.ctVal, 1) : 1;
      const lotSz = positiveNumber(instrument.lotSz, instType === "SWAP" ? 1 : 0.00000001);
      const rawUnits = instType === "SWAP" ? requestedNotional / (price * ctVal) : requestedNotional / price;
      const units = floorLot(rawUnits, lotSz);
      if (units <= 0) throw new Error("该金额小于交易品种的最小测试仓位。");

      const actualNotional = units * price * ctVal;
      const requiredCapital = instType === "SWAP" ? actualNotional / leverage : actualNotional;
      const feeRate = Math.max(Number(market?.feeRate || input.feeRate || 0), 0);
      const executionFee = actualNotional * feeRate;
      const capitalWithFee = requiredCapital + executionFee;
      if (capitalWithFee > state.cashUsdt + 0.000001) {
        throw new Error(`测试账户可用资金不足：需要 ${round(capitalWithFee)} USDT（含预估手续费），可用 ${round(state.cashUsdt)} USDT。`);
      }

      const previousUnits = Number(existing?.pos || 0);
      const nextUnits = previousUnits + units;
      const avgPx = existing
        ? ((existing.avgPx * previousUnits) + (price * units)) / nextUnits
        : price;
      const next = {
        instId,
        instType,
        posSide: side,
        pos: nextUnits,
        avgPx,
        lever: leverage,
        ctVal,
        capital: Number(existing?.capital || 0) + requiredCapital,
        fee: Number(existing?.fee || 0) - executionFee,
        feeRate,
        fundingRate: Number(market?.fundingRate || existing?.fundingRate || 0),
        mgnMode: instType === "SWAP" ? "isolated" : "cash",
        entrySource: "test-account-reference",
        isTestPosition: true,
        cTime: Number(existing?.cTime || Date.now())
      };
      if (existingIndex >= 0) state.positions[existingIndex] = next;
      else state.positions.push(next);
      state.cashUsdt -= capitalWithFee;
      state.realizedPnl -= executionFee;
      state.updatedAt = new Date().toISOString();
      save();
      return { action, position: next, referencePrice: price, executionFee: round(executionFee), feeRate };
    }

    const fraction = action === "close" ? 1 : 0.25;
    const closeUnits = existing.pos * fraction;
    const ctVal = positiveNumber(existing.ctVal, 1);
    const direction = existing.posSide === "short" ? -1 : 1;
    const pnl = (price - existing.avgPx) * closeUnits * ctVal * direction;
    const releasedCapital = existing.capital * fraction;
    const executionFee = price * closeUnits * ctVal * Math.max(Number(market?.feeRate || existing.feeRate || 0), 0);
    const netPnl = pnl - executionFee;
    state.cashUsdt += releasedCapital + netPnl;
    state.realizedPnl += netPnl;

    if (action === "close" || existing.pos - closeUnits <= 0.00000001) {
      state.positions.splice(existingIndex, 1);
    } else {
      existing.pos -= closeUnits;
      existing.capital -= releasedCapital;
      existing.fee = Number(existing.fee || 0) * (1 - fraction);
      state.positions[existingIndex] = existing;
    }
    state.updatedAt = new Date().toISOString();
    save();
    return { action, referencePrice: price, realizedPnl: netPnl, executionFee: round(executionFee) };
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  return { snapshot, reset, symbols, positions, adjust };
}

function readCatalog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

function readState(filePath, initialEquity) {
  if (!fs.existsSync(filePath)) return createEmptyState(positiveNumber(initialEquity, DEFAULT_EQUITY));
  try {
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      version: 1,
      initialEquityUsdt: positiveNumber(state.initialEquityUsdt, DEFAULT_EQUITY),
      cashUsdt: Math.max(Number(state.cashUsdt || 0), 0),
      realizedPnl: Number(state.realizedPnl || 0),
      positions: Array.isArray(state.positions) ? state.positions : [],
      updatedAt: state.updatedAt || new Date().toISOString()
    };
  } catch {
    return createEmptyState(positiveNumber(initialEquity, DEFAULT_EQUITY));
  }
}

function createEmptyState(initialEquityUsdt) {
  return {
    version: 1,
    initialEquityUsdt,
    cashUsdt: initialEquityUsdt,
    realizedPnl: 0,
    positions: [],
    updatedAt: new Date().toISOString()
  };
}

function floorLot(value, lotSize) {
  const factor = 10 ** decimals(lotSize);
  return Math.floor((value + Number.EPSILON) * factor / (lotSize * factor)) * lotSize;
}

function decimals(value) {
  const text = String(value);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function round(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}
