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
import { isStableInstrument } from "./src/stableCoins.js";
import { createLlmProvider } from "./src/llmProvider.js";
import { buildDecisionComparison } from "./src/decisionCompare.js";
import { buildTrendAlignment } from "./src/trendAlignment.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const envPath = path.join(__dirname, ".env");
const auditLogPath = path.join(__dirname, "data", "audit-log.jsonl");
const favoritesPath = path.join(__dirname, "data", "favorites.json");
const automationConfigPath = path.join(__dirname, "data", "automation.json");
const fullPositionTestsPath = path.join(__dirname, "data", "full-position-tests.json");
const fullPositionUniversePath = path.join(__dirname, "data", "full-position-universe.json");
const modelLogsDir = path.join(__dirname, "data", "model-logs");
const modelLogsByModelDir = path.join(__dirname, "data", "model-logs-by-model");
const historicalBacktestsPath = path.join(__dirname, "data", "historical-backtests.json");
const historicalCandlesDir = path.join(__dirname, "data", "historical-candles");

loadEnv(envPath);

const preferredPort = Number(process.env.PORT || 8787);
let activePort = preferredPort;
const okx = createOkxClient();
const auditLog = readAuditLog(auditLogPath);
const feeCache = new Map();
const marketFlowCache = new Map();
const trendAlignmentCache = new Map();
const marketDataCache = new Map();
const ACCOUNTS_OVERVIEW_CACHE_MS = Number(process.env.ACCOUNTS_OVERVIEW_CACHE_MS || 1_000);
const MARKET_DATA_CACHE_MS = Number(process.env.MARKET_DATA_CACHE_MS || 120_000);
const MARKET_DATA_CONCURRENCY = clamp(Number(process.env.MARKET_DATA_CONCURRENCY || 4), 1, 12);
const MARKET_FLOW_CACHE_MS = Number(process.env.MARKET_FLOW_CACHE_MS || 30_000);
const AUTOMATION_DEFAULT_MIN_LEVERAGE = 5;
const TEST_ACCOUNT_DEFAULT_INITIAL_USDT = 1_000_000;
const FULL_POSITION_ACCOUNT_PURPOSE = "full-position-test";
const FULL_POSITION_TEST_SYMBOL_LIMIT = 500;
const FULL_POSITION_TEST_ANALYSIS_LIMIT = 60;
const FULL_POSITION_PRIORITY_SYMBOLS = [
  "BTC-USDT-SWAP",
  "ETH-USDT-SWAP",
  "SOL-USDT-SWAP",
  "LAB-USDT-SWAP"
];
const FULL_POSITION_TEST_DEFAULT_SYMBOLS = [
  "BTC-USDT-SWAP",
  "ETH-USDT-SWAP",
  "SOL-USDT-SWAP",
  "DOGE-USDT-SWAP",
  "PEPE-USDT-SWAP",
  "PUMP-USDT-SWAP",
  "SAHARA-USDT-SWAP"
];
const LEGACY_AUTOMATION_SYMBOL_POOL = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BTC-USDT-SWAP", "ETH-USDT-SWAP"];
let accountsOverviewCache = null;
let accountsOverviewPending = null;
let accountsOverviewCacheVersion = 0;
let fullPositionStoreWrite = Promise.resolve();
let historicalBacktestStoreWrite = Promise.resolve();
const historicalBacktestJobs = new Map();
const accountSource = process.env.OKX_ACCOUNT_SOURCE === "live-readonly" ? "live-readonly" : "test";
const testAccounts = createTestAccountRegistry({
  defaultFilePath: path.join(__dirname, "data", "test-account.json"),
  directoryPath: path.join(__dirname, "data", "test-accounts"),
  catalogPath: path.join(__dirname, "data", "test-accounts", "catalog.json"),
  initialEquity: Number(process.env.TEST_ACCOUNT_INITIAL_USDT || TEST_ACCOUNT_DEFAULT_INITIAL_USDT)
});

const autopilot = createAutopilot({
  runPlan: runFullPlan,
  appendLog
});
const llmProvider = createLlmProvider({ rootDir: __dirname, appendLog });
restoreAutomationConfigs();

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
    const allAutomations = autopilot.getStates();
    const fullPositionIds = fullPositionTestAccountIdsFromStore();
    const ordinaryAutomations = allAutomations.filter((state) => !fullPositionIds.has(state.accountId)
      && (state.accountId !== "default" || state.enabled || state.running || state.lastRunAt || state.lastResult));
    const fullPositionAutomations = allAutomations.filter((state) => fullPositionIds.has(state.accountId));
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
      automations: ordinaryAutomations,
      fullPositionAutomations
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    sendJson(res, 200, { ok: true, logs: currentAuditLog().slice(-120).reverse() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/favorites") {
    sendJson(res, 200, { ok: true, favorites: readFavorites() });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/favorites") {
    const body = await readJson(req);
    const favorites = sanitizeFavoriteIds(body.favorites || body.items || []);
    writeJsonFile(favoritesPath, { version: 1, favorites, updatedAt: new Date().toISOString() });
    appendLog({
      level: "info",
      event: "favorites_updated",
      message: `Saved ${favorites.length} favorite instruments.`,
      meta: { count: favorites.length }
    });
    sendJson(res, 200, { ok: true, favorites });
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

  if (req.method === "GET" && url.pathname === "/api/llm/config") {
    sendJson(res, 200, { ok: true, config: llmProvider.publicConfig() });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/llm/config") {
    const body = await readJson(req);
    const config = llmProvider.saveConfig(body);
    appendLog({
      level: "info",
      event: "llm_config_updated",
      message: `LLM config updated for ${config.provider}/${config.model}.`,
      meta: { provider: config.provider, model: config.model, enabled: config.enabled, configured: config.configured }
    });
    sendJson(res, 200, { ok: true, config });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/llm/test") {
    const test = await llmProvider.testConnection();
    appendLog({
      level: "info",
      event: "llm_connection_tested",
      message: `LLM connection tested with ${test.model}.`,
      meta: { model: test.model, latencyMs: test.latencyMs, usage: test.usage }
    });
    sendJson(res, 200, { ok: true, test, config: llmProvider.publicConfig() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tradingagents/chat") {
    const body = await readJson(req);
    const publicConfig = llmProvider.publicConfig();
    if (!publicConfig.configured) {
      throw new Error("TradingAgents LLM API key is not configured.");
    }
    const messages = normalizeTradingAgentsMessages(body.messages);
    if (!messages.length) throw new Error("TradingAgents chat requires at least one message.");
    const instId = normalizeCompareInstId(body.instId || "BTC-USDT");
    const includeMarket = body.includeMarket !== false;
    const marketContext = includeMarket
      ? await buildTradingAgentsChatContext(instId, body.bar || "15m").catch((error) => ({
        instId,
        error: error.message || "Failed to load market context."
      }))
      : null;
    const promptMessages = [
      {
        role: "system",
        content: [
          "You are an independent TradingAgents-style crypto research assistant for OKX markets.",
          "Answer in Simplified Chinese.",
          "You can discuss long/short/spot/swap ideas, risk, position sizing, and questions from the user.",
          "Do not claim that an order has been executed. Do not call or rely on local Skills in this chat endpoint.",
          "When data is insufficient, say what is missing and prefer watch/hold over forced predictions."
        ].join(" ")
      },
      ...(marketContext ? [{
        role: "user",
        content: `以下是实时市场上下文，仅供分析参考，不代表 Skills 结论：\n${JSON.stringify(marketContext)}`
      }] : []),
      ...messages
    ];
    const reply = await llmProvider.chat(promptMessages, {
      maxTokens: clamp(Number(body.maxTokens || publicConfig.maxTokens || 1000), 200, 2200),
      timeoutMs: 60_000
    });
    appendLog({
      level: "info",
      event: "tradingagents_chat",
      message: `TradingAgents chat completed for ${instId}.`,
      meta: { instId, model: reply.model, latencyMs: reply.latencyMs, includeMarket }
    });
    sendJson(res, 200, {
      ok: true,
      reply: {
        role: "assistant",
        content: reply.content,
        model: reply.model,
        usage: reply.usage,
        latencyMs: reply.latencyMs,
        createdAt: new Date().toISOString()
      },
      config: llmProvider.publicConfig()
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

  if (req.method === "GET" && url.pathname === "/api/accounts/detail") {
    const overview = await buildAccountsOverview();
    sendJson(res, 200, {
      ok: true,
      detail: {
        ...overview,
        operations: buildAccountOperations(overview.accounts)
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/full-position-tests") {
    sendJson(res, 200, {
      ok: true,
      suites: await getFullPositionSuites()
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/full-position-tests/run") {
    const body = await readJson(req);
    const suite = await runFullPositionParameterTest(body || {});
    sendJson(res, 200, {
      ok: true,
      suite
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/full-position-tests/stop") {
    const body = await readJson(req);
    const suite = await stopFullPositionSuite(body || {});
    sendJson(res, 200, {
      ok: true,
      suite
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/model-logs") {
    sendJson(res, 200, {
      ok: true,
      logs: readModelLogs({
        scope: url.searchParams.get("scope"),
        runId: url.searchParams.get("runId"),
        modelId: url.searchParams.get("modelId"),
        limit: Number(url.searchParams.get("limit") || 40)
      })
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/historical-backtests") {
    sendJson(res, 200, {
      ok: true,
      runs: await getHistoricalBacktests()
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/historical-backtests/run") {
    const body = await readJson(req);
    const run = await startHistoricalBacktest(body || {});
    sendJson(res, 202, { ok: true, run });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/historical-backtests/stop") {
    const body = await readJson(req);
    const run = await stopHistoricalBacktest(body || {});
    sendJson(res, 200, { ok: true, run });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test-accounts/purge") {
    const body = await readJson(req);
    const result = await purgeLocalTestAccounts({
      preserveFullPosition: body.preserveFullPosition !== false,
      resetDefault: body.resetDefault !== false,
      defaultEquityUsdt: Number(body.defaultEquityUsdt || TEST_ACCOUNT_DEFAULT_INITIAL_USDT)
    });
    sendJson(res, 200, { ok: true, result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test-accounts") {
    const body = await readJson(req);
    const descriptor = testAccounts.create({
      label: body.label,
      initialEquityUsdt: body.initialEquityUsdt
    });
    appendLog({
      level: "info",
      event: "test_account_created",
      message: `Created test account ${descriptor.label}.`,
      meta: {
        accountId: descriptor.id,
        accountLabel: descriptor.label,
        initialEquityUsdt: Number(body.initialEquityUsdt || 0)
      }
    });
    invalidateAccountsOverviewCache();
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
    removeAutomationConfig(id);
    invalidateAccountsOverviewCache();
    appendLog({
      level: "info",
      event: "test_account_deleted",
      message: `Deleted test account ${id}.`,
      meta: { accountId: id }
    });
    sendJson(res, 200, { ok: true, overview: await buildAccountsOverview() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test-account/reset") {
    const body = await readJson(req);
    const accountId = normalizeTestAccountId(body.accountId || "default");
    testAccounts.get(accountId).reset(Number(body.initialEquityUsdt || process.env.TEST_ACCOUNT_INITIAL_USDT || TEST_ACCOUNT_DEFAULT_INITIAL_USDT));
    invalidateAccountsOverviewCache();
    appendLog({
      level: "info",
      event: "test_account_reset",
      message: `Reset test account ${accountId}.`,
      meta: {
        accountId,
        initialEquityUsdt: Number(body.initialEquityUsdt || process.env.TEST_ACCOUNT_INITIAL_USDT || TEST_ACCOUNT_DEFAULT_INITIAL_USDT)
      }
    });
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
    appendLog({
      level: "info",
      event: "test_position_adjusted",
      message: `Adjusted ${instId} on test account ${accountId}.`,
      meta: {
        source: "manual",
        accountId,
        results: [{
          instId,
          instType,
          action: ["add", "reduce", "close"].includes(body.action) ? body.action : "add",
          operation: automatedOperationLabel(
            instType,
            ["add", "reduce", "close"].includes(body.action) ? body.action : "add",
            body.side === "short" ? "short" : "long"
          ),
          status: "applied-to-test-account",
          reason: "Manual position adjustment",
          adjustment
        }]
      }
    });
    invalidateAccountsOverviewCache();
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
    const symbols = sanitizeUniverse(url.searchParams.get("symbols") || DEFAULT_SYMBOLS.join(","), { max: 500 });
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

  if (req.method === "POST" && url.pathname === "/api/ai/compare") {
    const body = await readJson(req);
    const comparison = await compareDecisionEngines(body);
    sendJson(res, 200, { ok: true, comparison, config: llmProvider.publicConfig() });
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
    body.settings = sanitizeAutomationSettings(body.settings || {});
    const state = await autopilot.configure(body);
    saveAutomationConfig(targetAccountId, state);
    invalidateAccountsOverviewCache();
    sendJson(res, 200, { ok: true, autopilot: state });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/autopilot/run") {
    const body = await readJson(req);
    const targetAccountId = normalizeTestAccountId(body.accountId || "default");
    testAccounts.descriptor(targetAccountId);
    const result = await autopilot.runOnce("manual", targetAccountId);
    invalidateAccountsOverviewCache();
    sendJson(res, 200, { ok: true, result, autopilot: autopilot.getState(targetAccountId) });
    return;
  }

  sendJson(res, 404, { ok: false, error: { message: "API route not found." } });
}

async function analyze(settings = {}) {
  const { symbols, plan } = await buildAnalysisContext(settings);

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

async function buildAnalysisContext(settings = {}) {
  const symbols = await resolveAnalysisSymbols(settings);
  const lookbackDays = clamp(Number(settings.lookbackDays || 90), 30, 300);
  const marketData = await fetchMarketData(symbols, lookbackDays);
  const plan = await enrichPlanCosts(buildInvestmentPlan(marketData, settings));
  return { symbols, lookbackDays, marketData, plan };
}

async function resolveAnalysisSymbols(settings = {}) {
  const symbolLimit = clamp(Number(settings.symbolLimit || 80), 16, 500);
  const explicit = sanitizeExplicitUniverse(settings.symbols, symbolLimit);
  if (explicit.length && !isLegacyAutomationSymbolPool(explicit)) return explicit;
  const dynamic = await buildDefaultAnalysisUniverse(settings).catch((error) => {
    appendLog({
      level: "warn",
      event: "dynamic_universe_failed",
      message: `Dynamic universe fallback: ${error.message}`
    });
    return [];
  });
  return dynamic.length ? sanitizeUniverse(dynamic, { max: symbolLimit }) : sanitizeUniverse(DEFAULT_SYMBOLS);
}

async function buildDefaultAnalysisUniverse(settings = {}) {
  const preference = ["spot", "swap", "both"].includes(String(settings.productPreference))
    ? String(settings.productPreference)
    : "both";
  const instTypes = preference === "spot" ? ["SPOT"] : preference === "swap" ? ["SWAP"] : ["SPOT", "SWAP"];
  const excludeNew = settings.excludeNewCoins !== false;
  const limitPerType = preference === "both" ? 8 : 14;
  const groups = await Promise.all(instTypes.map(async (instType) => {
    const [instruments, tickers] = await Promise.all([
      okx.getInstruments(instType),
      okx.getTickers(instType)
    ]);
    const universe = buildUniverse({
      instruments,
      tickers,
      instType,
      quoteCcy: "USDT",
      excludeNew,
      minAgeDays: 30,
      limit: Math.max(limitPerType * 3, 24)
    });
    return [...(universe.recommended || []), ...(universe.candidates || [])]
      .map((item) => item.instId)
      .filter(Boolean)
      .slice(0, limitPerType);
  }));
  return sanitizeUniverse(groups.flat());
}

async function compareDecisionEngines(input = {}) {
  const selectedInstId = normalizeCompareInstId(input.instId || input.symbol || "BTC-USDT");
  const settings = sanitizeComparisonSettings(input.settings || input);
  const source = normalizeAccountSource(input.accountSource || accountSource);
  const accountId = normalizeTestAccountId(input.accountId || "default");
  const symbols = sanitizeUniverse([
    selectedInstId,
    ...(sanitizeUniverse(settings.symbols || DEFAULT_SYMBOLS).slice(0, 10))
  ]);
  const lookbackDays = clamp(Number(settings.lookbackDays || 90), 30, 300);
  const [account, marketData] = await Promise.all([
    loadAccountSummary(source, accountId),
    fetchMarketData(symbols, lookbackDays)
  ]);
  const plan = await enrichPlanCosts(buildInvestmentPlan(marketData, {
    ...settings,
    symbols: symbols.join(",")
  }));
  const marketFlow = await tryLoadCompareMarketFlow(selectedInstId);
  const comparison = await buildDecisionComparison({
    selectedInstId,
    settings,
    account,
    plan,
    marketData,
    marketFlow,
    llmProvider
  });
  appendLog({
    level: "info",
    event: "ai_engine_comparison",
    message: `Compared Skills, TradingAgents, and hybrid decision engines for ${selectedInstId}.`,
    meta: {
      accountId,
      instId: selectedInstId,
      mode: comparison.mode,
      selectedAction: comparison.selected?.action,
      selectedSide: comparison.selected?.side
    }
  });
  return comparison;
}

async function tryLoadCompareMarketFlow(instId) {
  const swapId = String(instId || "").endsWith("-SWAP")
    ? String(instId).toUpperCase()
    : `${String(instId || "").toUpperCase().replace(/-USDT$/, "")}-USDT-SWAP`;
  try {
    const [candles, instruments, fundingRate, openInterest] = await Promise.all([
      okx.getCandles(swapId, "1H", 80),
      okx.getInstruments("SWAP", swapId),
      okx.getFundingRate(swapId).catch(() => null),
      okx.getOpenInterest(swapId, "SWAP").catch(() => null)
    ]);
    const instrument = instruments.find((item) => item.state === "live" && item.instId === swapId);
    if (!instrument) return null;
    return await getMarketFlowReference(swapId, {
      candles,
      instrument,
      fundingRate: fundingRate || {},
      openInterest: openInterest || {}
    });
  } catch {
    return null;
  }
}

function sanitizeComparisonSettings(settings = {}) {
  return {
    ...settings,
    budgetUsdt: clamp(Number(settings.budgetUsdt || 1000), 0, 10_000_000),
    lookbackDays: clamp(Number(settings.lookbackDays || 90), 30, 300),
    riskLevel: clamp(Number(settings.riskLevel || 5), 1, 10),
    targetReturn: clamp(Number(settings.targetReturn || 12), 0.1, 1000),
    maxDrawdown: clamp(Number(settings.maxDrawdown || 8), 0.1, 100),
    minLeverage: snapOkxLeverage(Math.max(Number(settings.minLeverage || AUTOMATION_DEFAULT_MIN_LEVERAGE), AUTOMATION_DEFAULT_MIN_LEVERAGE)),
    maxLeverage: snapOkxLeverage(Number(settings.maxLeverage || 5)),
    decisionEngine: ["skills", "tradingagents", "hybrid"].includes(String(settings.decisionEngine))
      ? String(settings.decisionEngine)
      : "hybrid",
    tradingAgentsWeight: clamp(Number(settings.tradingAgentsWeight ?? 50), 0, 100),
    forceTradingAgents: Boolean(settings.forceTradingAgents)
  };
}

function normalizeDecisionMode(value) {
  const mode = String(value || "").toLowerCase();
  return ["skills", "tradingagents", "hybrid"].includes(mode) ? mode : "hybrid";
}

function normalizeCompareInstId(value) {
  const raw = String(value || "BTC-USDT").trim().toUpperCase();
  if (!raw.includes("-") && /^[A-Z0-9]+$/.test(raw)) return `${raw}-USDT`;
  return raw;
}

function normalizeTradingAgentsMessages(input) {
  const allowed = new Set(["user", "assistant", "system"]);
  return (Array.isArray(input) ? input : [])
    .map((item) => ({
      role: allowed.has(String(item?.role || "").toLowerCase()) ? String(item.role).toLowerCase() : "user",
      content: String(item?.content || "").trim().slice(0, 4000)
    }))
    .filter((item) => item.content)
    .slice(-16);
}

async function buildTradingAgentsChatContext(instId, requestedBar = "15m") {
  const bar = normalizeBar(requestedBar);
  const [tickerResult, candlesResult, flowResult] = await Promise.allSettled([
    okx.getTicker(instId),
    okx.getCandles(instId, bar, 120),
    tryLoadCompareMarketFlow(instId)
  ]);
  const ticker = tickerResult.status === "fulfilled" ? tickerResult.value : null;
  const candles = candlesResult.status === "fulfilled" ? candlesResult.value : [];
  const indicatorPack = candles.length ? buildIndicatorPack(candles, ticker || {}) : null;
  const macd = indicatorPack?.macd || {};
  const histogram = Array.isArray(macd.histogram) ? macd.histogram.filter((item) => Number.isFinite(item)) : [];
  const lastHist = histogram.at(-1) || 0;
  const prevHist = histogram.at(-2) || 0;
  return {
    instId,
    bar,
    marketSource: "live-public",
    ticker: ticker ? {
      last: Number(ticker.last || 0),
      open24h: Number(ticker.open24h || 0),
      high24h: Number(ticker.high24h || 0),
      low24h: Number(ticker.low24h || 0),
      volCcy24h: Number(ticker.volCcy24h || 0),
      volQuote24h: Number(ticker.volCcyQuote24h || 0)
    } : null,
    candleStats: candleStats(candles),
    recentCandles: candles.slice(-30).map((candle) => ({
      ts: candle.ts,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volQuote: candle.volQuote || candle.vol || 0
    })),
    indicators: indicatorPack ? {
      summary: indicatorPack.indicators?.summary || null,
      macd: {
        dif: Number(macd.macd?.at?.(-1) || 0),
        dea: Number(macd.signal?.at?.(-1) || 0),
        histogram: lastHist,
        cross: prevHist <= 0 && lastHist > 0 ? "golden" : prevHist >= 0 && lastHist < 0 ? "death" : "none"
      },
      topRows: [
        ...(indicatorPack.indicators?.oscillators || []),
        ...(indicatorPack.indicators?.movingAverages || [])
      ].slice(0, 12)
    } : null,
    marketFlow: flowResult.status === "fulfilled" ? flowResult.value : null,
    failures: [
      tickerResult.status === "rejected" ? `ticker: ${tickerResult.reason?.message || "failed"}` : "",
      candlesResult.status === "rejected" ? `candles: ${candlesResult.reason?.message || "failed"}` : "",
      flowResult.status === "rejected" ? `marketFlow: ${flowResult.reason?.message || "failed"}` : ""
    ].filter(Boolean)
  };
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
  if (cached && Date.now() - cached.at < MARKET_FLOW_CACHE_MS) {
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

async function getTrendAlignmentReference(instId, { candles1h = [] } = {}) {
  const cached = trendAlignmentCache.get(instId);
  if (cached && Date.now() - cached.at < 60_000) {
    return cached.value || cached.pending;
  }
  const pending = Promise.all([
    okx.getCandles(instId, "15m", 120).catch(() => []),
    Promise.resolve(Array.isArray(candles1h) ? candles1h : []),
    okx.getCandles(instId, "4H", 120).catch(() => []),
    okx.getCandles(instId, "1D", 120).catch(() => [])
  ]).then(([candles15m, candles1H, candles4H, candles1D]) => {
    const value = buildTrendAlignment({
      "15m": candles15m,
      "1H": candles1H,
      "4H": candles4H,
      "1D": candles1D
    });
    trendAlignmentCache.set(instId, { at: Date.now(), value });
    return value;
  });
  trendAlignmentCache.set(instId, { at: Date.now(), pending });
  return pending;
}

async function loadContractPlanContext(url) {
  const base = String(url.searchParams.get("instId") || "BTC-USDT-SWAP").trim().toUpperCase();
  const instId = base.endsWith("-SWAP") ? base : `${base.replace(/-USDT$/, "")}-USDT-SWAP`;
  const riskPct = clamp(Number(url.searchParams.get("riskPct") || 1), 0.1, 10);
  const minLeverage = clamp(Number(url.searchParams.get("minLeverage") || AUTOMATION_DEFAULT_MIN_LEVERAGE), 1, 50);
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
  const [marketFlow, trendAlignment] = await Promise.all([
    getMarketFlowReference(instId, {
      candles,
      instrument,
      fundingRate: fundingRate || {},
      openInterest: openInterest || {}
    }),
    getTrendAlignmentReference(instId, { candles1h: candles })
  ]);
  return {
    instId,
    ticker: ticker || {},
    candles,
    instrument,
    fundingRate: fundingRate || {},
    openInterest: openInterest || {},
    marketFlow,
    trendAlignment,
    account: {
      totalEqUsd: account.totalEqUsd,
      availableUsdt: account.availableUsdt
    },
    riskPct,
    minLeverage,
    maxLeverage,
    capitalBudget,
    feeRate: fee.takerRate,
    feeSource: fee.source
  };
}

async function fetchMarketData(symbols, limit = 90) {
  const normalizedSymbols = sanitizeUniverse(symbols, { max: 500 });
  const normalizedLimit = clamp(Number(limit || 90), 1, 300);
  const cacheKey = `${normalizedLimit}:${normalizedSymbols.slice().sort().join(",")}`;
  const cached = marketDataCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= MARKET_DATA_CACHE_MS) {
    return clonePayload(cached.value || await cached.pending);
  }

  const instTypes = [...new Set(normalizedSymbols.map((symbol) => symbol.endsWith("-SWAP") ? "SWAP" : "SPOT"))];
  const tickerResults = await Promise.all(instTypes.map(async (instType) => {
    try {
      return await okx.getTickers(instType);
    } catch (error) {
      appendLog({
        level: "warn",
        event: "market_tickers_failed",
        message: `${instType}: ${error.message}`
      });
      return [];
    }
  }));
  const tickerMap = new Map(tickerResults.flatMap((rows) => rows.map((row) => [row.instId, row])));

  const pending = mapWithConcurrency(normalizedSymbols, MARKET_DATA_CONCURRENCY, async (symbol) => {
    try {
      const ticker = tickerMap.get(symbol) || {};
      const candles = await okx.getCandles(symbol, "1D", normalizedLimit);
      return [symbol, { ticker, candles }];
    } catch (error) {
      appendLog({
        level: "warn",
        event: "market_fetch_failed",
        message: `${symbol}: ${error.message}`
      });
      return [symbol, { error: safeError(error), candles: [] }];
    }
  }).then((entries) => Object.fromEntries(entries));

  marketDataCache.set(cacheKey, { at: Date.now(), pending });
  const value = await pending;
  marketDataCache.set(cacheKey, { at: Date.now(), value });
  return clonePayload(value);
}

async function runFullPlan({ settings, executionMode, dryRun, reason, accountId = "default" }) {
  const targetAccountId = normalizeTestAccountId(accountId);
  const account = await loadAccountSummary("test", targetAccountId);
  const effectiveSettings = resolveAutomationAccountSettings(settings, account);
  const baseSymbols = await resolveAnalysisSymbols(effectiveSettings);
  const symbolLimit = clamp(Number(effectiveSettings.symbolLimit || 80), 16, 500);
  const symbols = sanitizeUniverse([
    ...baseSymbols,
    ...automationPositionSymbols(account.positions || [], effectiveSettings.productPreference)
  ], { max: symbolLimit });
  const analysis = await buildAnalysisContext({ ...effectiveSettings, symbols: symbols.join(",") });
  const overlay = await applyTradingAgentsAutomationOverlay({
    plan: analysis.plan,
    settings: effectiveSettings,
    account,
    marketData: analysis.marketData,
    accountId: targetAccountId
  });
  const plan = overlay.plan;
  const executionSettings = {
    ...effectiveSettings,
    symbols: symbols.join(","),
    automationDecisionOverrides: overlay.overrides
  };
  const shouldExecute = executionMode === "auto";
  const execution = shouldExecute
    ? await reconcileAutomatedTestAccount(plan, executionSettings, {
        dryRun,
        accountId: targetAccountId,
        maxOrderUsdt: Number(effectiveSettings.maxOrderUsdt || effectiveSettings.budgetUsdt || account.availableUsdt || 500)
      })
    : {
        dryRun: true,
        skipped: true,
        reason: executionMode,
        results: []
      };

  const result = { reason, plan, execution };
  await recordFullPositionRunSample(targetAccountId, result).catch((error) => {
    appendLog({
      level: "warn",
      event: "full_position_sample_failed",
      message: `${targetAccountId}: ${error.message}`,
      meta: { accountId: targetAccountId }
    });
  });
  return result;
}

function resolveAutomationAccountSettings(settings = {}, account = {}) {
  const normalized = sanitizeAutomationSettings(settings);
  const available = Number(account.availableUsdt || 0);
  const requestedBudget = Number(normalized.budgetUsdt || 0);
  const budgetUsdt = normalized.autoBudget !== false
    ? available
    : requestedBudget > 0
      ? Math.min(requestedBudget, available > 0 ? available : requestedBudget)
      : available;
  return {
    ...normalized,
    budgetUsdt: clamp(budgetUsdt > 0 ? budgetUsdt : requestedBudget, 0, 10_000_000)
  };
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
      positionSide: order.positionSide,
      action: order.action || (order.instType === "SWAP" ? "add" : order.side === "sell" ? "reduce" : "add"),
      operation: automatedOperationLabel(
        order.instType,
        order.action || (order.instType === "SWAP" ? "add" : order.side === "sell" ? "reduce" : "add"),
        order.positionSide
      ),
      sz: order.sz,
      notionalUsd: order.quoteValueUsdt,
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
    meta: {
      source,
      accountId: normalizeTestAccountId(options.accountId || "default"),
      results
    }
  });
  invalidateAccountsOverviewCache();

  return { dryRun: false, skipped: false, results };
}

async function applyTradingAgentsAutomationOverlay({ plan, settings = {}, account, marketData = {}, accountId = "default" }) {
  const mode = normalizeDecisionMode(settings.decisionEngine || "skills");
  const llmConfig = llmProvider.publicConfig();
  if (mode === "skills") {
    return { plan, overrides: {}, comparisons: [] };
  }
  if (!llmConfig.configured || (!llmConfig.enabled && settings.forceTradingAgents !== true)) {
    return {
      plan: {
        ...plan,
        notes: [
          ...(plan.notes || []),
          "TradingAgents 未启用或未配置，本轮自动化仅使用 Skills 风控执行。"
        ],
        automationAiReview: {
          enabled: false,
          mode,
          reason: "llm_unavailable"
        }
      },
      overrides: {},
      comparisons: []
    };
  }

  const maxChecks = clamp(Number(settings.tradingAgentsMaxChecks || 4), 1, 8);
  const minConfidence = clamp(Number(settings.minConfidence || 0), 0, 100);
  const candidates = automationDecisionCandidates(plan, account).slice(0, maxChecks);
  if (!candidates.length) return { plan, overrides: {}, comparisons: [] };

  const comparisons = [];
  const overrides = {};
  const assets = (plan.assets || []).map((asset) => ({ ...asset }));
  const assetMap = new Map(assets.map((asset) => [asset.symbol, asset]));

  for (const instId of candidates) {
    try {
      const marketFlow = await tryLoadCompareMarketFlow(instId);
      const comparison = await buildDecisionComparison({
        selectedInstId: instId,
        settings: sanitizeComparisonSettings({
          ...settings,
          decisionEngine: mode,
          forceTradingAgents: true
        }),
        account,
        plan,
        marketData,
        marketFlow,
        llmProvider
      });
      const selected = comparison.selected;
      const override = summarizeAutomationDecision(comparison, minConfidence);
      overrides[instId] = override;
      comparisons.push(override);

      const asset = assetMap.get(instId);
      if (asset) {
        applyDecisionToAsset(asset, override, plan, settings);
      }
    } catch (error) {
      const override = {
        instId,
        available: false,
        allowed: false,
        action: "watch",
        side: "neutral",
        confidence: 0,
        targetPct: 0,
        allocationUsdt: 0,
        veto: true,
        summary: `TradingAgents 复核失败：${error.message}`,
        reasons: [`TradingAgents 复核失败：${error.message}`],
        riskNotes: ["本轮该标的不会因 TradingAgents 复核而新增仓位。"]
      };
      overrides[instId] = override;
      comparisons.push(override);
    }
  }

  const adjustedPlan = rebuildPlanAfterAutomationReview(plan, assets, settings, comparisons, mode);
  appendLog({
    level: "info",
    event: "automation_tradingagents_review",
    message: `TradingAgents reviewed ${comparisons.length} automation candidates for ${accountId}.`,
    meta: {
      accountId,
      mode,
      checks: comparisons.length,
      allowed: comparisons.filter((item) => item.allowed).length,
      blocked: comparisons.filter((item) => !item.allowed).length
    }
  });

  return { plan: adjustedPlan, overrides, comparisons };
}

function automationDecisionCandidates(plan, account) {
  const seen = new Set();
  const output = [];
  for (const asset of plan.assets || []) {
    if (Number(asset.targetPct || 0) <= 0) continue;
    add(asset.symbol);
  }
  for (const order of plan.orderPlan || []) add(order.instId);
  for (const position of account?.positions || []) add(position.instId);
  return output;

  function add(instId) {
    const normalized = String(instId || "").trim().toUpperCase();
    if (!normalized || seen.has(normalized) || isStableInstrument(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  }
}

function summarizeAutomationDecision(comparison, minConfidence) {
  const selected = comparison.selected || {};
  const confidence = Math.round(clamp(Number(selected.confidence || 0), 0, 100));
  const action = ["buy", "sell", "hold", "watch"].includes(selected.action) ? selected.action : "watch";
  const side = ["long", "short", "neutral"].includes(selected.side) ? selected.side : "neutral";
  const actionable = selected.available !== false
    && !selected.veto
    && confidence >= minConfidence
    && !["hold", "watch"].includes(action)
    && side !== "neutral";
  return {
    instId: comparison.instId,
    mode: comparison.mode,
    engine: selected.engine,
    available: selected.available !== false,
    allowed: Boolean(actionable),
    action,
    side,
    product: selected.product || "both",
    confidence,
    score: Math.round(clamp(Number(selected.score || 0), 0, 100)),
    targetPct: roundMoney(clamp(Number(selected.targetPct || 0), 0, 100)),
    allocationUsdt: roundMoney(Math.max(Number(selected.allocationUsdt || 0), 0)),
    takeProfit: Number(selected.takeProfit || 0),
    stopLoss: Number(selected.stopLoss || 0),
    veto: Boolean(selected.veto),
    conflict: Boolean(selected.conflict),
    summary: selected.summary || "TradingAgents 已完成自动化复核。",
    reasons: (selected.reasons || []).slice(0, 4),
    riskNotes: (selected.riskNotes || []).slice(0, 4),
    model: selected.model,
    provider: selected.provider,
    weight: selected.weight,
    notes: comparison.notes || []
  };
}

function applyDecisionToAsset(asset, decision, plan, settings = {}) {
  const budgetUsdt = Number(plan.budgetUsdt || settings.budgetUsdt || 0);
  const maxAssetWeight = clamp(Number(settings.maxAssetWeight || plan.maxAssetWeight || 35), 1, 90);
  const isSwap = String(asset.symbol || "").endsWith("-SWAP");
  const canUseShort = isSwap && decision.side === "short";
  const canUseLong = decision.side === "long" || (asset.symbol && !isSwap && decision.action === "buy");
  const allowed = decision.allowed && (canUseLong || canUseShort);
  const originalTargetPct = Number(asset.targetPct || 0);
  const decisionTargetPct = Number(decision.targetPct || originalTargetPct || 0);
  const nextTargetPct = allowed
    ? clamp(decisionTargetPct || originalTargetPct, 0, maxAssetWeight)
    : 0;

  asset.automationDecision = decision;
  asset.preferredSide = canUseShort ? "short" : "long";
  asset.weight = nextTargetPct / 100;
  asset.targetPct = roundMoney(nextTargetPct);
  asset.valueUsdt = roundMoney(budgetUsdt * asset.weight);
  asset.reason = [
    asset.reason,
    allowed
      ? `TradingAgents 复核放行：${decision.side === "short" ? "做空" : "做多"}，置信度 ${decision.confidence}%`
      : `TradingAgents 复核拦截：${decision.summary}`
  ].filter(Boolean).join("；");
}

function rebuildPlanAfterAutomationReview(plan, assets, settings, comparisons, mode) {
  const budgetUsdt = Number(plan.budgetUsdt || settings.budgetUsdt || 0);
  const minOrderUsdt = clamp(Number(settings.minOrderUsdt || plan.minOrderUsdt || 10), 1, 1_000_000);
  const orderPlan = assets
    .filter((asset) => Number(asset.targetPct || 0) > 0 && Number(asset.valueUsdt || 0) >= minOrderUsdt)
    .map((asset) => {
      const instType = String(asset.symbol || "").endsWith("-SWAP") ? "SWAP" : "SPOT";
      const positionSide = instType === "SWAP" && asset.preferredSide === "short" ? "short" : "long";
      return {
        instId: asset.symbol,
        instType,
        side: instType === "SWAP" && positionSide === "short" ? "sell" : "buy",
        positionSide: instType === "SWAP" ? positionSide : undefined,
        action: "add",
        leverage: instType === "SWAP" ? snapOkxLeverage(settings.maxLeverage || 5) : 1,
        tdMode: instType === "SWAP" ? "isolated" : "cash",
        ordType: "market",
        tgtCcy: instType === "SPOT" ? "quote_ccy" : undefined,
        quoteValueUsdt: roundMoney(asset.valueUsdt),
        requiredCapitalUsdt: roundMoney(asset.valueUsdt),
        sz: String(roundMoney(asset.valueUsdt)),
        reason: asset.reason
      };
    });
  const invested = sum(assets.map((asset) => Number(asset.valueUsdt || 0)));
  const cashWeight = budgetUsdt > 0 ? clamp(1 - invested / budgetUsdt, 0, 1) : 1;
  const blocked = comparisons.filter((item) => !item.allowed).length;
  const allowed = comparisons.filter((item) => item.allowed).length;
  return {
    ...plan,
    assets,
    orderPlan,
    cashReserve: cashWeight,
    cashValueUsdt: roundMoney(cashWeight * budgetUsdt),
    allocations: [
      ...assets
        .filter((asset) => Number(asset.targetPct || 0) > 0)
        .map((asset) => ({
          symbol: asset.symbol,
          weight: Number(asset.weight || 0),
          targetPct: Number(asset.targetPct || 0),
          valueUsdt: Number(asset.valueUsdt || 0),
          last: asset.last,
          side: asset.preferredSide || "long"
        })),
      { symbol: "USDT", weight: cashWeight, targetPct: roundMoney(cashWeight * 100), valueUsdt: roundMoney(cashWeight * budgetUsdt), last: 1 }
    ],
    automationAiReview: {
      enabled: true,
      mode,
      generatedAt: new Date().toISOString(),
      allowed,
      blocked,
      comparisons
    },
    notes: [
      ...(plan.notes || []),
      `TradingAgents 已复核 ${comparisons.length} 个自动化候选：放行 ${allowed} 个，拦截/观察 ${blocked} 个。`
    ]
  };
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
  const minConfidence = clamp(Number(settings.minConfidence || 0), 0, 100);
  const manageExistingPositions = settings.manageExistingPositions !== false;
  const allowNewPositions = settings.allowNewPositions !== false;
  const allowedSymbols = new Set(sanitizeUniverse(settings.symbols || DEFAULT_SYMBOLS, { max: clamp(Number(settings.symbolLimit || 80), 16, 500) }));
  const desired = (plan.assets || [])
    .filter((item) => !isStableInstrument(item.symbol)
      && allowedSymbols.has(item.symbol)
      && matchesProductPreferenceSymbol(item.symbol, settings.productPreference)
      && Number(item.targetPct || 0) > 0)
    .slice(0, 6);
  const desiredMap = new Map(desired.map((item) => [item.symbol, item]));
  const account = await loadAccountSummary("test", accountId);
  const results = [];
  const handled = new Set();
  let executedActions = 0;

  if (Number(plan.confidence || 0) < minConfidence) {
    results.push({
      action: "watch",
      operation: "AI 风控等待",
      status: "skipped",
      reason: `计划置信度 ${Number(plan.confidence || 0)}% 低于账户阈值 ${minConfidence}%`
    });
    appendLog({
      level: "info",
      event: "automation_confidence_gate",
      message: `Automation for ${accountId} held because confidence was below threshold.`,
      meta: { accountId, dryRun, confidence: Number(plan.confidence || 0), minConfidence }
    });
    return { dryRun, skipped: true, accountId, results, account };
  }

  for (const position of account.positions || []) {
    const target = desiredMap.get(position.instId);
    const pnlPct = Number(position.uplRatioPct || 0);
    let action = null;
    let reason = "";
    let recommendation = null;
    if (productPreferenceMismatch(position, settings.productPreference)) {
      action = "close";
      reason = settings.productPreference === "swap"
        ? "账户 AI 设置为只做合约，平掉旧现货仓位后等待合约重建"
        : "账户 AI 设置为只做现货，平掉旧合约仓位后等待现货重建";
    } else if (pnlPct >= targetReturn) {
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
    if (!dryRun) invalidateAccountsOverviewCache();
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
      ? await buildAutomationContractRecommendation({ ...target, valueUsdt: deficit }, account, settings)
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
  if (!dryRun) invalidateAccountsOverviewCache();
  return {
    dryRun,
    skipped: executedActions === 0,
    accountId,
    results,
    account: dryRun ? account : await loadAccountSummary("test", accountId)
  };
}

async function buildAutomationContractRecommendation(target, account, settings = {}) {
  const pair = await buildAutomationDirectionPair(target.symbol, Number(target.valueUsdt || 0), account, settings);
  if (!pair.available) return { allowed: false, reason: pair.reason };
  const override = getAutomationDecisionOverride(settings, target.symbol);
  const overrideSide = ["long", "short"].includes(target.preferredSide) ? target.preferredSide
    : ["long", "short"].includes(override?.side) ? override.side
      : "";
  const side = overrideSide || pair.preferredSide;
  const contract = pair[side];
  const hasSizedOrder = Number(contract.recommendation.contracts || 0) > 0 && Number(contract.recommendation.notional || 0) > 0;
  const enterNow = contract.recommendation.timing.state === "enter";
  const probeEntry = shouldProbeContractEntry(contract, target, settings);
  if (override && !override.allowed) {
    return {
      allowed: false,
      side,
      leverage: contract.recommendation.leverage,
      notionalUsd: contract.recommendation.notional,
      reason: `TradingAgents 未放行该合约动作：${override.summary || "等待更高置信度"}`
    };
  }
  return {
    allowed: hasSizedOrder && (enterNow || probeEntry),
    side,
    leverage: contract.recommendation.leverage,
    notionalUsd: contract.recommendation.notional,
    reason: !hasSizedOrder
      ? "目标预算不足以形成最小合约手数，本轮不自动开仓"
      : enterNow
        ? `AI 双向对照确认，${side === "short" ? "做空" : "做多"} ${contract.recommendation.leverage}x`
        : probeEntry
          ? `进攻参数允许试探开仓：${contract.recommendation.timing.label}，${side === "short" ? "做空" : "做多"} ${contract.recommendation.leverage}x`
          : `AI 双向对照仍为${contract.recommendation.timing.label}，本轮不自动开仓`
  };
}

function shouldProbeContractEntry(contract, target = {}, settings = {}) {
  if (contract.recommendation.timing.state !== "watch") return false;
  if (Number(settings.riskLevel || 0) < 8) return false;
  if (Number(target.targetPct || 0) < 4) return false;
  if (Number(contract.recommendation.riskScore || 100) > 78) return false;
  const trend = contract.recommendation.trend;
  if (trend?.blocked) return false;
  if (trend && Number(trend.confidence || 0) < 58) return false;
  if (trend && Number(trend.consistency || 0) < 50) return false;
  const flow = contract.market?.orderFlow;
  const flowDirection = flow?.aiBias || flow?.direction;
  const flowConfidence = Number(flow?.aiConfidence || flow?.confidence || 0);
  if (flowDirection && flowDirection !== "neutral" && flowDirection !== contract.side && flowConfidence >= 60) return false;
  return true;
}

async function buildAutomationDirectionPair(instId, capitalBudget, account, settings = {}) {
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
  const [marketFlow, trendAlignment] = await Promise.all([
    getMarketFlowReference(instId, {
      candles,
      instrument,
      fundingRate: fundingRate || {},
      openInterest: openInterest || {}
    }),
    getTrendAlignmentReference(instId, { candles1h: candles })
  ]);
  const common = {
    instId,
    ticker: ticker || {},
    candles,
    instrument,
    fundingRate: fundingRate || {},
    openInterest: openInterest || {},
    marketFlow,
    trendAlignment,
    account: { totalEqUsd: account.totalEqUsd, availableUsdt: account.availableUsdt },
    riskPct: clamp(Number(settings.riskLevel || 5) / 5, 0.2, 3),
    minLeverage: snapOkxLeverage(Math.max(Number(settings.minLeverage || AUTOMATION_DEFAULT_MIN_LEVERAGE), AUTOMATION_DEFAULT_MIN_LEVERAGE), Number(instrument.lever || 1)),
    maxLeverage: Math.min(Number(instrument.lever || 1), snapOkxLeverage(Number(settings.maxLeverage || instrument.lever || 1), Number(instrument.lever || 1))),
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
    marketFlow,
    trendAlignment
  };
}

async function buildExistingPositionAutomationDecision({ position, account, settings, minOrderUsdt, maxOrderUsdt, planned }) {
  const instId = position.instType === "SWAP" ? position.instId : `${position.instId}-SWAP`;
  const currentSide = normalizePosSide(position);
  const oppositeSide = currentSide === "short" ? "long" : "short";
  const override = getAutomationDecisionOverride(settings, position.instId) || getAutomationDecisionOverride(settings, instId);
  if (override?.available && override.confidence >= clamp(Number(settings.minConfidence || 0), 0, 100)) {
    if (override.veto || ["watch", "hold"].includes(override.action)) {
      return { action: "watch", reason: `TradingAgents 建议等待：${override.summary || "当前不适合调整"}` };
    }
    if (override.side === oppositeSide) {
      return {
        action: override.confidence >= 80 ? "close" : "reduce",
        reason: `TradingAgents 最终判断偏向${oppositeSide === "short" ? "做空" : "做多"}，置信度 ${override.confidence}%`,
        side: currentSide,
        leverage: position.lever
      };
    }
  }
  const adjustmentBudget = Math.min(maxOrderUsdt, Math.max(minOrderUsdt, Number(account.availableUsdt || 0) * 0.1));
  let pair;
  try {
    pair = await buildAutomationDirectionPair(instId, adjustmentBudget, account, settings);
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

async function getFullPositionSuites() {
  const store = readFullPositionStore();
  const suites = await Promise.all((store.suites || []).map((suite) => enrichFullPositionSuite(suite)));
  return suites.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
}

async function resolveFullPositionTestSymbols(input = {}) {
  const mode = normalizeFullPositionSymbolMode(input.symbolMode || input.universeMode);
  const custom = sanitizeExplicitUniverse(input.symbols, FULL_POSITION_TEST_SYMBOL_LIMIT);
  if (mode === "custom" && custom.length) return custom;

  if (mode === "all-swap" && input.refreshUniverse !== true) {
    const cached = readFullPositionUniverseCache(input);
    if (cached.length) return cached;
  }

  const allSwap = await buildFullPositionSwapUniverse(input).catch((error) => {
    appendLog({
      level: "warn",
      event: "full_position_universe_failed",
      message: `Full-position universe fallback: ${error.message}`
    });
    return [];
  });
  if (mode === "all-swap" && allSwap.length) return allSwap;
  if (custom.length) return custom;
  return sanitizeUniverse(FULL_POSITION_TEST_DEFAULT_SYMBOLS, { max: FULL_POSITION_TEST_SYMBOL_LIMIT });
}

async function buildFullPositionSwapUniverse(input = {}) {
  const requestedLimit = Number(input.symbolLimit || FULL_POSITION_TEST_SYMBOL_LIMIT);
  const limit = clamp(Number.isFinite(requestedLimit) ? requestedLimit : FULL_POSITION_TEST_SYMBOL_LIMIT, 20, FULL_POSITION_TEST_SYMBOL_LIMIT);
  const excludeNew = input.excludeNewCoins === true;
  const minAgeDays = clamp(Number(input.minAgeDays || 0), 0, 3650);
  const now = Date.now();
  const [instruments, tickers] = await Promise.all([
    okx.getInstruments("SWAP"),
    okx.getTickers("SWAP")
  ]);
  const tickerMap = new Map((tickers || []).map((ticker) => [ticker.instId, ticker]));
  const symbols = (instruments || [])
    .filter((item) => item.state === "live" && String(item.instId || "").endsWith("-USDT-SWAP"))
    .filter((item) => !isStableInstrument(item.instId))
    .filter((item) => {
      if (!excludeNew || minAgeDays <= 0) return true;
      const listedAt = Number(item.listTime || 0);
      return listedAt > 0 ? now - listedAt >= minAgeDays * 24 * 60 * 60 * 1000 : true;
    })
    .sort((a, b) => {
      const left = tickerMap.get(a.instId) || {};
      const right = tickerMap.get(b.instId) || {};
      return Number(right.volCcy24h || right.vol24h || 0) - Number(left.volCcy24h || left.vol24h || 0);
    })
    .map((item) => item.instId);
  const normalized = sanitizeUniverse(symbols, { max: limit });
  writeFullPositionUniverseCache(normalized, "okx-live-public");
  return normalized;
}

function writeFullPositionUniverseCache(symbols = [], source = "local-suite") {
  const normalized = sanitizeUniverse(symbols, { max: FULL_POSITION_TEST_SYMBOL_LIMIT });
  if (!normalized.length) return;
  writeJsonFile(fullPositionUniversePath, {
    version: 1,
    updatedAt: new Date().toISOString(),
    source,
    symbols: normalized
  });
}

function readFullPositionUniverseCache(input = {}) {
  const requestedLimit = Number(input.symbolLimit || FULL_POSITION_TEST_SYMBOL_LIMIT);
  const limit = clamp(Number.isFinite(requestedLimit) ? requestedLimit : FULL_POSITION_TEST_SYMBOL_LIMIT, 20, FULL_POSITION_TEST_SYMBOL_LIMIT);
  const parsed = readJsonFile(fullPositionUniversePath, { symbols: [] });
  const fileSymbols = sanitizeUniverse(parsed.symbols || [], { max: limit });
  if (fileSymbols.length) return fileSymbols;

  for (const entry of currentAuditLog().slice().reverse()) {
    if (entry.event !== "full_position_test_started") continue;
    const symbols = sanitizeUniverse(entry.meta?.symbols || [], { max: limit });
    if (symbols.length >= 20) return symbols;
  }
  return [];
}

function normalizeFullPositionSymbolMode(value) {
  return String(value || "").toLowerCase() === "custom" ? "custom" : "all-swap";
}

function selectFullPositionAnalysisSymbols(symbols = [], input = {}) {
  const full = sanitizeUniverse(symbols, { max: FULL_POSITION_TEST_SYMBOL_LIMIT });
  if (!full.length) return [];
  const requested = Number(input.analysisSymbolLimit || input.deepSymbolLimit || FULL_POSITION_TEST_ANALYSIS_LIMIT);
  const maxLimit = Math.min(full.length, FULL_POSITION_TEST_SYMBOL_LIMIT);
  const minLimit = Math.min(20, maxLimit);
  const limit = clamp(Number.isFinite(requested) ? requested : FULL_POSITION_TEST_ANALYSIS_LIMIT, minLimit, maxLimit);
  const fullSet = new Set(full);
  const priority = sanitizeExplicitUniverse(input.prioritySymbols || FULL_POSITION_PRIORITY_SYMBOLS, FULL_POSITION_TEST_SYMBOL_LIMIT)
    .filter((symbol) => fullSet.has(symbol));
  return sanitizeUniverse([...priority, ...full], { max: limit });
}

async function purgeFullPositionTestAccounts(options = {}) {
  const store = readFullPositionStore();
  const knownIds = fullPositionTestAccountIdsFromStore(store);
  const ids = new Set(knownIds);
  for (const descriptor of testAccounts.list()) {
    if (isFullPositionTestDescriptor(descriptor, knownIds)) ids.add(descriptor.id);
  }

  let removed = 0;
  for (const accountId of ids) {
    if (!accountId || accountId === "default") continue;
    try {
      const current = autopilot.getState(accountId);
      await autopilot.configure({
        ...current,
        enabled: false,
        accountId,
        settings: current.settings || {}
      });
    } catch {
      // Best-effort shutdown before deleting local test state.
    }
    autopilot.remove(accountId);
    removeAutomationConfig(accountId);
    try {
      testAccounts.remove(accountId);
      removed += 1;
    } catch {
      // The account may already have been removed while the suite history remains.
    }
  }

  if (options.removeSuites) {
    await updateFullPositionStore((nextStore) => {
      nextStore.suites = [];
      return null;
    });
  }

  if (removed || options.removeSuites) {
    appendLog({
      level: "info",
      event: "full_position_accounts_purged",
      message: `Purged ${removed} full-position test accounts.`,
      meta: { removed, removeSuites: Boolean(options.removeSuites) }
    });
    invalidateAccountsOverviewCache();
  }

  return { removed };
}

async function purgeLocalTestAccounts(options = {}) {
  const preserveFullPosition = options.preserveFullPosition !== false;
  const fullPositionIds = fullPositionTestAccountIdsFromStore();
  const removed = [];

  for (const descriptor of testAccounts.list()) {
    if (!descriptor.id || descriptor.id === "default") continue;
    if (preserveFullPosition && isFullPositionTestDescriptor(descriptor, fullPositionIds)) continue;
    try {
      const current = autopilot.getState(descriptor.id);
      if (current.enabled) {
        await autopilot.configure({
          ...current,
          enabled: false,
          accountId: descriptor.id,
          settings: current.settings || {}
        });
      }
    } catch {
      // Continue with local cleanup even if a timer was already gone.
    }
    autopilot.remove(descriptor.id);
    removeAutomationConfig(descriptor.id);
    testAccounts.remove(descriptor.id);
    removed.push(descriptor.id);
  }

  let defaultReset = false;
  if (options.resetDefault) {
    const current = autopilot.getState("default");
    await autopilot.configure({
      ...current,
      enabled: false,
      accountId: "default",
      settings: current.settings || {}
    });
    autopilot.remove("default");
    removeAutomationConfig("default");
    testAccounts.get("default").reset(clamp(Number(options.defaultEquityUsdt || TEST_ACCOUNT_DEFAULT_INITIAL_USDT), 1, 10_000_000));
    defaultReset = true;
  }

  appendLog({
    level: "info",
    event: "test_accounts_purged",
    message: `Purged ${removed.length} ordinary local test accounts.`,
    meta: { removed, defaultReset, preserveFullPosition }
  });
  invalidateAccountsOverviewCache();
  return { removed, defaultReset, preserveFullPosition };
}

async function runFullPositionParameterTest(input = {}) {
  const accountCount = clamp(Number(input.accountCount || 12), 1, 64);
  const initialEquityUsdt = clamp(Number(input.initialEquityUsdt || TEST_ACCOUNT_DEFAULT_INITIAL_USDT), 1_000, 10_000_000);
  const intervalSeconds = clamp(Number(input.intervalSeconds || Number(input.intervalMinutes || 0) * 60 || 30), 30, 3600);
  if (input.resetExisting !== false) await purgeFullPositionTestAccounts({ removeSuites: true });
  const symbols = await resolveFullPositionTestSymbols(input);
  if (normalizeFullPositionSymbolMode(input.symbolMode || input.universeMode) === "all-swap") {
    writeFullPositionUniverseCache(symbols, "full-position-test");
  }
  const analysisSymbols = selectFullPositionAnalysisSymbols(symbols, input);
  const runImmediately = input.runImmediately !== false;
  const suiteId = `fps-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  const variants = buildFullPositionParameterMatrix({
    count: accountCount,
    decisionEngine: input.decisionEngine || input.decisionScope || "all",
    symbols,
    intervalSeconds
  });
  if (!variants.length) throw new Error("No unique full-position parameter variants were generated.");

  const rows = variants.map((variant, index) => {
    const descriptor = testAccounts.create({
      label: `fps-${index + 1}-${variant.slug}`.slice(0, 24),
      initialEquityUsdt,
      purpose: FULL_POSITION_ACCOUNT_PURPOSE
    });
    const settings = sanitizeAutomationSettings({
      ...variant.settings,
      budgetUsdt: initialEquityUsdt,
      autoBudget: true,
      productPreference: "swap",
      favoritePoolOnly: false,
      symbols: analysisSymbols.join(","),
      symbolLimit: analysisSymbols.length,
      manageExistingPositions: true,
      allowNewPositions: true,
      allowPositionIncrease: true
    });
    return {
      id: `${suiteId}-${index + 1}`,
      accountId: descriptor.id,
      accountLabel: descriptor.label,
      variant: variant.name,
      slug: variant.slug,
      objective: settings.objective,
      settings,
      createdAt,
      startedAt: createdAt,
      status: "running",
      initialEquityUsdt,
      samples: []
    };
  });

  const suite = {
    id: suiteId,
    name: String(input.name || `全仓参数测试 ${new Date().toLocaleString("zh-CN", { hour12: false })}`).slice(0, 48),
    status: "running",
    createdAt,
    updatedAt: createdAt,
    initialEquityUsdt,
    intervalSeconds,
    symbols,
    analysisSymbols,
    symbolMode: normalizeFullPositionSymbolMode(input.symbolMode || input.universeMode),
    rows,
    notes: [
      "长期挂机测试：每个账户使用独立参数和独立本地测试资金。",
      "统计会在每次自动化运行后记录权益快照，并计算小时/日收益率、胜率、总收益率和回撤。"
    ]
  };

  await updateFullPositionStore((store) => {
    store.suites = [suite, ...(store.suites || [])].slice(0, 12);
    return suite;
  });

  const staggerStepSeconds = Math.max(1, Math.floor(intervalSeconds / Math.max(rows.length, 1)));
  for (const [index, row] of rows.entries()) {
    const state = await autopilot.configure({
      enabled: true,
      intervalSeconds,
      startDelaySeconds: Math.min(index * staggerStepSeconds + 1, Math.max(intervalSeconds - 1, 0)),
      executionMode: "auto",
      dryRun: false,
      accountId: row.accountId,
      settings: row.settings
    });
    saveAutomationConfig(row.accountId, state);
  }

  appendLog({
    level: "info",
    event: "full_position_test_started",
    message: `Started full-position parameter test ${suiteId} with ${rows.length} accounts.`,
    meta: { suiteId, accountCount: rows.length, intervalSeconds, symbols }
  });

  if (runImmediately) {
    for (const row of rows) {
      await autopilot.runOnce("full-position-start", row.accountId).catch((error) => {
        appendLog({
          level: "warn",
          event: "full_position_initial_run_failed",
          message: `${row.accountId}: ${error.message}`,
          meta: { suiteId, accountId: row.accountId }
        });
      });
    }
  }

  invalidateAccountsOverviewCache();
  const suites = await getFullPositionSuites();
  return suites.find((item) => item.id === suiteId) || suite;
}

async function stopFullPositionSuite(input = {}) {
  const suiteId = String(input.suiteId || input.id || "").trim();
  if (!suiteId) throw new Error("Full-position suite id is required.");
  const store = readFullPositionStore();
  const suite = (store.suites || []).find((item) => item.id === suiteId);
  if (!suite) throw new Error("Full-position test suite not found.");

  for (const row of suite.rows || []) {
    const current = autopilot.getState(row.accountId);
    const state = await autopilot.configure({
      ...current,
      enabled: false,
      accountId: row.accountId,
      startDelaySeconds: current.startDelaySeconds || 0,
      settings: current.settings || row.settings || {}
    });
    saveAutomationConfig(row.accountId, state);
  }

  await updateFullPositionStore((nextStore) => {
    const target = (nextStore.suites || []).find((item) => item.id === suiteId);
    if (target) {
      target.status = "stopped";
      target.stoppedAt = new Date().toISOString();
      target.updatedAt = target.stoppedAt;
      target.rows = (target.rows || []).map((row) => ({ ...row, status: "stopped" }));
    }
    return target || suite;
  });

  appendLog({
    level: "info",
    event: "full_position_test_stopped",
    message: `Stopped full-position parameter test ${suiteId}.`,
    meta: { suiteId }
  });
  invalidateAccountsOverviewCache();
  const suites = await getFullPositionSuites();
  return suites.find((item) => item.id === suiteId) || suite;
}

async function recordFullPositionRunSample(accountId, result = {}) {
  const logPayload = await updateFullPositionStore(async (store) => {
    const suite = (store.suites || []).find((item) => item.status === "running"
      && (item.rows || []).some((row) => row.accountId === accountId && row.status === "running"));
    if (!suite) return null;
    const row = (suite.rows || []).find((item) => item.accountId === accountId);
    if (!row) return null;
    const account = await loadAccountSummary("test", accountId);
    const actions = result?.execution?.results || [];
    const positions = account.positions || [];
    const sample = {
      ts: new Date().toISOString(),
      equity: roundMoney(Number(account.totalEqUsd || 0)),
      availableUsdt: roundMoney(Number(account.availableUsdt || 0)),
      totalUpl: roundMoney(Number(account.totalUpl || 0)),
      realizedPnl: roundMoney(Number(account.realizedPnl || 0)),
      usedMargin: roundMoney(Number(account.usedMargin || 0)),
      marginUsagePct: roundMoney(Number(account.marginUsagePct || 0)),
      positions: positions.length,
      winningPositions: positions.filter((position) => Number(position.upl || 0) > 0).length,
      losingPositions: positions.filter((position) => Number(position.upl || 0) < 0).length,
      executed: actions.filter((item) => item.status === "applied-to-test-account").length,
      actionCount: actions.length,
      planConfidence: Number(result?.plan?.confidence || 0),
      bestSymbol: result?.plan?.best?.symbol || "",
      skipped: Boolean(result?.execution?.skipped)
    };
    row.samples = [...(row.samples || []), sample].slice(-5000);
    row.lastSampleAt = sample.ts;
    row.updatedAt = sample.ts;
    suite.updatedAt = sample.ts;
    return {
      suiteId: suite.id,
      suiteName: suite.name,
      rowId: row.id,
      modelId: row.slug || row.id,
      modelName: row.variant || row.slug || row.id,
      accountId,
      accountLabel: row.accountLabel,
      initialEquityUsdt: row.initialEquityUsdt,
      settings: row.settings || {},
      sample,
      operations: normalizeModelOperations(actions, sample.ts, accountId, row.accountLabel)
    };
  });
  if (logPayload) {
    appendModelRunLog({
      scope: "live",
      runId: logPayload.suiteId,
      runName: logPayload.suiteName,
      modelId: logPayload.modelId,
      modelName: logPayload.modelName,
      rowId: logPayload.rowId,
      accountId: logPayload.accountId,
      accountLabel: logPayload.accountLabel,
      initialEquityUsdt: logPayload.initialEquityUsdt,
      settings: logPayload.settings,
      sample: logPayload.sample,
      operations: logPayload.operations
    });
  }
}

function buildFullPositionParameterMatrixLegacy({ count, decisionEngine, symbols, intervalSeconds }) {
  const mode = normalizeDecisionMode(decisionEngine || "skills");
  const templates = [
    {
      slug: "balanced",
      name: "均衡确认",
      settings: {
        objective: "balanced",
        riskLevel: 7,
        maxAssetWeight: 45,
        minConfidence: 60,
        maxDrawdown: 8,
        targetReturn: 35,
        minLeverage: 5,
        maxLeverage: 10,
        maxActionsPerCycle: 4
      }
    },
    {
      slug: "growth",
      name: "进攻确认",
      settings: {
        objective: "growth",
        riskLevel: 9,
        maxAssetWeight: 70,
        minConfidence: 55,
        maxDrawdown: 10,
        targetReturn: 60,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 6
      }
    },
    {
      slug: "trend",
      name: "趋势激进",
      settings: {
        objective: "growth",
        riskLevel: 10,
        maxAssetWeight: 90,
        minConfidence: 45,
        maxDrawdown: 12,
        targetReturn: 100,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 8
      }
    },
    {
      slug: "defensive",
      name: "保守过滤",
      settings: {
        objective: "defensive",
        riskLevel: 6,
        maxAssetWeight: 35,
        minConfidence: 68,
        maxDrawdown: 6,
        targetReturn: 20,
        minLeverage: 5,
        maxLeverage: 10,
        maxActionsPerCycle: 3
      }
    },
    {
      slug: "wide",
      name: "分散高频",
      settings: {
        objective: "growth",
        riskLevel: 8,
        maxAssetWeight: 38,
        minConfidence: 50,
        maxDrawdown: 9,
        targetReturn: 45,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 10
      }
    },
    {
      slug: "ta-hybrid",
      name: "TA 复核",
      settings: {
        objective: "balanced",
        riskLevel: 8,
        maxAssetWeight: 55,
        minConfidence: 58,
        maxDrawdown: 8,
        targetReturn: 45,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 5,
        decisionEngine: mode === "skills" ? "hybrid" : mode,
        tradingAgentsWeight: 60
      }
    }
  ];

  const variants = [];
  for (let index = 0; index < count; index += 1) {
    const template = templates[index % templates.length];
    const cycle = Math.floor(index / templates.length);
    variants.push({
      slug: cycle ? `${template.slug}-${cycle + 1}` : template.slug,
      name: cycle ? `${template.name} ${cycle + 1}` : template.name,
      settings: {
        lookbackDays: 60,
        minOrderUsdt: 10,
        excludeNewCoins: false,
        decisionEngine: template.settings.decisionEngine || mode,
        tradingAgentsWeight: template.settings.tradingAgentsWeight ?? 50,
        forceTradingAgents: false,
        symbols: symbols.join(","),
        intervalSeconds,
        ...template.settings
      }
    });
  }
  return variants;
}

function buildFullPositionParameterMatrix({ count, decisionEngine, symbols, intervalSeconds }) {
  const requestedCount = Math.max(0, Math.floor(Number(count || 0)));
  if (requestedCount <= 0) return [];

  const scope = normalizeFullPositionDecisionScope(decisionEngine || "skills");
  const strategyProfiles = [
    {
      slug: "balanced",
      name: "\u5747\u8861\u786e\u8ba4",
      settings: {
        objective: "balanced",
        riskLevel: 7,
        maxAssetWeight: 45,
        minConfidence: 60,
        maxDrawdown: 8,
        targetReturn: 35,
        minLeverage: 5,
        maxLeverage: 10,
        maxActionsPerCycle: 4
      }
    },
    {
      slug: "growth",
      name: "\u8fdb\u653b\u786e\u8ba4",
      settings: {
        objective: "growth",
        riskLevel: 9,
        maxAssetWeight: 70,
        minConfidence: 55,
        maxDrawdown: 10,
        targetReturn: 60,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 6
      }
    },
    {
      slug: "trend",
      name: "\u8d8b\u52bf\u6fc0\u8fdb",
      settings: {
        objective: "growth",
        riskLevel: 10,
        maxAssetWeight: 90,
        minConfidence: 45,
        maxDrawdown: 12,
        targetReturn: 100,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 8
      }
    },
    {
      slug: "defensive",
      name: "\u4fdd\u5b88\u8fc7\u6ee4",
      settings: {
        objective: "defensive",
        riskLevel: 6,
        maxAssetWeight: 35,
        minConfidence: 68,
        maxDrawdown: 6,
        targetReturn: 20,
        minLeverage: 5,
        maxLeverage: 10,
        maxActionsPerCycle: 3
      }
    },
    {
      slug: "wide",
      name: "\u5206\u6563\u9ad8\u9891",
      settings: {
        objective: "growth",
        riskLevel: 8,
        maxAssetWeight: 38,
        minConfidence: 50,
        maxDrawdown: 9,
        targetReturn: 45,
        minLeverage: 5,
        maxLeverage: 20,
        maxActionsPerCycle: 10
      }
    }
  ];

  const engineProfiles = fullPositionDecisionEngineProfiles(scope);
  const variants = [];
  const seen = new Set();

  for (const strategy of strategyProfiles) {
    for (const engine of engineProfiles) {
      const settings = {
        lookbackDays: 60,
        minOrderUsdt: 10,
        excludeNewCoins: false,
        symbols: symbols.join(","),
        intervalSeconds,
        ...strategy.settings,
        ...engine.settings
      };
      const signature = fullPositionVariantSignature(settings);
      if (seen.has(signature)) continue;
      seen.add(signature);
      variants.push({
        slug: `${strategy.slug}-${engine.slug}`,
        name: `${strategy.name} / ${engine.name}`,
        settings
      });
    }
  }

  const shouldCoverWholeScope = scope === "all" || engineProfiles.length > 1;
  const targetCount = shouldCoverWholeScope
    ? variants.length
    : Math.min(requestedCount, variants.length);
  return variants.slice(0, targetCount);
}

function normalizeFullPositionDecisionScope(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["all", "coverage", "matrix", "all-engines", "all_engines", "comprehensive"].includes(raw)) return "all";
  if (["skills+tradingagents", "skills-ta", "skills_ta", "ta+skills"].includes(raw)) return "hybrid";
  return normalizeDecisionMode(raw || "skills");
}

function fullPositionDecisionEngineProfiles(scope) {
  const skills = {
    slug: "skills",
    name: "Skills",
    settings: {
      decisionEngine: "skills",
      tradingAgentsWeight: 0,
      forceTradingAgents: false
    }
  };
  const tradingAgents = {
    slug: "ta",
    name: "TradingAgents",
    settings: {
      decisionEngine: "tradingagents",
      tradingAgentsWeight: 100,
      forceTradingAgents: true
    }
  };
  const hybrid = [
    {
      slug: "hybrid-s65",
      name: "Skills 65% + TA 35%",
      settings: {
        decisionEngine: "hybrid",
        tradingAgentsWeight: 35,
        forceTradingAgents: false
      }
    },
    {
      slug: "hybrid-5050",
      name: "Skills 50% + TA 50%",
      settings: {
        decisionEngine: "hybrid",
        tradingAgentsWeight: 50,
        forceTradingAgents: false
      }
    },
    {
      slug: "hybrid-ta65",
      name: "Skills 35% + TA 65%",
      settings: {
        decisionEngine: "hybrid",
        tradingAgentsWeight: 65,
        forceTradingAgents: false
      }
    }
  ];

  if (scope === "skills") return [skills];
  if (scope === "tradingagents") return [tradingAgents];
  if (scope === "hybrid") return hybrid;
  return [skills, ...hybrid, tradingAgents];
}

function fullPositionVariantSignature(settings = {}) {
  return JSON.stringify({
    objective: settings.objective,
    riskLevel: settings.riskLevel,
    maxAssetWeight: settings.maxAssetWeight,
    minConfidence: settings.minConfidence,
    maxDrawdown: settings.maxDrawdown,
    targetReturn: settings.targetReturn,
    minLeverage: settings.minLeverage,
    maxLeverage: settings.maxLeverage,
    maxActionsPerCycle: settings.maxActionsPerCycle,
    decisionEngine: settings.decisionEngine,
    tradingAgentsWeight: settings.tradingAgentsWeight,
    forceTradingAgents: Boolean(settings.forceTradingAgents)
  });
}

async function enrichFullPositionSuite(suite) {
  const rows = await Promise.all((suite.rows || []).map(async (row) => {
    let account = null;
    let accountError = "";
    try {
      account = await withTimeout(loadAccountSummary("test", row.accountId), Number(process.env.FULL_POSITION_ACCOUNT_TIMEOUT_MS || 2500), null);
      if (!account) accountError = "account summary timed out; using samples only";
    } catch (error) {
      accountError = error.message || "account unavailable";
    }
    return {
      ...row,
      account,
      accountError,
      stats: buildFullPositionRowStats(row, account)
    };
  }));
  const ranked = rows.slice().sort((a, b) => Number(b.stats?.score || 0) - Number(a.stats?.score || 0));
  return {
    ...suite,
    rows,
    best: ranked[0] ? {
      accountId: ranked[0].accountId,
      accountLabel: ranked[0].accountLabel,
      variant: ranked[0].variant,
      score: ranked[0].stats.score,
      totalReturnPct: ranked[0].stats.totalReturnPct
    } : null,
    aggregate: buildFullPositionAggregate(rows)
  };
}

function buildFullPositionRowStats(row, account = null) {
  const samples = Array.isArray(row.samples) ? row.samples : [];
  const initialEquity = Number(row.initialEquityUsdt || account?.initialEquityUsdt || 0);
  const currentEquity = Number(account?.totalEqUsd || samples.at(-1)?.equity || initialEquity || 0);
  const currentUpl = Number(account?.totalUpl || samples.at(-1)?.totalUpl || 0);
  const marginUsagePct = Number(account?.marginUsagePct || samples.at(-1)?.marginUsagePct || 0);
  const positions = account?.positions || [];
  const totalReturnPct = initialEquity > 0 ? (currentEquity / initialEquity - 1) * 100 : 0;
  const hourlyReturnPct = returnSince(samples, 60 * 60 * 1000, currentEquity);
  const dailyReturnPct = returnSince(samples, 24 * 60 * 60 * 1000, currentEquity);
  const sampleWinRate = sampleWinRatePct(samples);
  const openWinRate = positions.length
    ? positions.filter((position) => Number(position.upl || 0) > 0).length / positions.length * 100
    : 0;
  const winRate = samples.length > 1 ? sampleWinRate : openWinRate;
  const maxDrawdownPct = maxDrawdownFromSamples(samples, initialEquity);
  const executedActions = sum(samples.map((sample) => Number(sample.executed || 0)));
  const actionCount = sum(samples.map((sample) => Number(sample.actionCount || 0)));
  const lastSample = samples.at(-1) || null;
  const score = scoreFullPositionStats({
    totalReturnPct,
    hourlyReturnPct,
    dailyReturnPct,
    winRate,
    maxDrawdownPct,
    marginUsagePct,
    executedActions,
    positions: positions.length,
    planConfidence: Number(lastSample?.planConfidence || 0)
  });

  return {
    currentEquity: roundMoney(currentEquity),
    availableUsdt: roundMoney(Number(account?.availableUsdt || lastSample?.availableUsdt || 0)),
    totalUpl: roundMoney(currentUpl),
    totalReturnPct: roundMoney(totalReturnPct),
    hourlyReturnPct: roundMoney(hourlyReturnPct),
    dailyReturnPct: roundMoney(dailyReturnPct),
    winRate: roundMoney(winRate),
    openWinRate: roundMoney(openWinRate),
    sampleWinRate: roundMoney(sampleWinRate),
    maxDrawdownPct: roundMoney(maxDrawdownPct),
    marginUsagePct: roundMoney(marginUsagePct),
    positions: positions.length,
    samples: samples.length,
    executedActions,
    actionCount,
    lastSampleAt: lastSample?.ts || row.lastSampleAt || null,
    recentHours: bucketReturns(samples, "hour", 24),
    recentDays: bucketReturns(samples, "day", 14),
    score
  };
}

function buildFullPositionAggregate(rows = []) {
  const active = rows.filter((row) => row.stats);
  if (!active.length) return { accountCount: 0, avgReturnPct: 0, avgWinRate: 0, avgScore: 0 };
  return {
    accountCount: active.length,
    avgReturnPct: roundMoney(mean(active.map((row) => Number(row.stats.totalReturnPct || 0)))),
    avgHourlyReturnPct: roundMoney(mean(active.map((row) => Number(row.stats.hourlyReturnPct || 0)))),
    avgDailyReturnPct: roundMoney(mean(active.map((row) => Number(row.stats.dailyReturnPct || 0)))),
    avgWinRate: roundMoney(mean(active.map((row) => Number(row.stats.winRate || 0)))),
    avgScore: roundMoney(mean(active.map((row) => Number(row.stats.score || 0))))
  };
}

function scoreFullPositionStats(input) {
  const score =
    Number(input.totalReturnPct || 0) * 8
    + Number(input.hourlyReturnPct || 0) * 4
    + Number(input.dailyReturnPct || 0) * 5
    + Number(input.winRate || 0) * 0.35
    + Math.min(Number(input.executedActions || 0), 20) * 1.8
    + Math.min(Number(input.positions || 0), 8) * 2
    + Number(input.planConfidence || 0) * 0.18
    - Math.abs(Number(input.maxDrawdownPct || 0)) * 5
    - Number(input.marginUsagePct || 0) * 0.22;
  return roundMoney(clamp(score, -100, 100));
}

function returnSince(samples, durationMs, currentEquity) {
  if (!samples.length) return 0;
  const cutoff = Date.now() - durationMs;
  const anchor = samples.find((sample) => Date.parse(sample.ts || "") >= cutoff) || samples[0];
  const start = Number(anchor?.equity || 0);
  return start > 0 ? (Number(currentEquity || 0) / start - 1) * 100 : 0;
}

function sampleWinRatePct(samples) {
  if (samples.length < 2) return 0;
  let wins = 0;
  let total = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = Number(samples[index - 1].equity || 0);
    const current = Number(samples[index].equity || 0);
    if (previous <= 0 || current <= 0) continue;
    if (current > previous) wins += 1;
    total += 1;
  }
  return total ? wins / total * 100 : 0;
}

function maxDrawdownFromSamples(samples, fallbackEquity = 0) {
  const equities = samples.map((sample) => Number(sample.equity || 0)).filter((value) => value > 0);
  if (!equities.length && fallbackEquity > 0) equities.push(fallbackEquity);
  let peak = equities[0] || 0;
  let drawdown = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    if (peak > 0) drawdown = Math.min(drawdown, equity / peak - 1);
  }
  return drawdown * 100;
}

function bucketReturns(samples, mode, limit) {
  const buckets = new Map();
  for (const sample of samples || []) {
    const date = new Date(sample.ts || 0);
    if (Number.isNaN(date.getTime())) continue;
    const key = mode === "day"
      ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
      : `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
    const current = buckets.get(key) || { bucket: key, startEquity: Number(sample.equity || 0), endEquity: Number(sample.equity || 0), samples: 0 };
    current.endEquity = Number(sample.equity || current.endEquity || 0);
    current.samples += 1;
    buckets.set(key, current);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      returnPct: bucket.startEquity > 0 ? roundMoney((bucket.endEquity / bucket.startEquity - 1) * 100) : 0
    }))
    .slice(-limit);
}

function readFullPositionStore() {
  const parsed = readJsonFile(fullPositionTestsPath, { version: 1, suites: [] });
  return {
    version: 1,
    suites: Array.isArray(parsed.suites) ? parsed.suites : []
  };
}

async function updateFullPositionStore(mutator) {
  const task = fullPositionStoreWrite.catch(() => null).then(async () => {
    const store = readFullPositionStore();
    const result = await mutator(store);
    writeJsonFile(fullPositionTestsPath, {
      version: 1,
      suites: (store.suites || []).slice(0, 12)
    });
    return result;
  });
  fullPositionStoreWrite = task.catch(() => null);
  return task;
}

function appendModelRunLog(input = {}) {
  const scope = sanitizePathSegment(input.scope || "live");
  const runId = sanitizePathSegment(input.runId || "default");
  const modelId = sanitizePathSegment(input.modelId || input.rowId || "model");
  const filePath = path.join(modelLogsDir, scope, runId, `${modelId}.json`);
  const existing = readJsonFile(filePath, null);
  const samples = [
    ...((existing && Array.isArray(existing.samples)) ? existing.samples : []),
    input.sample
  ].filter(Boolean).slice(-20_000);
  const operations = [
    ...((existing && Array.isArray(existing.operations)) ? existing.operations : []),
    ...(Array.isArray(input.operations) ? input.operations : [])
  ].filter(Boolean);
  return writeModelRunLog({ ...input, scope, runId, modelId, samples, operations, existing });
}

function writeModelRunLog(input = {}) {
  const scope = sanitizePathSegment(input.scope || "live");
  const runId = sanitizePathSegment(input.runId || "default");
  const modelId = sanitizePathSegment(input.modelId || input.rowId || "model");
  const filePath = path.join(modelLogsDir, scope, runId, `${modelId}.json`);
  const existing = input.existing || readJsonFile(filePath, null);
  const now = new Date().toISOString();
  const samples = (Array.isArray(input.samples) ? input.samples : []).filter(Boolean).slice(-20_000);
  const operations = trimModelOperations((Array.isArray(input.operations) ? input.operations : []).filter(Boolean));
  const initialEquityUsdt = Number(input.initialEquityUsdt || existing?.initialEquityUsdt || samples[0]?.equity || 0);
  const log = {
    version: 1,
    scope,
    runId,
    runName: input.runName || existing?.runName || runId,
    modelId,
    modelName: input.modelName || existing?.modelName || modelId,
    rowId: input.rowId || existing?.rowId || "",
    accountId: input.accountId || existing?.accountId || "",
    accountLabel: input.accountLabel || existing?.accountLabel || "",
    initialEquityUsdt,
    settings: input.settings || existing?.settings || {},
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    summary: buildModelLogSummary(samples, initialEquityUsdt),
    tradeStats: buildModelTradeStats(operations),
    samples,
    operations
  };
  const archiveDir = path.join(modelLogsByModelDir, scope, modelId);
  const archiveJsonPath = path.join(archiveDir, `${runId}.json`);
  const archiveLogPath = path.join(archiveDir, `${runId}.log`);
  const latestJsonPath = path.join(archiveDir, "latest.json");
  const latestLogPath = path.join(archiveDir, "latest.log");
  const finalLog = {
    ...log,
    paths: {
      json: filePath,
      modelJson: archiveJsonPath,
      readableLog: archiveLogPath,
      latestJson: latestJsonPath,
      latestReadableLog: latestLogPath
    }
  };
  writeJsonFile(filePath, finalLog);
  writeJsonFile(archiveJsonPath, finalLog);
  writeJsonFile(latestJsonPath, finalLog);
  writeReadableModelRunLog(finalLog, archiveLogPath, latestLogPath);
  return finalLog;
}

function trimModelOperations(operations = []) {
  const sorted = operations
    .filter(Boolean)
    .sort((a, b) => (Date.parse(a.ts || "") || 0) - (Date.parse(b.ts || "") || 0));
  const trades = sorted.filter(isTradeOperation).slice(-50_000);
  const nonTrades = sorted.filter((item) => !isTradeOperation(item)).slice(-5_000);
  return [...trades, ...nonTrades]
    .sort((a, b) => (Date.parse(a.ts || "") || 0) - (Date.parse(b.ts || "") || 0));
}

function isTradeOperation(item = {}) {
  const action = String(item.action || "").toLowerCase();
  const status = String(item.status || "").toLowerCase();
  if (["open", "add", "reduce", "close", "buy", "sell"].includes(action)) return true;
  return status.includes("applied") && !["watch", "skip", "skipped"].includes(action);
}

function buildModelTradeStats(operations = []) {
  const applied = operations.filter((item) => String(item.status || "").includes("applied"));
  const opens = applied.filter((item) => ["open", "buy"].includes(String(item.action || "").toLowerCase()));
  const adds = applied.filter((item) => String(item.action || "").toLowerCase() === "add");
  const reduces = applied.filter((item) => String(item.action || "").toLowerCase() === "reduce");
  const closes = applied.filter((item) => ["close", "sell"].includes(String(item.action || "").toLowerCase()));
  const closedWithPnl = closes.filter((item) => Number.isFinite(Number(item.realizedPnl)));
  const wins = closedWithPnl.filter((item) => Number(item.realizedPnl || 0) > 0).length;
  const totalFees = sum(applied.map((item) => Number(item.executionFee || 0)));
  const realizedPnl = sum(closedWithPnl.map((item) => Number(item.realizedPnl || 0)));
  const skipped = operations.filter((item) => !String(item.status || "").includes("applied")).length;
  return {
    applied: applied.length,
    opens: opens.length,
    adds: adds.length,
    reduces: reduces.length,
    closes: closes.length,
    skipped,
    wins,
    losses: Math.max(closedWithPnl.length - wins, 0),
    winRatePct: closedWithPnl.length ? roundMoney(wins / closedWithPnl.length * 100) : 0,
    realizedPnl: roundMoney(realizedPnl),
    totalFees: roundMoney(totalFees),
    firstTradeAt: applied[0]?.ts || null,
    lastTradeAt: applied.at(-1)?.ts || null
  };
}

function writeReadableModelRunLog(log, archiveLogPath, latestLogPath) {
  const content = buildReadableModelRunLog(log, archiveLogPath);
  for (const targetPath of [archiveLogPath, latestLogPath]) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
  }
}

function buildReadableModelRunLog(log, archiveLogPath = "") {
  const summary = log.summary || {};
  const stats = log.tradeStats || buildModelTradeStats(log.operations || []);
  const settings = log.settings || {};
  const tradeOperations = (log.operations || []).filter(isTradeOperation);
  const skippedOperations = (log.operations || []).filter((item) => !isTradeOperation(item));
  const lines = [];
  lines.push(`日志文件: ${archiveLogPath || log.paths?.readableLog || ""}`);
  lines.push("=== 模型回测/实盘结果 ===");
  lines.push(`模型: ${log.modelName || log.modelId}`);
  lines.push(`模型ID: ${log.modelId}`);
  lines.push(`运行: ${log.runName || log.runId}`);
  lines.push(`运行ID: ${log.runId}`);
  lines.push(`范围: ${settings.backtestStartDate || settings.startDate || "--"} -> ${settings.backtestEndDate || settings.endDate || "--"} | K线: ${settings.backtestBar || settings.bar || "--"} | 步进: ${settings.backtestStepBars || settings.stepBars || "--"}`);
  lines.push(`初始资金: ${formatLogMoney(summary.initialEquityUsdt ?? log.initialEquityUsdt)} USDT`);
  lines.push(`当前/最终资金: ${formatLogMoney(summary.currentEquity)} USDT`);
  lines.push(`总收益: ${formatLogMoney(summary.totalProfit)} USDT (${formatLogPct(summary.totalReturnPct)})`);
  lines.push(`最近1小时: ${formatLogMoney(summary.hourlyProfit)} USDT (${formatLogPct(summary.hourlyReturnPct)})`);
  lines.push(`最近1天: ${formatLogMoney(summary.dailyProfit)} USDT (${formatLogPct(summary.dailyReturnPct)})`);
  lines.push(`最近30天: ${formatLogMoney(summary.monthlyProfit)} USDT (${formatLogPct(summary.monthlyReturnPct)})`);
  lines.push(`最近365天: ${formatLogMoney(summary.yearlyProfit)} USDT (${formatLogPct(summary.yearlyReturnPct)})`);
  lines.push(`样本数: ${summary.samples || 0} | 最后样本: ${formatLogTime(summary.lastSampleAt)}`);
  lines.push(`交易统计: 开仓 ${stats.opens || 0} | 加仓 ${stats.adds || 0} | 减仓 ${stats.reduces || 0} | 平仓 ${stats.closes || 0} | 跳过/观察 ${stats.skipped || 0}`);
  lines.push(`平仓胜率: ${formatLogPct(stats.winRatePct)} | 已实现盈亏: ${formatLogMoney(stats.realizedPnl)} USDT | 手续费: ${formatLogMoney(stats.totalFees)} USDT`);
  lines.push("");
  lines.push("=== 模型参数 ===");
  lines.push(`决策引擎: ${settings.decisionEngine || "--"} | 标的数: ${settings.symbolLimit || "--"} | 模型可见K线: ${settings.lookbackBars || "--"} | 预热天数: ${settings.lookbackDays ?? "--"}`);
  lines.push(`最小置信度: ${settings.minConfidence ?? "--"} | 目标收益: ${settings.targetReturn ?? "--"}% | 最大回撤/止损: ${settings.maxDrawdown ?? "--"}%`);
  lines.push(`最小杠杆: ${settings.minLeverage ?? "--"}x | 最大杠杆: ${settings.maxLeverage ?? "--"}x | 单轮最大动作: ${settings.maxActionsPerCycle ?? "--"}`);
  if (settings.symbols) lines.push(`标的池: ${settings.symbols}`);
  lines.push("");
  lines.push("=== 开仓/加仓/平仓明细 ===");
  if (tradeOperations.length) {
    for (const op of tradeOperations) lines.push(...formatTradeOperationLines(op));
  } else {
    lines.push("无开仓/加仓/平仓记录。");
  }
  lines.push("");
  lines.push("=== 未开仓/跳过统计 ===");
  const reasonStats = countSkipReasons(skippedOperations);
  if (reasonStats.length) {
    for (const item of reasonStats.slice(0, 30)) lines.push(`- ${item.reason}: ${item.count} 次`);
  } else {
    lines.push("无跳过记录。");
  }
  const recentSkips = skippedOperations.slice(-80);
  if (recentSkips.length) {
    lines.push("");
    lines.push("=== 最近跳过/观察明细 ===");
    for (const op of recentSkips) {
      lines.push(`${formatLogTime(op.ts)} | 跳过/观察 | ${op.instId || "--"} | ${op.operation || op.action || "--"} | 原因: ${op.reason || "--"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatTradeOperationLines(op = {}) {
  const action = String(op.action || "").toLowerCase();
  const verb = action === "close" || action === "sell"
    ? "平仓"
    : action === "reduce"
      ? "减仓"
      : action === "add"
        ? "加仓"
        : "开仓";
  const side = op.side || op.positionSide || op.posSide || (op.instType === "SWAP" ? "long" : "spot");
  const header = `${formatLogTime(op.ts)} | ${verb} | ${op.instId || "--"} | ${side} | ${op.leverage ? `${op.leverage}x` : "--"} | ${op.status || "--"}`;
  const details = [
    `价格: ${formatLogPrice(op.referencePrice)}`,
    `名义: ${formatLogMoney(op.notionalUsd)} USDT`,
    `保证金/成本: ${formatLogMoney(op.marginUsdt ?? op.requiredCapitalUsdt)} USDT`,
    `数量: ${formatLogNumber(op.positionSize ?? op.contracts ?? op.sz)}`,
    `手续费: ${formatLogMoney(op.executionFee)} USDT`
  ];
  if (Number.isFinite(Number(op.realizedPnl))) details.push(`实现盈亏: ${formatLogMoney(op.realizedPnl)} USDT`);
  if (Number.isFinite(Number(op.realizedReturnPct))) details.push(`本次收益率: ${formatLogPct(op.realizedReturnPct)}`);
  if (Number.isFinite(Number(op.equityBefore)) || Number.isFinite(Number(op.equityAfter))) {
    details.push(`权益: ${formatLogMoney(op.equityBefore)} -> ${formatLogMoney(op.equityAfter)} USDT`);
  }
  return [
    header,
    `  ${details.join(" | ")}`,
    `  原因: ${op.reason || op.operation || "--"}`
  ];
}

function countSkipReasons(operations = []) {
  const counts = new Map();
  for (const op of operations) {
    const key = String(op.reason || op.operation || op.action || "未说明").replace(/\s+/g, " ").slice(0, 160);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function formatLogTime(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return "--";
  return new Date(ts + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC+8";
}

function formatLogMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 8;
  return num.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatLogPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 10;
  return num.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatLogPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function formatLogNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  const abs = Math.abs(num);
  const digits = abs >= 100 ? 4 : abs >= 1 ? 6 : 10;
  return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function readModelLogs(options = {}) {
  const scope = options.scope ? sanitizePathSegment(options.scope) : "";
  const runId = options.runId ? sanitizePathSegment(options.runId) : "";
  const modelId = options.modelId ? sanitizePathSegment(options.modelId) : "";
  const limit = clamp(Number(options.limit || 40), 1, 500);
  const root = scope ? path.join(modelLogsDir, scope) : modelLogsDir;
  const files = [];
  collectJsonFiles(root, files);
  return files
    .map((filePath) => readJsonFile(filePath, null))
    .filter((log) => log && (!scope || log.scope === scope) && (!runId || log.runId === runId) && (!modelId || log.modelId === modelId))
    .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
    .slice(0, modelId ? 1 : limit)
    .map((log) => ({
      ...log,
      samples: modelId ? (log.samples || []).slice(-2000) : (log.samples || []).slice(-120),
      operations: modelId ? (log.operations || []).slice(-1000) : (log.operations || []).slice(-80)
    }));
}

function collectJsonFiles(root, output) {
  if (!fs.existsSync(root)) return;
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    if (root.endsWith(".json")) output.push(root);
    return;
  }
  for (const entry of fs.readdirSync(root)) {
    collectJsonFiles(path.join(root, entry), output);
  }
}

function buildModelLogSummary(samples = [], initialEquityUsdt = 0) {
  const clean = samples.filter((sample) => Number(sample?.equity || 0) > 0);
  const latest = clean.at(-1) || null;
  const currentEquity = Number(latest?.equity || initialEquityUsdt || 0);
  return {
    initialEquityUsdt: roundMoney(Number(initialEquityUsdt || 0)),
    currentEquity: roundMoney(currentEquity),
    totalProfit: roundMoney(currentEquity - Number(initialEquityUsdt || currentEquity || 0)),
    totalReturnPct: initialEquityUsdt > 0 ? roundMoney((currentEquity / initialEquityUsdt - 1) * 100) : 0,
    hourlyProfit: profitWithinSamples(clean, 60 * 60 * 1000, currentEquity),
    hourlyReturnPct: returnWithinSamples(clean, 60 * 60 * 1000, currentEquity),
    dailyProfit: profitWithinSamples(clean, 24 * 60 * 60 * 1000, currentEquity),
    dailyReturnPct: returnWithinSamples(clean, 24 * 60 * 60 * 1000, currentEquity),
    monthlyProfit: profitWithinSamples(clean, 30 * 24 * 60 * 60 * 1000, currentEquity),
    monthlyReturnPct: returnWithinSamples(clean, 30 * 24 * 60 * 60 * 1000, currentEquity),
    yearlyProfit: profitWithinSamples(clean, 365 * 24 * 60 * 60 * 1000, currentEquity),
    yearlyReturnPct: returnWithinSamples(clean, 365 * 24 * 60 * 60 * 1000, currentEquity),
    samples: clean.length,
    lastSampleAt: latest?.ts || null
  };
}

function profitWithinSamples(samples, durationMs, currentEquity) {
  if (!samples.length) return 0;
  const latestTs = Date.parse(samples.at(-1)?.ts || "") || Date.now();
  const cutoff = latestTs - durationMs;
  const anchor = samples.find((sample) => Date.parse(sample.ts || "") >= cutoff) || samples[0];
  return roundMoney(Number(currentEquity || 0) - Number(anchor?.equity || 0));
}

function returnWithinSamples(samples, durationMs, currentEquity) {
  if (!samples.length) return 0;
  const latestTs = Date.parse(samples.at(-1)?.ts || "") || Date.now();
  const cutoff = latestTs - durationMs;
  const anchor = samples.find((sample) => Date.parse(sample.ts || "") >= cutoff) || samples[0];
  const start = Number(anchor?.equity || 0);
  return start > 0 ? roundMoney((Number(currentEquity || 0) / start - 1) * 100) : 0;
}

function normalizeModelOperations(actions = [], fallbackTs = new Date().toISOString(), accountId = "", accountLabel = "") {
  return (actions || []).map((item) => ({
    id: `${Date.parse(fallbackTs) || Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ts: fallbackTs,
    accountId,
    accountLabel,
    instId: item.instId || "",
    instType: item.instType || (String(item.instId || "").endsWith("-SWAP") ? "SWAP" : "SPOT"),
    action: item.action || item.side || "watch",
    side: item.side || item.positionSide || item.posSide || "",
    operation: item.operation || "",
    status: item.status || "",
    reason: item.reason || "",
    leverage: Number.isFinite(Number(item.leverage || item.lever)) ? Number(item.leverage || item.lever) : null,
    marginUsdt: Number.isFinite(Number(item.marginUsdt || item.margin || item.requiredCapitalUsdt)) ? roundMoney(Number(item.marginUsdt || item.margin || item.requiredCapitalUsdt)) : null,
    positionSize: Number.isFinite(Number(item.positionSize || item.contracts || item.sz)) ? Number(item.positionSize || item.contracts || item.sz) : null,
    equityBefore: Number.isFinite(Number(item.equityBefore)) ? roundMoney(Number(item.equityBefore)) : null,
    equityAfter: Number.isFinite(Number(item.equityAfter)) ? roundMoney(Number(item.equityAfter)) : null,
    notionalUsd: Number.isFinite(Number(item.notionalUsd)) ? roundMoney(Number(item.notionalUsd)) : null,
    referencePrice: Number.isFinite(Number(item.referencePrice)) ? Number(item.referencePrice) : null,
    realizedPnl: Number.isFinite(Number(item.realizedPnl)) ? roundMoney(Number(item.realizedPnl)) : null,
    realizedReturnPct: Number.isFinite(Number(item.realizedReturnPct)) ? roundMoney(Number(item.realizedReturnPct)) : null,
    executionFee: Number.isFinite(Number(item.executionFee)) ? roundMoney(Number(item.executionFee)) : null
  }));
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

async function getHistoricalBacktests() {
  const store = readHistoricalBacktestStore();
  return (store.runs || [])
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 8)
    .map(compactHistoricalBacktestRun);
}

function compactHistoricalBacktestRun(run = {}) {
  return {
    ...run,
    symbols: Array.isArray(run.symbols) ? run.symbols : [],
    analysisSymbols: Array.isArray(run.analysisSymbols) ? run.analysisSymbols : [],
    rows: (run.rows || []).map((row) => ({
      ...row,
      settings: {
        decisionEngine: row.settings?.decisionEngine,
        minConfidence: row.settings?.minConfidence,
        targetReturn: row.settings?.targetReturn,
        maxDrawdown: row.settings?.maxDrawdown,
        minLeverage: row.settings?.minLeverage,
        maxLeverage: row.settings?.maxLeverage,
        symbolLimit: row.settings?.symbolLimit,
        lookbackDays: run.lookbackDays ?? row.settings?.lookbackDays,
        lookbackBars: run.lookbackBars ?? row.settings?.lookbackBars
      },
      samples: (row.samples || []).slice(-120),
      operations: (row.operations || []).slice(-50)
    }))
  };
}

async function startHistoricalBacktest(input = {}) {
  const startTs = normalizeBacktestDate(input.startDate || input.start || "2022-01-01", "2022-01-01");
  const endTs = normalizeBacktestDate(input.endDate || input.end || "2026-06-01", "2026-06-01");
  if (endTs <= startTs) throw new Error("历史回测结束时间必须晚于开始时间。");
  const bar = normalizeBacktestBar(input.bar || "1D");
  const lookbackDays = clamp(Number(input.lookbackDays ?? input.warmupDays ?? 60), 0, 365);
  const lookbackBars = clamp(Number(input.lookbackBars ?? input.lookbackKlines ?? defaultBacktestLookbackBars(bar)), 20, 100_000);
  const cacheOnly = input.cacheOnly === true || input.mode === "cache-only";
  const accountCount = cacheOnly ? 0 : clamp(Number(input.accountCount || 6), 1, 12);
  const initialEquityUsdt = clamp(Number(input.initialEquityUsdt || TEST_ACCOUNT_DEFAULT_INITIAL_USDT), 1_000, 10_000_000);
  const stepBars = clamp(Number(input.stepBars || input.rebalanceEvery || 1), 1, 30);
  const symbolLimit = clamp(Number(input.symbolLimit || 80), 4, FULL_POSITION_TEST_SYMBOL_LIMIT);
  const analysisSymbolLimit = clamp(Number(input.analysisSymbolLimit || 24), 4, symbolLimit);
  const symbols = await resolveFullPositionTestSymbols({
    ...input,
    symbolLimit,
    refreshUniverse: input.refreshUniverse === true
  });
  const analysisSymbols = selectFullPositionAnalysisSymbols(symbols, {
    ...input,
    analysisSymbolLimit
  });
  const runId = `hbt-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  const variants = buildFullPositionParameterMatrix({
    count: accountCount,
    decisionEngine: input.decisionEngine || "skills",
    symbols: analysisSymbols,
    intervalSeconds: 30
  });
  const rows = variants.map((variant, index) => ({
    id: `${runId}-${index + 1}`,
    modelId: variant.slug,
    modelName: variant.name,
    variant: variant.name,
    slug: variant.slug,
    status: "queued",
    initialEquityUsdt,
    settings: sanitizeAutomationSettings({
      ...variant.settings,
      lookbackDays,
      lookbackBars,
      symbols: analysisSymbols.join(","),
      symbolLimit: analysisSymbols.length,
      productPreference: "swap",
      budgetUsdt: initialEquityUsdt,
      autoBudget: true,
      allowNewPositions: true,
      manageExistingPositions: true
    }),
    samples: [],
    operations: [],
    stats: buildModelLogSummary([], initialEquityUsdt)
  }));
  const run = {
    id: runId,
    name: String(input.name || `历史回测 ${new Date(startTs).toISOString().slice(0, 10)} 至 ${new Date(endTs).toISOString().slice(0, 10)}`).slice(0, 80),
    scope: "backtest",
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    startDate: new Date(startTs).toISOString().slice(0, 10),
    endDate: new Date(endTs).toISOString().slice(0, 10),
    bar,
    lookbackDays,
    lookbackBars,
    stepBars,
    initialEquityUsdt,
    cacheOnly,
    symbols,
    analysisSymbols,
    progress: {
      phase: "queued",
      current: 0,
      total: 0,
      percent: 0,
      message: "等待后台回测任务启动"
    },
    estimate: estimateHistoricalBacktest({
      symbols: analysisSymbols,
      startTs: startTs - lookbackDays * 24 * 60 * 60 * 1000,
      endTs,
      bar,
      stepBars,
      accountCount
    }),
    rows,
    notes: [
      "历史回测使用逐点回放：每个模型在任意回测时点只能读取该时点及以前的K线。",
      "当前回测引擎先按日线组合模型执行，适合快速验证参数优劣；更小周期会显著增加拉取和计算时间。"
    ]
  };

  await updateHistoricalBacktestStore((store) => {
    store.runs = [run, ...(store.runs || [])].slice(0, 20);
    return run;
  });
  const job = { cancelled: false };
  historicalBacktestJobs.set(runId, job);
  setTimeout(() => {
    runHistoricalBacktestJob(runId, job).catch((error) => {
      appendLog({
        level: "error",
        event: "historical_backtest_failed",
        message: `${runId}: ${error.message}`,
        meta: { runId }
      });
    }).finally(() => historicalBacktestJobs.delete(runId));
  }, 0).unref?.();
  return run;
}

async function stopHistoricalBacktest(input = {}) {
  const runId = String(input.runId || input.id || "").trim();
  if (!runId) throw new Error("历史回测 id 不能为空。");
  const job = historicalBacktestJobs.get(runId);
  if (job) job.cancelled = true;
  const run = await updateHistoricalBacktestStore((store) => {
    const target = (store.runs || []).find((item) => item.id === runId);
    if (!target) throw new Error("历史回测不存在。");
    target.status = "stopped";
    target.updatedAt = new Date().toISOString();
    target.progress = {
      ...(target.progress || {}),
      phase: "stopped",
      message: "已手动停止"
    };
    return target;
  });
  return run;
}

async function runHistoricalBacktestJob(runId, job) {
  let run = await updateHistoricalBacktestStore((store) => {
    const target = (store.runs || []).find((item) => item.id === runId);
    if (!target) throw new Error("历史回测不存在。");
    target.status = "running";
    target.startedAt = new Date().toISOString();
    target.updatedAt = target.startedAt;
    target.progress = { phase: "loading-candles", current: 0, total: target.analysisSymbols.length, percent: 0, message: "正在拉取/读取历史K线缓存" };
    target.rows = (target.rows || []).map((row) => ({ ...row, status: "running" }));
    return target;
  });

  const startTs = Date.parse(`${run.startDate}T00:00:00.000Z`);
  const endTs = Date.parse(`${run.endDate}T23:59:59.999Z`);
  const fetchStartTs = startTs - Number(run.lookbackDays || 60) * 24 * 60 * 60 * 1000;
  const candlesBySymbol = {};
  let loaded = 0;
  const candleConcurrency = isLowIntervalBacktestBar(run.bar) ? 1 : 2;
  await mapWithConcurrency(run.analysisSymbols || [], candleConcurrency, async (symbol) => {
    if (job.cancelled) return null;
    candlesBySymbol[symbol] = await fetchHistoricalCandlesCached(symbol, run.bar, fetchStartTs, endTs);
    loaded += 1;
    if (loaded % 4 === 0 || loaded === (run.analysisSymbols || []).length) {
      await updateHistoricalProgress(runId, {
        phase: "loading-candles",
        current: loaded,
        total: (run.analysisSymbols || []).length,
        message: `历史K线已准备 ${loaded}/${(run.analysisSymbols || []).length}`
      });
    }
    return null;
  });
  if (job.cancelled) return;

  if (run.cacheOnly) {
    const finishedAt = new Date().toISOString();
    await updateHistoricalBacktestStore((store) => {
      const target = (store.runs || []).find((item) => item.id === runId);
      if (!target) return null;
      target.status = "completed";
      target.finishedAt = finishedAt;
      target.updatedAt = finishedAt;
      target.rows = [];
      target.progress = {
        phase: "completed",
        current: loaded,
        total: (run.analysisSymbols || []).length,
        percent: 100,
        message: "K线缓存已完成，可反复用于同范围回测"
      };
      target.aggregate = buildHistoricalBacktestAggregate([]);
      return target;
    });
    return;
  }

  const timeline = buildBacktestTimeline(candlesBySymbol, startTs, endTs, Number(run.stepBars || 1));
  const states = new Map((run.rows || []).map((row) => [row.id, createHistoricalAccountState(run.initialEquityUsdt)]));
  const rows = (run.rows || []).map((row) => ({ ...row, samples: [], operations: [] }));
  const totalSteps = timeline.length * rows.length;
  let completedSteps = 0;

  for (const [tickIndex, ts] of timeline.entries()) {
    if (job.cancelled) break;
    const marketData = buildHistoricalMarketData(candlesBySymbol, ts, Number(run.lookbackBars || defaultBacktestLookbackBars(run.bar)), run.analysisSymbols || []);
    for (const row of rows) {
      const state = states.get(row.id);
      const markedBefore = markHistoricalAccount(state, marketData);
      const effectiveSettings = {
        ...row.settings,
        budgetUsdt: Math.max(Number(markedBefore.totalEqUsd || 0), 0),
        symbols: (run.analysisSymbols || []).join(","),
        symbolLimit: (run.analysisSymbols || []).length,
        backtestStartDate: run.startDate,
        backtestEndDate: run.endDate,
        backtestBar: run.bar,
        backtestStepBars: run.stepBars,
        lookbackDays: Number(run.lookbackDays || 0),
        lookbackBars: Number(run.lookbackBars || defaultBacktestLookbackBars(run.bar))
      };
      const plan = buildInvestmentPlan(marketData, effectiveSettings);
      const execution = reconcileHistoricalBacktestAccount(state, plan, marketData, effectiveSettings, ts);
      const markedAfter = markHistoricalAccount(state, marketData);
      const sample = {
        ts: new Date(ts).toISOString(),
        equity: roundMoney(markedAfter.totalEqUsd),
        availableUsdt: roundMoney(state.cashUsdt),
        totalUpl: roundMoney(markedAfter.totalUpl),
        realizedPnl: roundMoney(state.realizedPnl),
        usedMargin: roundMoney(markedAfter.usedMargin),
        marginUsagePct: roundMoney(markedAfter.marginUsagePct),
        positions: state.positions.length,
        winningPositions: markedAfter.positions.filter((position) => Number(position.upl || 0) > 0).length,
        losingPositions: markedAfter.positions.filter((position) => Number(position.upl || 0) < 0).length,
        executed: execution.operations.filter((item) => item.status === "applied-to-backtest").length,
        actionCount: execution.operations.length,
        planConfidence: Number(plan.confidence || 0),
        bestSymbol: plan.best?.symbol || "",
        skipped: execution.operations.every((item) => item.status !== "applied-to-backtest")
      };
      const shouldStoreSample = shouldRecordHistoricalSample(run.bar, tickIndex, timeline.length, execution.operations);
      if (shouldStoreSample) row.samples.push(sample);
      const storedOperations = execution.operations.filter((item) => isTradeOperation(item) || shouldStoreSample);
      row.operations.push(...storedOperations);
      if (row.samples.length > 50_000) row.samples = row.samples.slice(-50_000);
      if (row.operations.length > 120_000) row.operations = trimModelOperations(row.operations);
      row.stats = buildModelLogSummary(shouldStoreSample ? row.samples : [...row.samples, sample], row.initialEquityUsdt);
      completedSteps += 1;
    }
    if (tickIndex % 10 === 0 || tickIndex === timeline.length - 1) {
      run = await persistHistoricalBacktestProgress(runId, rows, {
        phase: "replaying",
        current: completedSteps,
        total: totalSteps,
        message: `正在回放 ${new Date(ts).toISOString().slice(0, 10)}`
      });
    }
  }

  const finalStatus = job.cancelled ? "stopped" : "completed";
  const finishedAt = new Date().toISOString();
  run = await updateHistoricalBacktestStore((store) => {
    const target = (store.runs || []).find((item) => item.id === runId);
    if (!target) return null;
    target.status = finalStatus;
    target.finishedAt = finalStatus === "completed" ? finishedAt : target.finishedAt;
    target.updatedAt = finishedAt;
    target.rows = rows.map((row) => ({
      ...row,
      status: finalStatus,
      samples: row.samples.slice(-240),
      operations: row.operations.slice(-80)
    }));
    target.progress = {
      phase: finalStatus,
      current: completedSteps,
      total: totalSteps,
      percent: totalSteps ? roundMoney(completedSteps / totalSteps * 100) : 0,
      message: finalStatus === "completed" ? "历史回测完成" : "历史回测已停止"
    };
    target.aggregate = buildHistoricalBacktestAggregate(target.rows);
    return target;
  });

  for (const row of rows) {
    writeModelRunLog({
      scope: "backtest",
      runId,
      runName: run?.name || runId,
      modelId: row.modelId || row.slug || row.id,
      modelName: row.modelName || row.variant || row.id,
      rowId: row.id,
      accountId: row.id,
      accountLabel: row.modelName || row.variant || row.id,
      initialEquityUsdt: row.initialEquityUsdt,
      settings: {
        ...(row.settings || {}),
        backtestStartDate: run?.startDate || "",
        backtestEndDate: run?.endDate || "",
        backtestBar: run?.bar || "",
        backtestStepBars: run?.stepBars || 1,
        lookbackDays: run?.lookbackDays ?? row.settings?.lookbackDays ?? 0,
        lookbackBars: run?.lookbackBars ?? row.settings?.lookbackBars ?? defaultBacktestLookbackBars(run?.bar)
      },
      samples: row.samples,
      operations: row.operations
    });
  }

  appendLog({
    level: "info",
    event: "historical_backtest_finished",
    message: `Historical backtest ${runId} ${finalStatus}.`,
    meta: { runId, status: finalStatus, rows: rows.length, samples: rows.reduce((total, row) => total + row.samples.length, 0) }
  });
}

async function updateHistoricalProgress(runId, progress) {
  return updateHistoricalBacktestStore((store) => {
    const target = (store.runs || []).find((item) => item.id === runId);
    if (!target) return null;
    target.progress = {
      ...(target.progress || {}),
      ...progress,
      percent: progress.total ? roundMoney(Number(progress.current || 0) / Number(progress.total || 1) * 100) : Number(target.progress?.percent || 0)
    };
    target.updatedAt = new Date().toISOString();
    return target;
  });
}

async function persistHistoricalBacktestProgress(runId, rows, progress) {
  return updateHistoricalBacktestStore((store) => {
    const target = (store.runs || []).find((item) => item.id === runId);
    if (!target) return null;
    target.rows = rows.map((row) => ({
      ...row,
      samples: row.samples.slice(-240),
      operations: row.operations.slice(-80)
    }));
    target.progress = {
      ...(target.progress || {}),
      ...progress,
      percent: progress.total ? roundMoney(Number(progress.current || 0) / Number(progress.total || 1) * 100) : Number(target.progress?.percent || 0)
    };
    target.aggregate = buildHistoricalBacktestAggregate(target.rows);
    target.updatedAt = new Date().toISOString();
    return target;
  });
}

function buildHistoricalBacktestAggregate(rows = []) {
  const active = rows.filter((row) => row.stats);
  if (!active.length) return { accountCount: 0, avgReturnPct: 0, best: null };
  const ranked = active.slice().sort((a, b) => Number(b.stats.totalReturnPct || 0) - Number(a.stats.totalReturnPct || 0));
  return {
    accountCount: active.length,
    avgReturnPct: roundMoney(mean(active.map((row) => Number(row.stats.totalReturnPct || 0)))),
    avgDailyReturnPct: roundMoney(mean(active.map((row) => Number(row.stats.dailyReturnPct || 0)))),
    avgMonthlyReturnPct: roundMoney(mean(active.map((row) => Number(row.stats.monthlyReturnPct || 0)))),
    best: ranked[0] ? {
      rowId: ranked[0].id,
      modelId: ranked[0].modelId,
      modelName: ranked[0].modelName,
      totalReturnPct: ranked[0].stats.totalReturnPct,
      totalProfit: ranked[0].stats.totalProfit
    } : null
  };
}

async function fetchHistoricalCandlesCached(instId, bar, startTs, endTs) {
  const filePath = path.join(
    historicalCandlesDir,
    sanitizePathSegment(instId),
    `${sanitizePathSegment(bar)}-${new Date(startTs).toISOString().slice(0, 10)}-${new Date(endTs).toISOString().slice(0, 10)}.json`
  );
  const cached = readJsonFile(filePath, null);
  if (cached?.instId === instId && cached.bar === bar && Array.isArray(cached.candles) && cached.candles.length) {
    return inflateHistoricalCandles(cached.candles);
  }
  const candles = await fetchHistoricalCandlesRange(instId, bar, startTs, endTs);
  writeJsonFile(filePath, {
    version: 2,
    instId,
    bar,
    start: new Date(startTs).toISOString(),
    end: new Date(endTs).toISOString(),
    fetchedAt: new Date().toISOString(),
    format: "compact-v1",
    candleCount: candles.length,
    candles: compactHistoricalCandles(candles)
  });
  return candles;
}

async function fetchHistoricalCandlesRange(instId, bar, startTs, endTs) {
  const candles = [];
  const seen = new Set();
  let cursor = endTs + barIntervalMs(bar);
  let previousOldest = Infinity;
  const expectedPages = Math.ceil(Math.max(endTs - startTs, 1) / barIntervalMs(bar) / 300) + 10;
  const maxPages = clamp(expectedPages, 20, 30_000);
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await okx.getHistoricalCandlesPage(instId, bar, 300, { after: cursor });
    if (!page.length) break;
    for (const candle of page) {
      if (candle.ts < startTs || candle.ts > endTs || seen.has(candle.ts)) continue;
      seen.add(candle.ts);
      candles.push(candle);
    }
    const oldest = Math.min(...page.map((candle) => candle.ts));
    if (!Number.isFinite(oldest) || oldest <= startTs || oldest >= previousOldest) break;
    previousOldest = oldest;
    cursor = oldest;
  }
  return candles.sort((a, b) => a.ts - b.ts);
}

function compactHistoricalCandles(candles = []) {
  return candles.map((candle) => [
    Number(candle.ts),
    Number(candle.open),
    Number(candle.high),
    Number(candle.low),
    Number(candle.close),
    Number(candle.vol || 0),
    Number(candle.volCcy || 0),
    Number(candle.volQuote || 0)
  ]);
}

function inflateHistoricalCandles(candles = []) {
  return candles
    .map((item) => {
      if (!Array.isArray(item)) return item;
      const [ts, open, high, low, close, vol, volCcy, volQuote] = item;
      return {
        ts: Number(ts),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        vol: Number(vol || 0),
        volCcy: Number(volCcy || 0),
        volQuote: Number(volQuote || 0)
      };
    })
    .filter((candle) => Number.isFinite(Number(candle?.ts)) && Number(candle?.close || 0) > 0)
    .sort((a, b) => a.ts - b.ts);
}

function buildBacktestTimeline(candlesBySymbol, startTs, endTs, stepBars = 1) {
  const source = Object.values(candlesBySymbol).find((candles) => Array.isArray(candles) && candles.some((candle) => candle.ts >= startTs && candle.ts <= endTs)) || [];
  return source
    .filter((candle) => candle.ts >= startTs && candle.ts <= endTs)
    .filter((candle, index) => index % Math.max(Number(stepBars || 1), 1) === 0)
    .map((candle) => candle.ts);
}

function buildHistoricalMarketData(candlesBySymbol, ts, lookbackDays, symbols = []) {
  const marketData = {};
  for (const symbol of symbols) {
    const candles = (candlesBySymbol[symbol] || []).filter((candle) => candle.ts <= ts).slice(-Math.max(Number(lookbackDays || 60), 20));
    if (!candles.length) continue;
    const last = candles.at(-1);
    marketData[symbol] = {
      ticker: {
        instId: symbol,
        last: last.close,
        bidPx: last.close,
        askPx: last.close,
        vol24h: last.vol || 0,
        volCcy24h: last.vol || 0,
        volCcyQuote24h: last.volQuote || 0
      },
      candles
    };
  }
  return marketData;
}

function createHistoricalAccountState(initialEquityUsdt) {
  return {
    initialEquityUsdt,
    cashUsdt: initialEquityUsdt,
    realizedPnl: 0,
    positions: []
  };
}

function reconcileHistoricalBacktestAccount(state, plan, marketData, settings, ts) {
  const operations = [];
  const equity = markHistoricalAccount(state, marketData).totalEqUsd;
  const minOrderUsdt = clamp(Number(settings.minOrderUsdt || 10), 1, Math.max(equity, 1));
  const maxActionsPerCycle = clamp(Number(settings.maxActionsPerCycle || 6), 1, 12);
  const minConfidence = clamp(Number(settings.minConfidence || 0), 0, 100);
  const targetReturn = clamp(Number(settings.targetReturn || 12), 0.1, 1000);
  const maxDrawdown = clamp(Number(settings.maxDrawdown || 8), 0.1, 100);
  const desired = (plan.assets || [])
    .filter((asset) => Number(asset.targetPct || 0) > 0 && marketData[asset.symbol])
    .slice(0, 6);
  const desiredMap = new Map(desired.map((asset) => [asset.symbol, asset]));
  let actionCount = 0;

  for (const position of [...state.positions]) {
    if (actionCount >= maxActionsPerCycle) break;
    const mark = markHistoricalPosition(position, marketData[position.instId]);
    const target = desiredMap.get(position.instId);
    let action = "";
    let reason = "";
    if (mark.uplRatioPct >= targetReturn) {
      action = "close";
      reason = `达到目标收益 ${targetReturn}%`;
    } else if (mark.uplRatioPct <= -maxDrawdown) {
      action = "close";
      reason = `触发最大回撤 ${maxDrawdown}%`;
    } else if (!target) {
      action = "close";
      reason = "模型目标池移除该标的，历史回测平仓";
    }
    if (action) {
      operations.push(closeHistoricalPosition(state, position, marketData[position.instId], reason, ts, marketData));
      actionCount += 1;
    }
  }

  if (Number(plan.confidence || 0) < minConfidence) {
    operations.push({
      ts: new Date(ts).toISOString(),
      action: "watch",
      status: "skipped",
      operation: "置信度等待",
      reason: `计划置信度 ${Number(plan.confidence || 0)}% 低于阈值 ${minConfidence}%`
    });
    return { operations };
  }

  for (const target of desired) {
    if (actionCount >= maxActionsPerCycle) break;
    const market = marketData[target.symbol];
    if (!market) continue;
    const price = Number(market.ticker?.last || market.candles?.at(-1)?.close || 0);
    if (price <= 0) continue;
    const existing = state.positions.find((position) => position.instId === target.symbol);
    const marked = existing ? markHistoricalPosition(existing, market) : null;
    const targetCapital = equity * Number(target.targetPct || 0) / 100;
    const currentCapital = existing ? Number(marked.capitalValue || 0) : 0;
    const deficit = targetCapital - currentCapital;
    if (deficit < minOrderUsdt) continue;
    operations.push(openHistoricalPosition(state, target, market, settings, deficit, ts, marketData));
    actionCount += 1;
  }

  return { operations };
}

function openHistoricalPosition(state, target, market, settings, capitalUsdt, ts, marketData = null) {
  const instId = target.symbol;
  const instType = instId.endsWith("-SWAP") ? "SWAP" : "SPOT";
  const price = Number(market.ticker?.last || market.candles?.at(-1)?.close || 0);
  const feeRate = Number(settings.feeRate || 0.0005);
  const leverage = instType === "SWAP"
    ? snapOkxLeverage(clamp(Number(settings.minLeverage || 5), 1, Number(settings.maxLeverage || 20)))
    : 1;
  const capital = Math.min(Math.max(Number(capitalUsdt || 0), 0), Math.max(Number(state.cashUsdt || 0) - 1, 0));
  const notional = instType === "SWAP" ? capital * leverage : capital;
  const fee = notional * feeRate;
  const side = instType === "SWAP" && target.preferredSide === "short" ? "short" : "long";
  const before = markHistoricalAccount(state, marketData || { [instId]: market });
  if (price <= 0 || capital <= 0 || capital + fee > state.cashUsdt) {
    return {
      ts: new Date(ts).toISOString(),
      instId,
      instType,
      action: "watch",
      status: "skipped",
      operation: "资金不足",
      reason: "历史回测资金不足或价格不可用"
    };
  }
  const units = notional / price;
  const signedUnits = side === "short" ? -units : units;
  const existing = state.positions.find((position) => position.instId === instId);
  if (existing) {
    const nextAbsUnits = Math.abs(existing.pos) + units;
    existing.avgPx = ((existing.avgPx * Math.abs(existing.pos)) + (price * units)) / Math.max(nextAbsUnits, 0.00000001);
    existing.pos = existing.pos < 0 ? -nextAbsUnits : nextAbsUnits;
    existing.capital += capital;
    existing.fee += fee;
  } else {
    state.positions.push({
      instId,
      instType,
      posSide: side,
      pos: signedUnits,
      avgPx: price,
      capital,
      lever: leverage,
      fee,
      feeRate,
      cTime: ts
    });
  }
  state.cashUsdt -= capital + fee;
  state.realizedPnl -= fee;
  const after = markHistoricalAccount(state, marketData || { [instId]: market });
  return {
    ts: new Date(ts).toISOString(),
    instId,
    instType,
    action: existing ? "add" : "open",
    side,
    status: "applied-to-backtest",
    operation: existing ? "历史加仓" : "历史开仓",
    reason: target.reason || "模型目标配置增加",
    leverage,
    marginUsdt: roundMoney(capital),
    positionSize: Number(signedUnits),
    equityBefore: roundMoney(before.totalEqUsd),
    equityAfter: roundMoney(after.totalEqUsd),
    notionalUsd: roundMoney(notional),
    referencePrice: price,
    executionFee: roundMoney(fee)
  };
}

function closeHistoricalPosition(state, position, market, reason, ts, marketData = null) {
  const price = Number(market?.ticker?.last || market?.candles?.at(-1)?.close || 0);
  const feeRate = Number(position.feeRate || 0.0005);
  const notional = Math.abs(Number(position.pos || 0)) * price;
  const fee = notional * feeRate;
  const before = markHistoricalAccount(state, marketData || { [position.instId]: market });
  const pnl = position.instType === "SWAP"
    ? (price - position.avgPx) * position.pos
    : notional - position.capital;
  const cashReturn = position.instType === "SWAP" ? position.capital + pnl - fee : notional - fee;
  state.cashUsdt += cashReturn;
  state.realizedPnl += pnl - fee;
  state.positions = state.positions.filter((item) => item !== position);
  const after = markHistoricalAccount(state, marketData || { [position.instId]: market });
  return {
    ts: new Date(ts).toISOString(),
    instId: position.instId,
    instType: position.instType,
    action: "close",
    side: position.posSide || (Number(position.pos || 0) < 0 ? "short" : "long"),
    status: "applied-to-backtest",
    operation: "历史平仓",
    reason,
    leverage: Number(position.lever || 1),
    marginUsdt: roundMoney(position.capital),
    positionSize: Number(position.pos || 0),
    equityBefore: roundMoney(before.totalEqUsd),
    equityAfter: roundMoney(after.totalEqUsd),
    notionalUsd: roundMoney(notional),
    referencePrice: price,
    realizedPnl: roundMoney(pnl - fee),
    realizedReturnPct: Number(position.capital || 0) > 0 ? roundMoney((pnl - fee) / Number(position.capital || 1) * 100) : null,
    executionFee: roundMoney(fee)
  };
}

function markHistoricalAccount(state, marketData) {
  const positions = state.positions.map((position) => markHistoricalPosition(position, marketData[position.instId])).filter(Boolean);
  const spotValue = sum(positions.filter((position) => position.instType === "SPOT").map((position) => Number(position.notionalUsd || 0)));
  const derivativeCapital = sum(positions.filter((position) => position.instType === "SWAP").map((position) => Number(position.capital || 0) + Number(position.upl || 0)));
  const totalUpl = sum(positions.map((position) => Number(position.upl || 0)));
  const usedMargin = sum(positions.filter((position) => position.instType === "SWAP").map((position) => Number(position.capital || 0)));
  const totalEqUsd = Number(state.cashUsdt || 0) + spotValue + derivativeCapital;
  return {
    totalEqUsd,
    totalUpl,
    usedMargin,
    marginUsagePct: totalEqUsd > 0 ? usedMargin / totalEqUsd * 100 : 0,
    positions
  };
}

function markHistoricalPosition(position, market) {
  if (!position || !market) return null;
  const price = Number(market.ticker?.last || market.candles?.at(-1)?.close || 0);
  if (price <= 0) return null;
  const notionalUsd = Math.abs(Number(position.pos || 0)) * price;
  const upl = position.instType === "SWAP"
    ? (price - position.avgPx) * position.pos
    : notionalUsd - position.capital;
  const denominator = position.instType === "SWAP" ? Number(position.capital || 0) : Math.max(Number(position.capital || 0), 1);
  return {
    ...position,
    markPx: price,
    notionalUsd,
    upl,
    uplRatioPct: denominator > 0 ? upl / denominator * 100 : 0,
    capitalValue: position.instType === "SWAP" ? Number(position.capital || 0) : notionalUsd
  };
}

function readHistoricalBacktestStore() {
  const parsed = readJsonFile(historicalBacktestsPath, { version: 1, runs: [] });
  return {
    version: 1,
    runs: Array.isArray(parsed.runs) ? parsed.runs : []
  };
}

async function updateHistoricalBacktestStore(mutator) {
  const task = historicalBacktestStoreWrite.catch(() => null).then(async () => {
    const store = readHistoricalBacktestStore();
    const result = await mutator(store);
    writeJsonFile(historicalBacktestsPath, {
      version: 1,
      runs: (store.runs || []).slice(0, 20)
    });
    return result;
  });
  historicalBacktestStoreWrite = task.catch(() => null);
  return task;
}

function normalizeBacktestDate(value, fallback) {
  const parsed = Date.parse(`${String(value || fallback).slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return Date.parse(`${fallback}T00:00:00.000Z`);
  return parsed;
}

function shouldRecordHistoricalSample(bar, tickIndex, totalTicks, operations = []) {
  if (tickIndex <= 0 || tickIndex >= totalTicks - 1) return true;
  if ((operations || []).some(isTradeOperation)) return true;
  const stride = historicalSampleStride(bar);
  return tickIndex % stride === 0;
}

function historicalSampleStride(bar) {
  const normalized = normalizeBacktestBar(bar);
  if (normalized === "1m") return 30;
  if (normalized === "3m") return 20;
  if (normalized === "5m") return 12;
  if (normalized === "15m") return 4;
  return 1;
}

function normalizeBacktestBar(value) {
  const raw = String(value || "1D").trim();
  const normalized = raw.endsWith("h") ? raw.replace("h", "H") : raw;
  return ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D"].includes(normalized) ? normalized : "1D";
}

function barIntervalMs(bar) {
  if (bar === "1m") return 60 * 1000;
  if (bar === "3m") return 3 * 60 * 1000;
  if (bar === "5m") return 5 * 60 * 1000;
  if (bar === "15m") return 15 * 60 * 1000;
  if (bar === "30m") return 30 * 60 * 1000;
  if (bar === "1H") return 60 * 60 * 1000;
  if (bar === "2H") return 2 * 60 * 60 * 1000;
  if (bar === "4H") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function isLowIntervalBacktestBar(bar) {
  return ["1m", "3m", "5m"].includes(normalizeBacktestBar(bar));
}

function defaultBacktestLookbackBars(bar) {
  const normalized = normalizeBacktestBar(bar);
  if (normalized === "1m") return 240;
  if (["3m", "5m", "15m", "30m"].includes(normalized)) return 160;
  if (["1H", "2H", "4H"].includes(normalized)) return 120;
  return 90;
}

function estimateHistoricalBacktest({ symbols = [], startTs, endTs, bar, stepBars = 1, accountCount = 1 }) {
  const bars = Math.max(Math.ceil((endTs - startTs) / barIntervalMs(bar)), 1);
  const pagesPerSymbol = Math.ceil(bars / 300) + 1;
  const requestCount = symbols.length * pagesPerSymbol;
  const minutes = requestCount * 0.32 / 60;
  const replaySteps = Math.ceil(bars / Math.max(Number(stepBars || 1), 1)) * Math.max(Number(accountCount || 0), 0);
  const estimatedCompactBytes = bars * symbols.length * 72;
  return {
    bars,
    symbols: symbols.length,
    estimatedOkxRequests: requestCount,
    estimatedFetchMinutes: roundMoney(Math.max(minutes, 0.1)),
    estimatedFetchHours: roundMoney(Math.max(minutes / 60, 0.01)),
    estimatedReplaySteps: replaySteps,
    estimatedCacheMb: roundMoney(estimatedCompactBytes / 1024 / 1024)
  };
}

function automationContractScore(contract) {
  const timingScore = contract.recommendation.timing.state === "enter" ? 100 : contract.recommendation.timing.state === "watch" ? 30 : 0;
  const flow = contract.market?.orderFlow;
  const flowBias = flow?.aiBias || flow?.direction;
  const flowAdjustment = flowBias === contract.side ? Number(flow?.aiConfidence || flow?.confidence || 0) * 0.35
    : flowBias && flowBias !== "neutral" ? -Number(flow?.aiConfidence || flow?.confidence || 0) * 0.35 : 0;
  const trend = contract.recommendation.trend;
  const trendAdjustment = trend
    ? (Number(trend.confidence || 0) - 50) * 0.65
      + (trend.aligned ? 18 : 0)
      - (trend.blocked ? 45 : 0)
    : 0;
  return timingScore + flowAdjustment + trendAdjustment - Number(contract.recommendation.riskScore || 0);
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

async function buildAccountsOverview(options = {}) {
  const force = Boolean(options.force);
  const now = Date.now();
  if (!force && accountsOverviewCache && now - accountsOverviewCache.at <= ACCOUNTS_OVERVIEW_CACHE_MS) {
    return clonePayload(accountsOverviewCache.value);
  }
  if (!force && accountsOverviewPending) return clonePayload(await accountsOverviewPending);

  const version = accountsOverviewCacheVersion;
  accountsOverviewPending = buildAccountsOverviewFresh()
    .then((overview) => {
      if (version === accountsOverviewCacheVersion) {
        accountsOverviewCache = { at: Date.now(), value: clonePayload(overview) };
      }
      return overview;
    })
    .finally(() => {
      accountsOverviewPending = null;
    });

  return clonePayload(await accountsOverviewPending);
}

async function buildAccountsOverviewFresh() {
  const credentials = okx.credentialsStatus();
  const fullPositionIds = fullPositionTestAccountIdsFromStore();
  const visibleTestAccounts = testAccounts.list().filter((descriptor) => !isFullPositionTestDescriptor(descriptor, fullPositionIds));
  const accounts = await Promise.all(visibleTestAccounts.map(async (descriptor) => ({
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
      const liveAccount = await withTimeout(
        loadAccountSummary("live-readonly"),
        Number(process.env.ACCOUNTS_LIVE_TIMEOUT_MS || 2500),
        null
      );
      accounts.push({
        id: "live-readonly",
        source: "live-readonly",
        label: "真实账户只读",
        status: liveAccount ? "connected" : "unavailable",
        writable: false,
        automation: null,
        ...(liveAccount ? { account: liveAccount } : { message: "真实账户读取正在排队，账户管理先显示本地测试账户。" })
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

function fullPositionTestAccountIdsFromStore(store = readFullPositionStore()) {
  const ids = new Set();
  for (const suite of store.suites || []) {
    for (const row of suite.rows || []) {
      if (row.accountId) ids.add(row.accountId);
    }
  }
  return ids;
}

function isFullPositionTestDescriptor(descriptor = {}, knownIds = fullPositionTestAccountIdsFromStore()) {
  return descriptor.purpose === FULL_POSITION_ACCOUNT_PURPOSE
    || knownIds.has(descriptor.id)
    || String(descriptor.label || "").startsWith("fps-");
}

function invalidateAccountsOverviewCache() {
  accountsOverviewCacheVersion += 1;
  accountsOverviewCache = null;
  accountsOverviewPending = null;
}

function clonePayload(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallbackValue), Math.max(Number(timeoutMs || 0), 1));
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const queue = Array.isArray(items) ? items : [];
  const limit = clamp(Number(concurrency || 1), 1, Math.max(queue.length, 1));
  const results = new Array(queue.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(queue[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
  return results;
}

function buildAccountOperations(accounts = []) {
  const accountLabels = new Map(accounts.map((entry) => [entry.id, entry.label]));
  const operations = [];

  for (const [logIndex, entry] of currentAuditLog().slice(-240).entries()) {
    const meta = entry.meta || {};
    const event = entry.event || "event";
    const accountId = String(meta.accountId || "");
    const rows = Array.isArray(meta.results) ? meta.results : [];

    if (rows.length) {
      rows.forEach((row, rowIndex) => {
        operations.push(normalizeOperationRecord({
          entry,
          event,
          meta,
          row,
          accountLabels,
          index: `${logIndex}-${rowIndex}`
        }));
      });
      continue;
    }

    if (!isAccountOperationEvent(event) && !accountId) continue;
    operations.push(normalizeOperationRecord({
      entry,
      event,
      meta,
      row: null,
      accountLabels,
      index: `${logIndex}-event`
    }));
  }

  return operations
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, 160);
}

function normalizeOperationRecord({ entry, event, meta, row, accountLabels, index }) {
  const accountId = String(meta.accountId || row?.accountId || "");
  const source = inferOperationSource(event, meta);
  const action = row?.action || row?.side || "";
  const operation = row?.operation || operationTextFromAction(row?.instType, action, row?.positionSide || row?.side);
  const instId = row?.instId || row?.symbol || "";
  const status = row?.status || (entry.level === "error" ? "failed" : "completed");
  const reason = row?.reason || entry.message || "";
  return {
    id: `${entry.ts}-${event}-${index}-${instId || accountId || "system"}`,
    ts: entry.ts,
    accountId: accountId || "system",
    accountLabel: accountLabels.get(accountId) || meta.accountLabel || (accountId === "live-readonly" ? "Live readonly" : accountId || "System"),
    source,
    ai: source === "ai",
    event,
    instId,
    instType: row?.instType || "",
    action,
    operation,
    status,
    reason,
    dryRun: Boolean(meta.dryRun || row?.status === "dry-run"),
    referencePrice: numberOrNull(row?.referencePrice || row?.adjustment?.referencePrice),
    notionalUsd: numberOrNull(row?.notionalUsd || row?.adjustment?.notionalUsd),
    executionFee: numberOrNull(row?.executionFee || row?.adjustment?.executionFee),
    realizedPnl: numberOrNull(row?.realizedPnl || row?.adjustment?.realizedPnl),
    message: entry.message
  };
}

function inferOperationSource(event, meta = {}) {
  if (meta.source === "automation" || event.startsWith("automation_") || event.startsWith("autopilot_")) return "ai";
  if (meta.source === "manual" || event === "test_position_adjusted" || event === "test_positions_updated") return "manual";
  return "system";
}

function isAccountOperationEvent(event) {
  return [
    "autopilot_enabled",
    "autopilot_disabled",
    "autopilot_run",
    "autopilot_failed",
    "automation_existing_positions_only",
    "automation_portfolio_reconciled",
    "full_position_test_started",
    "full_position_test_stopped",
    "full_position_initial_run_failed",
    "full_position_sample_failed",
    "test_account_created",
    "test_account_deleted",
    "test_accounts_purged",
    "test_account_reset",
    "test_position_adjusted",
    "test_positions_updated"
  ].includes(event);
}

function operationTextFromAction(instType, action, side) {
  if (!action) return "";
  if (["add", "reduce", "close"].includes(action)) return automatedOperationLabel(instType || "SPOT", action, side);
  if (action === "buy") return instType === "SWAP" ? "Open long" : "Buy";
  if (action === "sell") return instType === "SWAP" ? "Open short" : "Sell";
  return action;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readFavorites() {
  const parsed = readJsonFile(favoritesPath, { favorites: [] });
  return sanitizeFavoriteIds(parsed.favorites || []);
}

function sanitizeFavoriteIds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const favorites = [];
  for (const item of input) {
    const instId = String(item || "").trim().toUpperCase();
    if (!/^[A-Z0-9]+-[A-Z0-9]+(?:-SWAP)?$/.test(instId)) continue;
    if (isStableInstrument(instId)) continue;
    if (seen.has(instId)) continue;
    seen.add(instId);
    favorites.push(instId);
  }
  return favorites.slice(0, 80);
}

function sanitizeExplicitUniverse(value, max = 16) {
  const hasValue = Array.isArray(value)
    ? value.length > 0
    : String(value || "").trim().length > 0;
  if (!hasValue) return [];
  return sanitizeUniverse(value, { max });
}

function isLegacyAutomationSymbolPool(value) {
  const symbols = Array.isArray(value) ? sanitizeUniverse(value) : sanitizeExplicitUniverse(value);
  if (symbols.length !== LEGACY_AUTOMATION_SYMBOL_POOL.length) return false;
  const legacy = new Set(LEGACY_AUTOMATION_SYMBOL_POOL);
  return symbols.every((item) => legacy.has(item));
}

function restoreAutomationConfigs() {
  const parsed = readJsonFile(automationConfigPath, { accounts: {} });
  const accounts = parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {};
  for (const [accountId, state] of Object.entries(accounts)) {
    try {
      const normalizedId = normalizeTestAccountId(accountId);
      testAccounts.descriptor(normalizedId);
      autopilot.configure({
        enabled: Boolean(state.enabled),
        intervalSeconds: Number(state.intervalSeconds || 30),
        startDelaySeconds: Number(state.startDelaySeconds || 0),
        executionMode: state.executionMode || "auto",
        dryRun: state.dryRun !== false,
        accountId: normalizedId,
        settings: sanitizeAutomationSettings(state.settings || {})
      }).catch((error) => {
        appendLog({ level: "warn", event: "automation_restore_failed", message: `${normalizedId}: ${error.message}` });
      });
    } catch {
      // Ignore automation records for deleted local test accounts.
    }
  }
}

function saveAutomationConfig(accountId, state) {
  const parsed = readJsonFile(automationConfigPath, { version: 1, accounts: {} });
  const accounts = parsed.accounts && typeof parsed.accounts === "object" ? parsed.accounts : {};
  accounts[accountId] = {
    enabled: Boolean(state.enabled),
    intervalSeconds: Number(state.intervalSeconds || 30),
    startDelaySeconds: Number(state.startDelaySeconds || 0),
    executionMode: state.executionMode || "auto",
    dryRun: state.dryRun !== false,
    accountId,
    settings: sanitizeAutomationSettings(state.settings || {}),
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(automationConfigPath, { version: 1, accounts });
}

function removeAutomationConfig(accountId) {
  const parsed = readJsonFile(automationConfigPath, { version: 1, accounts: {} });
  if (!parsed.accounts || typeof parsed.accounts !== "object") return;
  delete parsed.accounts[accountId];
  writeJsonFile(automationConfigPath, { version: 1, accounts: parsed.accounts });
}

function sanitizeAutomationSettings(settings = {}) {
  const symbolLimit = clamp(Number(settings.symbolLimit || 80), 16, 500);
  const explicitSymbols = sanitizeExplicitUniverse(settings.symbols, symbolLimit);
  const legacySymbolPool = isLegacyAutomationSymbolPool(explicitSymbols);
  const symbols = legacySymbolPool ? [] : explicitSymbols;
  const requestedProductPreference = ["spot", "swap", "both"].includes(String(settings.productPreference))
    ? String(settings.productPreference)
    : "swap";
  const productPreference = legacySymbolPool && requestedProductPreference === "both"
    ? "swap"
    : requestedProductPreference;
  const maxLeverage = snapOkxLeverage(Math.max(Number(settings.maxLeverage || AUTOMATION_DEFAULT_MIN_LEVERAGE), AUTOMATION_DEFAULT_MIN_LEVERAGE));
  const minLeverage = Math.min(
    snapOkxLeverage(Math.max(Number(settings.minLeverage || AUTOMATION_DEFAULT_MIN_LEVERAGE), AUTOMATION_DEFAULT_MIN_LEVERAGE)),
    maxLeverage
  );
  return {
    ...settings,
    autoBudget: settings.autoBudget !== false,
    budgetUsdt: clamp(Number(settings.budgetUsdt || 0), 0, 10_000_000),
    lookbackDays: clamp(Number(settings.lookbackDays || 60), 30, 300),
    riskLevel: clamp(Number(settings.riskLevel || 5), 1, 10),
    maxAssetWeight: clamp(Number(settings.maxAssetWeight || 35), 1, 90),
    minOrderUsdt: clamp(Number(settings.minOrderUsdt || 10), 1, 1_000_000),
    targetReturn: clamp(Number(settings.targetReturn || 12), 0.1, 1000),
    maxDrawdown: clamp(Number(settings.maxDrawdown || 8), 0.1, 100),
    minConfidence: clamp(Number(settings.minConfidence || 0), 0, 100),
    productPreference,
    minLeverage,
    maxLeverage,
    maxActionsPerCycle: clamp(Number(settings.maxActionsPerCycle || 6), 1, 12),
    decisionEngine: normalizeDecisionMode(settings.decisionEngine || "hybrid"),
    tradingAgentsWeight: clamp(Number(settings.tradingAgentsWeight ?? 50), 0, 100),
    forceTradingAgents: Boolean(settings.forceTradingAgents),
    symbolLimit,
    symbols: symbols.join(",")
  };
}

function getAutomationDecisionOverride(settings = {}, instId = "") {
  const overrides = settings.automationDecisionOverrides;
  if (!overrides || typeof overrides !== "object") return null;
  const normalized = String(instId || "").trim().toUpperCase();
  return overrides[normalized] || null;
}

function ensureWritableTestAccount(source) {
  if (normalizeAccountSource(source) !== "test") {
    throw new Error("当前为真实账户只读模式，不能从界面修改持仓或应用组合计划。");
  }
}

async function fetchLiveValuationMarkets(instIds) {
  const uniqueInstIds = [...new Set((instIds || []).filter(Boolean).map((instId) => String(instId).toUpperCase()))];
  if (!uniqueInstIds.length) return new Map();

  const types = [...new Set(uniqueInstIds.map((instId) => String(instId || "").endsWith("-SWAP") ? "SWAP" : "SPOT"))];
  const [tickerResults, instrumentResults] = await Promise.all([
    Promise.all(types.map(async (instType) => {
      try {
        return [instType, await okx.getTickers(instType)];
      } catch (error) {
        appendLog({ level: "warn", event: "tickers_failed", message: `${instType}: ${error.message}` });
        return [instType, []];
      }
    })),
    Promise.all(types.map(async (instType) => {
      try {
        return [instType, await okx.getInstruments(instType)];
      } catch (error) {
        appendLog({ level: "warn", event: "instruments_failed", message: `${instType}: ${error.message}` });
        return [instType, []];
      }
    }))
  ]);
  const tickerMap = new Map(tickerResults.flatMap(([, rows]) => rows.map((row) => [row.instId, row])));
  const instrumentMap = new Map(instrumentResults.flatMap(([, rows]) => rows.map((row) => [row.instId, row])));

  const entries = await Promise.all(uniqueInstIds.map(async (instId) => {
    const instType = String(instId || "").endsWith("-SWAP") ? "SWAP" : "SPOT";
    try {
      const ticker = tickerMap.get(instId);
      const instrument = instrumentMap.get(instId) || {};
      const [mark, fundingRate] = await Promise.all([
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
        instrument
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
  const notionalUsd = Number(item.notionalUsd || Math.abs(Number(item.pos || 0)) * markPx);
  const maintenanceMarginUsd = Number(item.maintenanceMarginUsd || item.mmr || 0);
  const maintenanceMarginRatePct = Number(item.maintenanceMarginRatePct || (notionalUsd > 0 ? maintenanceMarginUsd / notionalUsd * 100 : 0));
  const maintenanceMarginRatioPct = Number(item.maintenanceMarginRatioPct || item.mgnRatio || 0);
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
    notionalUsd: roundMoney(notionalUsd),
    margin: roundMoney(Number(item.margin || item.capital || 0)),
    marginMode: String(item.mgnMode || (item.instType === "SPOT" ? "cash" : "isolated")),
    maintenanceMarginUsd: roundMoney(maintenanceMarginUsd || notionalUsd * maintenanceMarginRatePct / 100),
    maintenanceMarginRatePct: roundMoney(maintenanceMarginRatePct),
    maintenanceMarginRatioPct: roundMoney(maintenanceMarginRatioPct),
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

function productPreferenceMismatch(position = {}, preference = "both") {
  if (preference === "swap") return position.instType === "SPOT";
  if (preference === "spot") return position.instType !== "SPOT";
  return false;
}

function matchesProductPreferenceSymbol(symbol = "", preference = "both") {
  if (preference === "swap") return String(symbol).endsWith("-SWAP");
  if (preference === "spot") return !String(symbol).endsWith("-SWAP");
  return true;
}

function automationPositionSymbols(positions = [], preference = "both") {
  return positions
    .filter((position) => !productPreferenceMismatch(position, preference))
    .map((position) => position.instId);
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
    const key = trimmed.slice(0, index).trim().replace(/^\uFEFF/, "");
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
  const record = {
    ts: new Date().toISOString(),
    level: entry.level || "info",
    event: entry.event || "event",
    message: entry.message || "",
    meta: redact(entry.meta || {})
  };
  auditLog.push(record);
  if (auditLog.length > 500) auditLog.shift();
  persistAuditLog(record);
}

function readAuditLog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry && typeof entry === "object" && entry.ts)
      .slice(-500);
  } catch {
    return [];
  }
}

function currentAuditLog() {
  const merged = new Map();
  for (const entry of [...readAuditLog(auditLogPath), ...auditLog]) {
    if (!entry?.ts) continue;
    merged.set(`${entry.ts}:${entry.event}:${entry.message}`, entry);
  }
  return [...merged.values()]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(-500);
}

function persistAuditLog(record) {
  try {
    fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
    fs.appendFileSync(auditLogPath, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.warn(`Unable to persist audit log: ${error.message}`);
  }
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function mean(values) {
  const clean = values.map((value) => Number(value)).filter(Number.isFinite);
  return clean.length ? sum(clean) / clean.length : 0;
}

function sum(values) {
  return values.reduce((total, item) => total + item, 0);
}
