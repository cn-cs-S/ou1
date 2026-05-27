import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOkxClient, OkxError } from "./src/okx.js";
import { buildInvestmentPlan, DEFAULT_SYMBOLS, sanitizeUniverse } from "./src/optimizer.js";
import { createAutopilot } from "./src/autopilot.js";
import { buildSkillsStatus } from "./src/skillsRegistry.js";
import { buildIndicatorPack } from "./src/marketIndicators.js";
import { buildUniverse } from "./src/universe.js";
import { buildContractRiskPlan, snapOkxLeverage } from "./src/contractRisk.js";
import { valuePositions } from "./src/realValuation.js";
import { createTestAccountRegistry } from "./src/testAccount.js";
import { buildMarketFlowReference } from "./src/marketFlow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const envPath = path.join(__dirname, ".env");

loadEnv(envPath);

const preferredPort = Number(process.env.PORT || 8787);
let activePort = preferredPort;
const okx = createOkxClient();
const auditLog = [];
const feeCache = new Map();
const marketFlowCache = new Map();
const accountSource = process.env.OKX_ACCOUNT_SOURCE === "live-readonly" ? "live-readonly" : "test";
const testAccounts = createTestAccountRegistry({
  defaultFilePath: path.join(__dirname, "data", "test-account.json"),
  directoryPath: path.join(__dirname, "data", "test-accounts"),
  catalogPath: path.join(__dirname, "data", "test-accounts", "catalog.json"),
  initialEquity: Number(process.env.TEST_ACCOUNT_INITIAL_USDT || 100_000)
});

const autopilot = createAutopilot({
  runPlan: runFullPlan,
  appendLog
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, errorToStatus(error), {
      ok: false,
      error: safeError(error)
    });
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && activePort < preferredPort + 20) {
    appendLog({
      level: "warn",
      event: "port_in_use",
      message: `Port ${activePort} is in use; trying ${activePort + 1}.`
    });
    activePort += 1;
    server.listen(activePort);
    return;
  }
  throw error;
});

server.listen(activePort, () => {
  appendLog({
    level: "info",
    event: "server_started",
    message: `OKX AI Trade Lab running on http://localhost:${activePort}`
  });
  console.log(`OKX AI Trade Lab: http://localhost:${activePort}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      now: new Date().toISOString(),
      credentials: okx.credentialsStatus(),
      defaults: {
        symbols: DEFAULT_SYMBOLS,
        accountSource,
        accountLabel: accountSource === "live-readonly" ? "真实账户只读" : "本地测试账户",
        defaultTestAccountId: "default",
        marketSource: "live-public",
        portfolioValuation: "local-real-market"
      },
      autopilot: autopilot.getState("default"),
      automations: autopilot.getStates()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    sendJson(res, 200, { ok: true, logs: auditLog.slice(-120).reverse() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/skills") {
    const skills = buildSkillsStatus(__dirname);
    sendJson(res, 200, {
      ok: true,
      installed: skills.filter((skill) => skill.installed).length,
      executable: skills.filter((skill) => skill.dependencyStatus.every((item) => item.ready)).length,
      writeEnabled: skills.filter((skill) => skill.writeAccess).length,
      skills
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account/balance") {
    const source = normalizeAccountSource(url.searchParams.get("source") || accountSource);
    const accountId = normalizeTestAccountId(url.searchParams.get("accountId") || "default");
    const account = await loadAccountSummary(source, accountId);
    sendJson(res, 200, { ok: true, balances: account.balances, account });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/account/summary") {
    const source = normalizeAccountSource(url.searchParams.get("source") || accountSource);
    const accountId = normalizeTestAccountId(url.searchParams.get("accountId") || "default");
    sendJson(res, 200, { ok: true, account: await loadAccountSummary(source, accountId) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/accounts/overview") {
    sendJson(res, 200, { ok: true, overview: await buildAccountsOverview() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test-accounts") {
    const body = await readJson(req);
    const descriptor = testAccounts.create({
      label: body.label,
      initialEquityUsdt: body.initialEquityUsdt
    });
    sendJson(res, 201, {
      ok: true,
      descriptor,
      account: await loadAccountSummary("test", descriptor.id),
      overview: await buildAccountsOverview()
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/test-accounts/")) {
    const id = normalizeTestAccountId(decodeURIComponent(url.pathname.slice("/api/test-accounts/".length)));
    const automation = autopilot.getState(id);
    if (automation.enabled) {
      throw new Error("请先关闭该测试账户的自动化操作，再删除账户。");
    }
    testAccounts.remove(id);
    autopilot.remove(id);
    sendJson(res, 200, { ok: true, overview: await buildAccountsOverview() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test-account/reset") {
    const body = await readJson(req);
    const accountId = normalizeTestAccountId(body.accountId || "default");
    testAccounts.get(accountId).reset(Number(body.initialEquityUsdt || process.env.TEST_ACCOUNT_INITIAL_USDT || 100_000));
    sendJson(res, 200, { ok: true, account: await loadAccountSummary("test", accountId) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test-account/position") {
    const body = await readJson(req);
    const accountId = normalizeTestAccountId(body.accountId || "default");
    const instType = normalizeInstType(body.instType || "SPOT");
    const instId = String(body.instId || "").trim().toUpperCase();
    const [ticker, instruments, mark, fee, fundingRate] = await Promise.all([
      okx.getTicker(instId),
      okx.getInstruments(instType, instId),
      instType === "SWAP" ? okx.getMarkPrice(instId, instType).catch(() => null) : Promise.resolve(null),
      getTradingFeeEstimate(instType, instId),
      instType === "SWAP" ? okx.getFundingRate(instId).catch(() => null) : Promise.resolve(null)
    ]);
    const instrument = instruments.find((item) => item.state === "live" && item.instId === instId);
    if (!instrument) throw new Error(`真实市场不存在可测试的交易品种 ${instId}。`);
    const adjustment = testAccounts.get(accountId).adjust({
      ...body,
      instId,
      instType,
      leverage: instType === "SWAP" ? snapOkxLeverage(body.leverage, Number(instrument.lever || 1)) : 1
    }, {
      live: true,
      lastPx: Number(ticker?.last || 0),
      markPx: Number(mark?.markPx || ticker?.last || 0),
      feeRate: fee.takerRate,
      fundingRate: Number(fundingRate?.fundingRate || 0),
      instrument
    }, instrument);
    sendJson(res, 200, { ok: true, adjustment, account: await loadAccountSummary("test", accountId) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/chart") {
    const instId = String(url.searchParams.get("instId") || "BTC-USDT").trim().toUpperCase();
    const bar = normalizeBar(url.searchParams.get("bar") || "30m");
    const limit = clamp(Number(url.searchParams.get("limit") || 180), 60, 300);
    const [ticker, candles] = await Promise.all([
      okx.getTicker(instId),
      okx.getCandles(instId, bar, limit)
    ]);
    const indicatorPack = buildIndicatorPack(candles, ticker || {});
    sendJson(res, 200, {
      ok: true,
      instId,
      bar,
      marketSource: "live-public",
      ticker,
      candles,
      stats: candleStats(candles),
      ...indicatorPack
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/universe") {
    const instType = normalizeInstType(url.searchParams.get("instType") || "SPOT");
    const quoteCcy = String(url.searchParams.get("quoteCcy") || "USDT").trim().toUpperCase();
    const excludeNew = url.searchParams.get("excludeNew") !== "0";
    const minAgeDays = clamp(Number(url.searchParams.get("minAgeDays") || 30), 0, 3650);
    const limit = clamp(Number(url.searchParams.get("limit") || 80), 10, 500);
    const [instruments, tickers] = await Promise.all([
      okx.getInstruments(instType),
      okx.getTickers(instType)
    ]);
    const universe = buildUniverse({ instruments, tickers, instType, quoteCcy, excludeNew, minAgeDays, limit });
    sendJson(res, 200, { ok: true, marketSource: "live-public", universe });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/instruments/search") {
    const instType = normalizeInstType(url.searchParams.get("instType") || "SPOT");
    const raw = String(url.searchParams.get("q") || "").trim().toUpperCase();
    const q = raw.includes("-") ? raw : `${raw}-USDT`;
    const compact = q.replace(/-/g, "");
    const [instruments, tickers] = await Promise.all([
      okx.getInstruments(instType),
      okx.getTickers(instType)
    ]);
    const tickerMap = new Map(tickers.map((ticker) => [ticker.instId, ticker]));
    const matches = instruments
      .filter((item) => item.state === "live")
      .filter((item) => normalizeInstType(instType) === "SPOT" ? item.quoteCcy === "USDT" : item.instId.endsWith("-USDT-SWAP"))
      .filter((item) => {
        const base = String(item.baseCcy || item.instId.split("-")[0]).toUpperCase();
        const instCompact = item.instId.replace(/-/g, "");
        return item.instId === q || instCompact.includes(compact) || base === raw.replace("-USDT", "");
      })
      .slice(0, 12)
      .map((item) => ({
        instId: item.instId,
        instType,
        baseCcy: item.baseCcy || item.instId.split("-")[0],
        quoteCcy: item.quoteCcy || "USDT",
        last: Number(tickerMap.get(item.instId)?.last || 0),
        change24h: changeFromTicker(tickerMap.get(item.instId) || {}),
        lever: Number(item.lever || 0),
        ctVal: Number(item.ctVal || 0),
        lotSz: item.lotSz || "",
        minSz: item.minSz || "",
        listTime: Number(item.listTime || 0)
      }));
    sendJson(res, 200, { ok: true, q: raw, matches });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/contract/plan") {
    const side = url.searchParams.get("side") === "short" ? "short" : "long";
    const context = await loadContractPlanContext(url);
    const plan = buildContractRiskPlan({ ...context, side });
    sendJson(res, 200, { ok: true, plan });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/contract/pair") {
    const context = await loadContractPlanContext(url);
    sendJson(res, 200, {
      ok: true,
      plans: {
        long: buildContractRiskPlan({ ...context, side: "long" }),
        short: buildContractRiskPlan({ ...context, side: "short" })
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/market-flow") {
    const base = String(url.searchParams.get("instId") || "BTC-USDT-SWAP").trim().toUpperCase();
    const instId = base.endsWith("-SWAP") ? base : `${base.replace(/-USDT$/, "")}-USDT-SWAP`;
    const [candles, instruments, fundingRate, openInterest] = await Promise.all([
      okx.getCandles(instId, "1H", 40),
      okx.getInstruments("SWAP", instId),
      okx.getFundingRate(instId).catch(() => null),
      okx.getOpenInterest(instId, "SWAP").catch(() => null)
    ]);
    const instrument = instruments.find((item) => item.state === "live" && item.instId === instId);
    if (!instrument) throw new Error(`真实永续市场不存在可监控合约 ${instId}。`);
    const marketFlow = await getMarketFlowReference(instId, {
      candles,
      instrument,
      fundingRate: fundingRate || {},
      openInterest: openInterest || {}
    });
    sendJson(res, 200, { ok: true, instId, marketFlow });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/market/snapshot") {
    const symbols = sanitizeUniverse(url.searchParams.get("symbols") || DEFAULT_SYMBOLS.join(","));
    const data = await fetchMarketData(symbols, Number(url.searchParams.get("limit") || 90));
    sendJson(res, 200, { ok: true, symbols, data });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    const body = await readJson(req);
    const plan = await analyze(body);
    sendJson(res, 200, { ok: true, plan });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/execute") {
    const body = await readJson(req);
    const result = await executePlan(body.orders || [], {
      dryRun: body.dryRun !== false,
      confirmation: body.confirmation || "",
      source: "manual",
      maxOrderUsdt: Number(body.maxOrderUsdt || 500),
      accountSource: normalizeAccountSource(body.accountSource || "test"),
      accountId: normalizeTestAccountId(body.accountId || "default")
    });
    sendJson(res, 200, { ok: true, execution: result });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/autopilot") {
    const targetAccountId = normalizeTestAccountId(url.searchParams.get("accountId") || "default");
    sendJson(res, 200, { ok: true, autopilot: autopilot.getState(targetAccountId) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/autopilot") {
    const body = await readJson(req);
    const targetAccountId = normalizeTestAccountId(body.accountId || "default");
    testAccounts.descriptor(targetAccountId);
    body.accountId = targetAccountId;
    const state = await autopilot.configure(body);
    sendJson(res, 200, { ok: true, autopilot: state });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/autopilot/run") {
    const body = await readJson(req);
    const targetAccountId = normalizeTestAccountId(body.accountId || "default");
    testAccounts.descriptor(targetAccountId);
    const result = await autopilot.runOnce("manual", targetAccountId);
    sendJson(res, 200, { ok: true, result, autopilot: autopilot.getState(targetAccountId) });
    return;
  }

  sendJson(res, 404, { ok: false, error: { message: "API route not found." } });
}

async function analyze(settings = {}) {
  const symbols = sanitizeUniverse(settings.symbols || DEFAULT_SYMBOLS);
  const lookbackDays = clamp(Number(settings.lookbackDays || 90), 30, 300);
  const marketData = await fetchMarketData(symbols, lookbackDays);
  const plan = await enrichPlanCosts(buildInvestmentPlan(marketData, settings));

  appendLog({
    level: "info",
    event: "analysis_completed",
    message: `Generated plan for ${symbols.join(", ")}.`,
    meta: {
      confidence: plan.confidence,
      orders: plan.orderPlan.length,
      best: plan.best?.symbol || null
    }
  });

  return plan;
}

async function enrichPlanCosts(plan) {
  const assets = await Promise.all((plan.assets || []).map(async (asset) => {
    const instType = String(asset.symbol || "").endsWith("-SWAP") ? "SWAP" : "SPOT";
    const fee = await getTradingFeeEstimate(instType, asset.symbol);
    const notional = Number(asset.valueUsdt || 0);
    return {
      ...asset,
      instType,
      feeRate: fee.takerRate,
      feeSource: fee.source,
      estimatedEntryFee: roundMoney(notional * fee.takerRate)
    };
  }));
  const assetMap = new Map(assets.map((asset) => [asset.symbol, asset]));
  return {
    ...plan,
    assets,
    orderPlan: (plan.orderPlan || []).map((order) => {
      const asset = assetMap.get(order.instId);
      return {
        ...order,
        instType: asset?.instType || "SPOT",
        feeRate: Number(asset?.feeRate || 0),
        feeSource: asset?.feeSource || "estimated",
        estimatedFee: roundMoney(Number(order.quoteValueUsdt || 0) * Number(asset?.feeRate || 0))
      };
    })
  };
}

async function getTradingFeeEstimate(instType, instId) {
  const normalizedType = normalizeInstType(instType);
  const key = `${normalizedType}:${instId}`;
  const cached = feeCache.get(key);
  if (cached && Date.now() - cached.at < 300_000) return cached.value;
  const fallbackRate = normalizedType === "SWAP"
    ? Math.max(Number(process.env.OKX_SWAP_TAKER_FEE_RATE || 0.0005), 0)
    : Math.max(Number(process.env.OKX_SPOT_TAKER_FEE_RATE || 0.001), 0);
  let value = { takerRate: fallbackRate, source: "estimated-default" };
  if (okx.credentialsStatus().privateReady) {
    try {
      const row = await okx.getTradeFee(normalizedType, instId);
      const exchangeRate = -Number(row?.taker || row?.takerU || 0);
      if (Number.isFinite(exchangeRate) && exchangeRate >= 0) {
        value = { takerRate: exchangeRate, source: "okx-account-rate" };
      }
    } catch {
      value = { takerRate: fallbackRate, source: "estimated-default" };
    }
  }
  feeCache.set(key, { at: Date.now(), value });
  return value;
}

async function getMarketFlowReference(instId, { candles = [], instrument = {}, fundingRate = {}, openInterest = {} } = {}) {
  const cached = marketFlowCache.get(instId);
  if (cached && Date.now() - cached.at < 5_000) {
    return cached.value || cached.pending;
  }
  const pending = Promise.all([
    okx.getOrderBook(instId, 20).catch(() => null),
    okx.getTrades(instId, 100).catch(() => [])
  ]).then(([orderBook, trades]) => {
    const value = buildMarketFlowReference({
      instId,
      orderBook: orderBook || {},
      trades,
      candles,
      openInterest,
      fundingRate,
      contractValue: Number(instrument.ctVal || 1)
    });
    marketFlowCache.set(instId, { at: Date.now(), value });
    return value;
  });
  marketFlowCache.set(instId, { at: Date.now(), pending });
  return pending;
}

async function loadContractPlanContext(url) {
  const base = String(url.searchParams.get("instId") || "BTC-USDT-SWAP").trim().toUpperCase();
  const instId = base.endsWith("-SWAP") ? base : `${base.replace(/-USDT$/, "")}-USDT-SWAP`;
  const riskPct = clamp(Number(url.searchParams.get("riskPct") || 1), 0.1, 10);
  const maxLeverage = clamp(Number(url.searchParams.get("maxLeverage") || 10), 1, 50);
  const capitalBudget = url.searchParams.has("capitalBudget")
    ? Math.max(Number(url.searchParams.get("capitalBudget") || 0), 0)
    : null;
  const riskAccountSource = normalizeAccountSource(url.searchParams.get("accountSource") || accountSource);
  const riskAccountId = normalizeTestAccountId(url.searchParams.get("accountId") || "default");
  const [ticker, candles, instruments, fundingRate, openInterest, account, fee] = await Promise.all([
    okx.getTicker(instId),
    okx.getCandles(instId, "1H", 120),
    okx.getInstruments("SWAP", instId),
    okx.getFundingRate(instId).catch(() => null),
    okx.getOpenInterest(instId, "SWAP").catch(() => null),
    loadAccountSummary(riskAccountSource, riskAccountId),
    getTradingFeeEstimate("SWAP", instId)
  ]);
  const instrument = instruments.find((item) => item.state === "live" && item.instId === instId);
  if (!instrument) throw new Error(`真实永续市场不存在可交易合约 ${instId}，无法生成杠杆计划。`);
  const marketFlow = await getMarketFlowReference(instId, {
    candles,
    instrument,
    fundingRate: fundingRate || {},
    openInterest: openInterest || {}
  });
  return {
    instId,
    ticker: ticker || {},
    candles,
    instrument,
    fundingRate: fundingRate || {},
    openInterest: openInterest || {},
    marketFlow,
    account: {
      totalEqUsd: account.totalEqUsd,
      availableUsdt: account.availableUsdt
    },
    riskPct,
    maxLeverage,
    capitalBudget,
    feeRate: fee.takerRate,
    feeSource: fee.source
  };
}

async function fetchMarketData(symbols, limit = 90) {
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const [ticker, candles] = await Promise.all([
        okx.getTicker(symbol),
        okx.getCandles(symbol, "1D", limit)
      ]);
      return [symbol, { ticker, candles }];
    } catch (error) {
      appendLog({
        level: "warn",
        event: "market_fetch_failed",
        message: `${symbol}: ${error.message}`
      });
      return [symbol, { error: safeError(error), candles: [] }];
    }
  }));

  return Object.fromEntries(entries);
}

async function runFullPlan({ settings, executionMode, dryRun, reason, accountId = "default" }) {
  const plan = await analyze(settings);
  const shouldExecute = executionMode === "auto";
  const execution = shouldExecute
    ? await reconcileAutomatedTestAccount(plan, settings, {
        dryRun,
        accountId: normalizeTestAccountId(accountId),
        maxOrderUsdt: Number(settings.maxOrderUsdt || 500)
      })
    : {
        dryRun: true,
        skipped: true,
        reason: executionMode,
        results: []
      };

  return { reason, plan, execution };
}

async function executePlan(orders, options = {}) {
  const dryRun = options.dryRun !== false;
  const source = options.source || "manual";
  const maxOrderUsdt = clamp(Number(options.maxOrderUsdt || 500), 1, 100_000);
  const cleanOrders = sanitizeOrders(orders).slice(0, 10);

  if (!cleanOrders.length) {
    return { dryRun, skipped: true, reason: "no_orders", results: [] };
  }

  const oversized = cleanOrders.find((order) => Number(order.requiredCapitalUsdt || order.quoteValueUsdt || order.sz) > maxOrderUsdt);
  if (oversized) {
    throw new Error(`${oversized.instId} order exceeds max order limit ${maxOrderUsdt} USDT.`);
  }

  if (dryRun) {
    appendLog({
      level: "info",
      event: "dry_run_execution",
      message: `Dry-run checked ${cleanOrders.length} orders.`,
      meta: { source }
    });
    return {
      dryRun: true,
      skipped: false,
      results: cleanOrders.map((order) => ({
        instId: order.instId,
        instType: order.instType,
        side: order.side,
        sz: order.sz,
        requiredCapitalUsdt: order.requiredCapitalUsdt,
        status: "dry-run"
      }))
    };
  }

  if (options.confirmation !== "APPLY_TEST") {
    throw new Error("Applying a plan to the test account requires confirmation token APPLY_TEST.");
  }

  ensureWritableTestAccount(options.accountSource || "test");

  const localTestAccount = testAccounts.get(normalizeTestAccountId(options.accountId || "default"));
  const results = [];
  for (const order of cleanOrders) {
    const [ticker, instruments, mark, fee, fundingRate] = await Promise.all([
      okx.getTicker(order.instId),
      okx.getInstruments(order.instType, order.instId),
      order.instType === "SWAP" ? okx.getMarkPrice(order.instId, order.instType).catch(() => null) : Promise.resolve(null),
      getTradingFeeEstimate(order.instType, order.instId),
      order.instType === "SWAP" ? okx.getFundingRate(order.instId).catch(() => null) : Promise.resolve(null)
    ]);
    const instrument = instruments.find((item) => item.state === "live" && item.instId === order.instId);
    if (!instrument) throw new Error(`真实市场不存在 ${order.instId}，无法加入测试账户。`);
    const adjustment = localTestAccount.adjust({
      instId: order.instId,
      instType: order.instType,
      action: order.action || (order.instType === "SWAP" ? "add" : order.side === "sell" ? "reduce" : "add"),
      side: order.positionSide,
      leverage: order.instType === "SWAP" ? snapOkxLeverage(order.leverage, Number(instrument.lever || 1)) : 1,
      notionalUsd: order.quoteValueUsdt,
      feeRate: fee.takerRate
    }, {
      live: true,
      lastPx: Number(ticker?.last || 0),
      markPx: Number(mark?.markPx || ticker?.last || 0),
      feeRate: fee.takerRate,
      fundingRate: Number(fundingRate?.fundingRate || 0),
      instrument
    }, instrument);
    results.push({
      instId: order.instId,
      instType: order.instType,
      side: order.side,
      sz: order.sz,
      status: "applied-to-test-account",
      referencePrice: adjustment.referencePrice,
      executionFee: adjustment.executionFee,
      feeSource: fee.source,
      valuationSource: order.instType === "SWAP" ? "live-public-mark" : "live-public-last",
      adjustment
    });
  }

  appendLog({
    level: "info",
    event: "test_positions_updated",
    message: `Applied ${results.length} changes to the local test account.`,
    meta: { source }
  });

  return { dryRun: false, skipped: false, results };
}

async function reconcileAutomatedTestAccount(plan, settings = {}, options = {}) {
  const accountId = normalizeTestAccountId(options.accountId || "default");
  const dryRun = options.dryRun !== false;
  const suppliedBudget = Number(settings.budgetUsdt);
  const budgetUsdt = clamp(Number.isFinite(suppliedBudget) ? suppliedBudget : 1_000, 0, 10_000_000);
  const targetReturn = clamp(Number(settings.targetReturn || 12), 0.1, 1000);
  const maxDrawdown = clamp(Number(settings.maxDrawdown || 8), 0.1, 100);
  const minOrderUsdt = clamp(Number(settings.minOrderUsdt || 10), 1, budgetUsdt);
  const maxOrderUsdt = clamp(Number(options.maxOrderUsdt || budgetUsdt), minOrderUsdt, budgetUsdt);
  const maxActionsPerCycle = clamp(Number(settings.maxActionsPerCycle || 6), 1, 12);
  const manageExistingPositions = settings.manageExistingPositions !== false;
  const allowNewPositions = settings.allowNewPositions !== false;
  const allowedSymbols = new Set(sanitizeUniverse(settings.symbols || DEFAULT_SYMBOLS));
  const desired = (plan.assets || [])
    .filter((item) => item.symbol !== "USDT" && allowedSymbols.has(item.symbol) && Number(item.targetPct || 0) > 0)
    .slice(0, 6);
  const desiredMap = new Map(desired.map((item) => [item.symbol, item]));
  const account = await loadAccountSummary("test", accountId);
  const results = [];
  const handled = new Set();
  let executedActions = 0;

  for (const position of account.positions || []) {
    const target = desiredMap.get(position.instId);
    const pnlPct = Number(position.uplRatioPct || 0);
    let action = null;
    let reason = "";
    let recommendation = null;
    if (pnlPct >= targetReturn) {
      action = "close";
      reason = `达到目标收益 ${targetReturn}%`;
    } else if (pnlPct <= -maxDrawdown) {
      action = "close";
      reason = `触发最大回撤 ${maxDrawdown}%`;
    } else if (target) {
      const targetNotional = budgetUsdt * Number(target.targetPct || 0) / 100;
      const currentAllocation = position.instType === "SWAP" ? Number(position.margin || 0) : Number(position.notionalUsd || 0);
      if (currentAllocation > targetNotional * 1.25) {
        action = "reduce";
        reason = "持仓高于目标配置 25%";
      }
    }
    if (!action && manageExistingPositions) {
      recommendation = await buildExistingPositionAutomationDecision({
        position,
        account,
        settings,
        minOrderUsdt,
        maxOrderUsdt,
        planned: Boolean(target)
      });
      action = recommendation.action === "watch" ? null : recommendation.action;
      reason = recommendation.reason;
    }
    if (action) {
      if (executedActions >= maxActionsPerCycle) break;
      results.push(await performAutomatedAdjustment({
        accountId,
        instId: position.instId,
        instType: position.instType,
        action,
        side: recommendation?.side || position.posSide,
        leverage: recommendation?.leverage || position.lever,
        notionalUsd: recommendation?.notionalUsd,
        reason,
        dryRun
      }));
      executedActions += 1;
      handled.add(position.instId);
    } else if (recommendation && !target) {
      results.push({
        instId: position.instId,
        instType: position.instType,
        action: "watch",
        operation: "持仓复核",
        status: "held",
        reason: recommendation.reason
      });
    }
  }

  if (!allowNewPositions) {
    appendLog({
      level: "info",
      event: "automation_existing_positions_only",
      message: `Automation for ${accountId} is configured to manage existing positions only.`,
      meta: { accountId, dryRun, results }
    });
    return {
      dryRun,
      skipped: executedActions === 0,
      accountId,
      results,
      account: dryRun ? account : await loadAccountSummary("test", accountId)
    };
  }

  for (const target of desired) {
    if (executedActions >= maxActionsPerCycle) break;
    if (handled.has(target.symbol)) continue;
    const existing = (account.positions || []).find((position) => position.instId === target.symbol);
    const instType = String(target.symbol).endsWith("-SWAP") ? "SWAP" : "SPOT";
    const targetCapital = budgetUsdt * Number(target.targetPct || 0) / 100;
    const currentCapital = instType === "SWAP" ? Number(existing?.margin || 0) : Number(existing?.notionalUsd || 0);
    const deficit = Math.min(maxOrderUsdt, targetCapital - currentCapital);
    if (deficit < minOrderUsdt) continue;
    const recommendation = instType === "SWAP"
      ? await buildAutomationContractRecommendation({ ...target, valueUsdt: deficit }, account)
      : { allowed: true, side: "long", leverage: 1, reason: "目标现货配置不足" };
    if (!recommendation.allowed) {
      results.push({
        instId: target.symbol,
        action: "watch",
        status: "skipped",
        reason: recommendation.reason
      });
      continue;
    }
    if (existing && normalizePosSide(existing) !== recommendation.side) {
      results.push(await performAutomatedAdjustment({
        accountId,
        instId: target.symbol,
        instType,
        action: "close",
        side: existing.posSide,
        leverage: existing.lever,
        reason: "AI 方向改变，先平仓等待下一轮重建方向",
        dryRun
      }));
      executedActions += 1;
      continue;
    }
    results.push(await performAutomatedAdjustment({
      accountId,
      instId: target.symbol,
      instType,
      action: "add",
      side: recommendation.side,
      leverage: recommendation.leverage,
      notionalUsd: instType === "SWAP" ? recommendation.notionalUsd : deficit,
      reason: recommendation.reason,
      dryRun
    }));
    executedActions += 1;
  }

  appendLog({
    level: "info",
    event: "automation_portfolio_reconciled",
    message: `Automation evaluated ${accountId} and produced ${results.length} position actions.`,
    meta: { accountId, dryRun, results }
  });
  return {
    dryRun,
    skipped: executedActions === 0,
    accountId,
    results,
    account: dryRun ? account : await loadAccountSummary("test", accountId)
  };
}

async function buildAutomationContractRecommendation(target, account) {
  const pair = await buildAutomationDirectionPair(target.symbol, Number(target.valueUsdt || 0), account);
  if (!pair.available) return { allowed: false, reason: pair.reason };
  const side = pair.preferredSide;
  const contract = pair[side];
  const hasSizedOrder = Number(contract.recommendation.contracts || 0) > 0 && Number(contract.recommendation.notional || 0) > 0;
  return {
    allowed: contract.recommendation.timing.state === "enter" && hasSizedOrder,
    side,
    leverage: contract.recommendation.leverage,
    notionalUsd: contract.recommendation.notional,
    reason: !hasSizedOrder
      ? "目标预算不足以形成最小合约手数，本轮不自动开仓"
      : contract.recommendation.timing.state === "enter"
        ? `AI 双向对照确认，${side === "short" ? "做空" : "做多"} ${contract.recommendation.leverage}x`
        : `AI 双向对照仍为${contract.recommendation.timing.label}，本轮不自动开仓`
  };
}

async function buildAutomationDirectionPair(instId, capitalBudget, account) {
  const [ticker, candles, instruments, fundingRate, openInterest, fee] = await Promise.all([
    okx.getTicker(instId),
    okx.getCandles(instId, "1H", 120),
    okx.getInstruments("SWAP", instId),
    okx.getFundingRate(instId).catch(() => null),
    okx.getOpenInterest(instId, "SWAP").catch(() => null),
    getTradingFeeEstimate("SWAP", instId)
  ]);
  const instrument = instruments.find((item) => item.state === "live" && item.instId === instId);
  if (!instrument) return { available: false, reason: "真实市场未找到对应永续合约" };
  const marketFlow = await getMarketFlowReference(instId, {
    candles,
    instrument,
    fundingRate: fundingRate || {},
    openInterest: openInterest || {}
  });
  const common = {
    instId,
    ticker: ticker || {},
    candles,
    instrument,
    fundingRate: fundingRate || {},
    openInterest: openInterest || {},
    marketFlow,
    account: { totalEqUsd: account.totalEqUsd, availableUsdt: account.availableUsdt },
    riskPct: 1,
    maxLeverage: Number(instrument.lever || 1),
    capitalBudget: Number(capitalBudget || 0),
    feeRate: fee.takerRate,
    feeSource: fee.source
  };
  const long = buildContractRiskPlan({ ...common, side: "long" });
  const short = buildContractRiskPlan({ ...common, side: "short" });
  const preferredSide = automationContractScore(short) > automationContractScore(long) ? "short" : "long";
  return {
    available: true,
    long,
    short,
    preferredSide,
    marketFlow
  };
}

async function buildExistingPositionAutomationDecision({ position, account, settings, minOrderUsdt, maxOrderUsdt, planned }) {
  const instId = position.instType === "SWAP" ? position.instId : `${position.instId}-SWAP`;
  const currentSide = normalizePosSide(position);
  const oppositeSide = currentSide === "short" ? "long" : "short";
  const adjustmentBudget = Math.min(maxOrderUsdt, Math.max(minOrderUsdt, Number(account.availableUsdt || 0) * 0.1));
  let pair;
  try {
    pair = await buildAutomationDirectionPair(instId, adjustmentBudget, account);
  } catch (error) {
    return { action: "watch", reason: `持仓复核行情暂不可用：${error.message}` };
  }
  if (!pair.available) return { action: "watch", reason: "无对应永续对照行情，继续受止盈止损保护" };
  const heldPlan = pair[currentSide];
  const oppositePlan = pair[oppositeSide];
  const flowAgainstPosition = pair.marketFlow?.aiBias === oppositeSide && pair.marketFlow?.aiLevel === "high";
  const oppositeEntry = oppositePlan.recommendation.timing.state === "enter"
    && Number(oppositePlan.recommendation.contracts || 0) > 0;
  if (flowAgainstPosition && oppositeEntry) {
    return {
      action: "close",
      reason: `AI 强反向确认：${pair.marketFlow.aiJudgment}，优先平仓`,
      side: currentSide,
      leverage: position.lever
    };
  }
  if (pair.preferredSide === oppositeSide && oppositeEntry) {
    return {
      action: "reduce",
      reason: `AI 双向对照更偏向${oppositeSide === "short" ? "做空" : "做多"}，先减仓 25%`,
      side: currentSide,
      leverage: position.lever
    };
  }
  const allowIncrease = settings.allowPositionIncrease !== false;
  const currentCapital = position.instType === "SWAP" ? Number(position.margin || 0) : Number(position.notionalUsd || 0);
  const cap = Number(account.totalEqUsd || 0) * clamp(Number(settings.maxAssetWeight || 35), 5, 90) / 100;
  const heldEntry = heldPlan.recommendation.timing.state === "enter";
  if (!planned && allowIncrease && pair.preferredSide === currentSide && heldEntry && currentCapital < cap * 0.8 && adjustmentBudget >= minOrderUsdt) {
    return {
      action: "add",
      reason: `已有仓位方向获 AI 复核确认，按单币上限内${position.instType === "SWAP" ? "加仓" : "买入"}`,
      side: currentSide,
      leverage: position.instType === "SWAP" ? heldPlan.recommendation.leverage : 1,
      notionalUsd: position.instType === "SWAP" ? heldPlan.recommendation.notional : adjustmentBudget
    };
  }
  return { action: "watch", reason: "当前持仓未出现需要自动调整的确认信号" };
}

function automationContractScore(contract) {
  const timingScore = contract.recommendation.timing.state === "enter" ? 100 : contract.recommendation.timing.state === "watch" ? 30 : 0;
  const flow = contract.market?.orderFlow;
  const flowBias = flow?.aiBias || flow?.direction;
  const flowAdjustment = flowBias === contract.side ? Number(flow?.aiConfidence || flow?.confidence || 0) * 0.35
    : flowBias && flowBias !== "neutral" ? -Number(flow?.aiConfidence || flow?.confidence || 0) * 0.35 : 0;
  return timingScore + flowAdjustment - Number(contract.recommendation.riskScore || 0);
}

async function performAutomatedAdjustment({ accountId, instId, instType, action, side, leverage, notionalUsd, reason, dryRun }) {
  const operation = automatedOperationLabel(instType, action, side);
  if (dryRun) return { instId, instType, action, operation, status: "dry-run", reason };
  const [ticker, instruments, mark, fee, fundingRate] = await Promise.all([
    okx.getTicker(instId),
    okx.getInstruments(instType, instId),
    instType === "SWAP" ? okx.getMarkPrice(instId, instType).catch(() => null) : Promise.resolve(null),
    getTradingFeeEstimate(instType, instId),
    instType === "SWAP" ? okx.getFundingRate(instId).catch(() => null) : Promise.resolve(null)
  ]);
  const instrument = instruments.find((item) => item.state === "live" && item.instId === instId);
  if (!instrument) return { instId, instType, action, status: "skipped", reason: "真实市场中不存在该品种" };
  const adjustment = testAccounts.get(accountId).adjust({
    instId,
    instType,
    action,
    side,
    leverage,
    notionalUsd
  }, {
    live: true,
    lastPx: Number(ticker?.last || 0),
    markPx: Number(mark?.markPx || ticker?.last || 0),
    feeRate: fee.takerRate,
    fundingRate: Number(fundingRate?.fundingRate || 0),
    instrument
  }, instrument);
  return { instId, instType, action, operation, status: "applied-to-test-account", reason, feeSource: fee.source, adjustment };
}

function automatedOperationLabel(instType, action, side) {
  if (action === "close") return instType === "SPOT" ? "卖出/清仓" : "平仓";
  if (action === "reduce") return instType === "SPOT" ? "卖出/减仓" : "减仓";
  if (instType === "SPOT") return "买入/加仓";
  return side === "short" ? "做空/加空" : "做多/加多";
}

function sanitizeOrders(orders) {
  if (!Array.isArray(orders)) return [];
  return orders
    .map((order) => {
      const instId = String(order.instId || "").trim().toUpperCase();
      const instType = instId.endsWith("-SWAP") || order.instType === "SWAP" ? "SWAP" : "SPOT";
      const side = order.side === "sell" ? "sell" : "buy";
      const quoteValue = Number(order.quoteValueUsdt || order.sz || 0);
      if (!/^[A-Z0-9]+-[A-Z0-9]+(?:-SWAP)?$/.test(instId) || quoteValue <= 0) return null;
      return {
        instId,
        instType,
        side,
        positionSide: instType === "SWAP" && order.positionSide === "short" ? "short" : "long",
        action: ["add", "reduce", "close"].includes(order.action) ? order.action : "add",
        leverage: instType === "SWAP" ? snapOkxLeverage(order.leverage) : 1,
        requiredCapitalUsdt: roundMoney(Number(order.requiredCapitalUsdt || quoteValue)),
        contracts: instType === "SWAP" ? Math.max(Number(order.contracts || order.sz || 0), 0) : undefined,
        tdMode: instType === "SWAP" ? "isolated" : "cash",
        ordType: "market",
        tgtCcy: instType === "SPOT" && side === "buy" ? "quote_ccy" : undefined,
        quoteValueUsdt: roundMoney(quoteValue),
        sz: String(instType === "SWAP" ? Math.max(Number(order.contracts || order.sz || 0), 0) : roundMoney(quoteValue))
      };
    })
    .filter(Boolean);
}

async function loadAccountSummary(source = accountSource, accountId = "default") {
  if (normalizeAccountSource(source) === "live-readonly") {
    if (!okx.credentialsStatus().privateReady) {
      throw new Error("真实账户只读模式需要配置具有读取权限的 API key、secret 与 passphrase。");
    }
    const [balances, positionRows] = await Promise.all([
      okx.getBalance(""),
      okx.getPositions("").catch((error) => {
        appendLog({ level: "warn", event: "positions_failed", message: error.message });
        return [];
      })
    ]);
    const symbols = positionRows
      .filter((item) => Number(item.pos || 0) !== 0)
      .map((item) => item.instId);
    const markets = await fetchLiveValuationMarkets(symbols);
    const positions = valuePositions(positionRows.map((item) => ({
      ...item,
      entrySource: "live-account-fill"
    })), markets);
    return summarizeLiveReadonlyAccount(balances, positions);
  }

  const descriptor = testAccounts.descriptor(normalizeTestAccountId(accountId));
  const localTestAccount = testAccounts.get(descriptor.id);
  const state = localTestAccount.snapshot();
  const markets = await fetchLiveValuationMarkets(localTestAccount.symbols());
  return summarizeTestAccount(state, valuePositions(localTestAccount.positions(), markets), descriptor);
}

async function buildAccountsOverview() {
  const credentials = okx.credentialsStatus();
  const accounts = await Promise.all(testAccounts.list().map(async (descriptor) => ({
    id: descriptor.id,
    source: "test",
    label: descriptor.label,
    status: "connected",
    writable: true,
    automation: autopilot.getState(descriptor.id),
    account: await loadAccountSummary("test", descriptor.id)
  })));

  if (!credentials.privateReady) {
    accounts.push({
      id: "live-readonly",
      source: "live-readonly",
      label: "真实账户只读",
      status: "not-configured",
      writable: false,
      automation: null,
      message: "尚未配置真实账户读取权限 API；接入后仅查看余额与持仓。"
    });
  } else {
    try {
      accounts.push({
        id: "live-readonly",
        source: "live-readonly",
        label: "真实账户只读",
        status: "connected",
        writable: false,
        automation: null,
        account: await loadAccountSummary("live-readonly")
      });
    } catch (error) {
      accounts.push({
        id: "live-readonly",
        source: "live-readonly",
        label: "真实账户只读",
        status: "unavailable",
        writable: false,
        automation: null,
        message: `读取失败：${error.message}`
      });
    }
  }

  return {
    defaultSource: accountSource,
    defaultAccountId: "default",
    marketSource: "live-public",
    accounts
  };
}

function ensureWritableTestAccount(source) {
  if (normalizeAccountSource(source) !== "test") {
    throw new Error("当前为真实账户只读模式，不能从界面修改持仓或应用组合计划。");
  }
}

async function fetchLiveValuationMarkets(instIds) {
  const entries = await Promise.all(instIds.map(async (instId) => {
    const instType = String(instId || "").endsWith("-SWAP") ? "SWAP" : "SPOT";
    try {
      const [ticker, instruments, mark, fundingRate] = await Promise.all([
        okx.getTicker(instId),
        okx.getInstruments(instType, instId),
        instType === "SWAP" ? okx.getMarkPrice(instId, instType).catch(() => null) : Promise.resolve(null),
        instType === "SWAP" ? okx.getFundingRate(instId).catch(() => null) : Promise.resolve(null)
      ]);
      const lastPx = Number(ticker?.last || 0);
      const markPx = Number(mark?.markPx || lastPx || 0);
      return [instId, {
        live: markPx > 0,
        instType,
        lastPx,
        markPx,
        fundingRate: Number(fundingRate?.fundingRate || 0),
        instrument: instruments[0] || {}
      }];
    } catch (error) {
      appendLog({
        level: "warn",
        event: "live_valuation_unavailable",
        message: `${instId}: ${error.message}`
      });
      return [instId, { live: false, instType, lastPx: 0, markPx: 0, instrument: {} }];
    }
  }));
  return new Map(entries);
}

function summarizeLiveReadonlyAccount(balanceRows, positionRows = []) {
  const details = [];
  for (const row of balanceRows || []) {
    for (const item of row.details || []) {
      details.push({
        ccy: item.ccy,
        available: Number(item.availBal || item.availEq || 0),
        cashBal: Number(item.cashBal || 0),
        eq: Number(item.eq || 0),
        frozen: Number(item.frozenBal || 0)
      });
    }
  }

  const balances = details
    .filter((item) => item.ccy && (item.available || item.cashBal || item.eq || item.frozen))
    .sort((a, b) => Number(b.eq || b.cashBal || b.available) - Number(a.eq || a.cashBal || a.available));

  const exchangeTotalEqUsd = Number((balanceRows || [])[0]?.totalEq || 0);
  const positions = positionRows.filter((item) => Number(item.pos || 0) !== 0);
  const derivativePositions = positions.filter((item) => item.instType !== "SPOT");
  const exchangeDerivativeUpl = sum(derivativePositions.map((item) => Number(item.exchangeUpl ?? item.upl ?? 0)));
  const liveDerivativeUpl = sum(derivativePositions.map((item) => Number(item.upl || 0)));
  const totalEqUsd = exchangeTotalEqUsd - exchangeDerivativeUpl + liveDerivativeUpl;
  const totalUpl = positions.reduce((total, item) => total + Number(item.upl || 0), 0);
  const usedMargin = positions.reduce((total, item) => total + Number(item.margin || 0), 0);
  const usdt = balances.find((item) => item.ccy === "USDT");
  return {
    accountSource: "live-readonly",
    accountId: "live-readonly",
    accountLabel: "真实账户只读",
    totalEqUsd: roundMoney(totalEqUsd),
    exchangeTotalEqUsd: roundMoney(exchangeTotalEqUsd),
    availableUsdt: roundMoney(Number(usdt?.available || 0)),
    totalUpl: roundMoney(totalUpl),
    uplRatio: totalEqUsd > 0 ? roundMoney(totalUpl / Math.max(totalEqUsd - totalUpl, 1) * 100) : 0,
    usedMargin: roundMoney(usedMargin),
    marginUsagePct: totalEqUsd > 0 ? roundMoney(usedMargin / totalEqUsd * 100) : 0,
    valuationSource: "live-public-market",
    valuationNotice: "账户只读接入；持仓盈亏使用真实公共市场价格在本地重估，本系统不会提交订单。",
    balances,
    positions: positions.map(enrichPosition),
    hedge: summarizeHedge(positions)
  };
}

function summarizeTestAccount(state, positionRows = [], descriptor = { id: "default", label: "默认测试账户" }) {
  const positions = positionRows.filter((item) => Number(item.pos || 0) !== 0);
  const totalUpl = sum(positions.map((item) => Number(item.upl || 0)));
  const spotValue = sum(positions
    .filter((item) => item.instType === "SPOT")
    .map((item) => Number(item.notionalUsd || 0)));
  const derivativeCapital = sum(positions
    .filter((item) => item.instType !== "SPOT")
    .map((item) => Number(item.margin || 0) + Number(item.upl || 0)));
  const usedMargin = sum(positions
    .filter((item) => item.instType !== "SPOT")
    .map((item) => Number(item.margin || 0)));
  const totalEqUsd = Number(state.cashUsdt || 0) + spotValue + derivativeCapital;
  const initialEquityUsdt = Number(state.initialEquityUsdt || 0);
  return {
    accountSource: "test",
    accountId: descriptor.id,
    accountLabel: descriptor.label,
    totalEqUsd: roundMoney(totalEqUsd),
    initialEquityUsdt: roundMoney(initialEquityUsdt),
    availableUsdt: roundMoney(Number(state.cashUsdt || 0)),
    realizedPnl: roundMoney(Number(state.realizedPnl || 0)),
    totalUpl: roundMoney(totalUpl),
    uplRatio: initialEquityUsdt > 0 ? roundMoney((totalEqUsd / initialEquityUsdt - 1) * 100) : 0,
    usedMargin: roundMoney(usedMargin),
    marginUsagePct: totalEqUsd > 0 ? roundMoney(usedMargin / totalEqUsd * 100) : 0,
    valuationSource: "live-public-market-local-test",
    valuationNotice: "仅为本地测试账户：入场基准记录自真实行情，开平仓手续费会扣减测试资金，永续资金费按公开费率估算；不会发送交易所订单。",
    balances: [{
      ccy: "USDT",
      available: roundMoney(Number(state.cashUsdt || 0)),
      cashBal: roundMoney(Number(state.cashUsdt || 0)),
      eq: roundMoney(totalEqUsd),
      frozen: 0
    }],
    positions: positions.map(enrichPosition),
    hedge: summarizeHedge(positions)
  };
}

function enrichPosition(item) {
  const markPx = Number(item.markPx || 0);
  const avgPx = Number(item.avgPx || 0);
  const liqPx = Number(item.liqPx || 0);
  const posSide = normalizePosSide(item);
  const liqDistancePct = markPx > 0 && liqPx > 0 ? Math.abs(markPx - liqPx) / markPx * 100 : 0;
  return {
    ...item,
    uplRatioPct: normalizeRatioPct(Number(item.uplRatio || 0)),
    sideLabel: posSide === "short" ? "空" : "多",
    valuationLabel: item.valuationSource === "live-public-mark"
      ? "真实标记价自算"
      : item.valuationSource === "live-public-last"
        ? "真实最新价自算"
        : "价格待同步",
    entryLabel: item.entrySource === "test-account-reference" ? "测试入场基准" : "账户开仓均价",
    liqLabel: item.liquidationEstimated
      ? "本地估算强平"
      : item.instType === "SPOT"
        ? "现货无强平"
        : "待取得标记价",
    liqDistancePct: roundMoney(liqDistancePct),
    breakEvenGapPct: markPx > 0 && item.bePx > 0 ? roundMoney((markPx / item.bePx - 1) * 100) : 0,
    notionalUsd: roundMoney(Number(item.notionalUsd || Math.abs(Number(item.pos || 0)) * markPx)),
    advice: positionAdvice({ ...item, markPx, avgPx, liqPx, posSide, liqDistancePct })
  };
}

function positionAdvice(item) {
  const pnlPct = normalizeRatioPct(Number(item.uplRatio || 0));
  const sideText = item.posSide === "short" ? "空单" : "多单";
  if (item.liqDistancePct > 0 && item.liqDistancePct <= 4) {
    return `强平距离过近，${sideText}优先减仓或补保证金。`;
  }
  if (pnlPct <= -8) {
    return `${sideText}亏损扩大，等待反弹不如先检查止损/减仓。`;
  }
  if (pnlPct >= 10) {
    return `${sideText}已有明显浮盈，建议上移止损并分批止盈。`;
  }
  if (Math.abs(pnlPct) < 1.5) {
    return `${sideText}接近盈亏平衡，等待下一根确认K线再加仓。`;
  }
  return `${sideText}可继续观察，按计划价位处理。`;
}

function summarizeHedge(positions) {
  const active = positions.filter((item) => Number(item.pos || 0) !== 0);
  const longs = active.filter((item) => normalizePosSide(item) === "long");
  const shorts = active.filter((item) => normalizePosSide(item) === "short");
  const longNotional = sum(longs.map(positionNotional));
  const shortNotional = sum(shorts.map(positionNotional));
  const cross = active.some((item) => String(item.mgnMode || "").toLowerCase() === "cross");
  const maxLeverage = Math.max(0, ...active.map((item) => Number(item.lever || 0)));
  const hedgeRatio = Math.min(longNotional, shortNotional) / Math.max(longNotional, shortNotional, 1);
  const isHedged = longs.length > 0 && shorts.length > 0;
  const severity = isHedged && (cross || maxLeverage >= 50 || hedgeRatio > 0.65) ? "high" : isHedged ? "medium" : "low";

  return {
    active: isHedged,
    severity,
    longCount: longs.length,
    shortCount: shorts.length,
    longNotional: roundMoney(longNotional),
    shortNotional: roundMoney(shortNotional),
    hedgeRatio: roundMoney(hedgeRatio * 100),
    maxLeverage,
    cross,
    text: isHedged
      ? `检测到多空同时持仓：多头约 ${roundMoney(longNotional)} USD，空头约 ${roundMoney(shortNotional)} USD。${cross ? "当前含全仓仓位，同一权益池会同时承担两侧波动和资金费。" : "当前更像方向对冲，但仍会承担资金费、滑点和相关性失效。"}${maxLeverage >= 50 ? ` 最高杠杆 ${maxLeverage}x 偏高，强平距离会非常敏感。` : ""}`
      : "未检测到明显多空对冲。"
  };
}

function normalizePosSide(item) {
  const raw = String(item.posSide || "").toLowerCase();
  if (raw === "short") return "short";
  if (raw === "long") return "long";
  return Number(item.pos || 0) < 0 ? "short" : "long";
}

function positionNotional(item) {
  const explicit = Number(item.notionalUsd || 0);
  if (explicit > 0) return explicit;
  return Math.abs(Number(item.pos || 0)) * Number(item.markPx || item.avgPx || 0);
}

function candleStats(candles) {
  if (!candles.length) return {};
  let high = candles[0];
  let low = candles[0];
  let volumeQuote = 0;
  for (const candle of candles) {
    if (candle.high > high.high) high = candle;
    if (candle.low < low.low) low = candle;
    volumeQuote += Number(candle.volQuote || 0);
  }
  const last = candles.at(-1);
  const first = candles[0];
  return {
    high: high.high,
    highTs: high.ts,
    low: low.low,
    lowTs: low.ts,
    open: first.open,
    close: last.close,
    change: first.open > 0 ? last.close / first.open - 1 : 0,
    volumeQuote: roundMoney(volumeQuote),
    updatedAt: new Date().toISOString()
  };
}

function normalizeBar(value) {
  const allowed = new Set(["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "1W", "1M"]);
  const raw = String(value || "30m").trim();
  const normalized = raw.endsWith("h") ? raw.replace("h", "H") : raw;
  return allowed.has(normalized) ? normalized : "30m";
}

function normalizeInstType(value) {
  const instType = String(value || "SPOT").trim().toUpperCase();
  return ["SPOT", "SWAP"].includes(instType) ? instType : "SPOT";
}

function normalizeAccountSource(value) {
  return String(value || "").toLowerCase() === "live-readonly" ? "live-readonly" : "test";
}

function normalizeTestAccountId(value) {
  const id = String(value || "default").trim();
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) {
    throw new Error("测试账户标识无效。");
  }
  return id;
}

function changeFromTicker(ticker) {
  const last = Number(ticker.last || 0);
  const open = Number(ticker.open24h || 0);
  return open > 0 ? last / open - 1 : 0;
}

async function serveStatic(req, res, url) {
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") relativePath = "/index.html";

  const filePath = path.normalize(path.join(publicDir, relativePath));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function appendLog(entry) {
  auditLog.push({
    ts: new Date().toISOString(),
    level: entry.level || "info",
    event: entry.event || "event",
    message: entry.message || "",
    meta: redact(entry.meta || {})
  });
  if (auditLog.length > 500) auditLog.shift();
}

function safeError(error) {
  if (error instanceof OkxError) {
    return {
      name: error.name,
      message: error.message,
      detail: redact(error.detail || {})
    };
  }
  return {
    name: error.name || "Error",
    message: error.message || "Unknown error",
    detail: redact(error.detail || {})
  };
}

function errorToStatus(error) {
  if (error instanceof OkxError) return 502;
  if (/not found/i.test(error.message || "")) return 404;
  return 400;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/key|secret|passphrase|sign|token/i.test(key)) return [key, "***"];
    return [key, redact(item)];
  }));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeRatioPct(value) {
  if (!Number.isFinite(value)) return 0;
  return roundMoney(Math.abs(value) <= 3 ? value * 100 : value);
}

function sum(values) {
  return values.reduce((total, item) => total + item, 0);
}
