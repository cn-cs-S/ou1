import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
const auditLogPath = path.join(rootDir, "data", "audit-log.jsonl");
const modelLogsDir = path.join(rootDir, "data", "model-logs");
const modelLogsByModelDir = path.join(rootDir, "data", "model-logs-by-model");

const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const intervalMs = Math.max(Number(process.env.MODEL_LOG_REPAIR_INTERVAL_MS || 20_000), 5_000);
let running = false;

async function main() {
  if (watch) {
    await repairAllModelLogs();
    setInterval(() => {
      if (running) return;
      repairAllModelLogs().catch((error) => {
        console.error(`[model-log-repair] ${error.message}`);
      });
    }, intervalMs);
    console.log(`[model-log-repair] watching every ${intervalMs}ms`);
    return;
  }
  await repairAllModelLogs();
}

async function repairAllModelLogs() {
  running = true;
  try {
    const auditOpsByAccount = buildAuditOperationsByAccount();
    const files = listJsonFiles(path.join(modelLogsDir, "live"));
    let repaired = 0;
    for (const filePath of files) {
      const log = readJsonFile(filePath, null);
      if (!log?.accountId || !log?.runId || !log?.modelId) continue;
      const auditOps = auditOpsByAccount.get(log.accountId) || [];
      const createdAt = Date.parse(log.createdAt || "") || 0;
      const operations = classifyModelOperationSequence(auditOps
        .filter((operation) => (Date.parse(operation.ts || "") || 0) >= createdAt - 60_000)
        .map((operation) => ({
          ...operation,
          accountLabel: log.accountLabel || operation.accountLabel || "",
        })));
      if (!operations.length) continue;
      const nextLog = {
        ...log,
        updatedAt: new Date().toISOString(),
        tradeStats: buildModelTradeStats(operations),
        operations,
      };
      writeModelLogFiles(nextLog, filePath);
      repaired += 1;
    }
    console.log(`[model-log-repair] repaired ${repaired} live model logs at ${new Date().toISOString()}`);
  } finally {
    running = false;
  }
}

function buildAuditOperationsByAccount() {
  const map = new Map();
  if (!fs.existsSync(auditLogPath)) return map;
  const lines = fs.readFileSync(auditLogPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.event !== "automation_portfolio_reconciled") continue;
    const accountId = String(entry.meta?.accountId || "");
    const results = Array.isArray(entry.meta?.results) ? entry.meta.results : [];
    if (!accountId || !results.length) continue;
    const bucket = map.get(accountId) || [];
    for (const item of results) {
      bucket.push(normalizeModelOperation(item, entry.ts, accountId, ""));
    }
    map.set(accountId, bucket);
  }
  return map;
}

function normalizeModelOperation(item = {}, fallbackTs = new Date().toISOString(), accountId = "", accountLabel = "") {
  const adjustment = item.adjustment && typeof item.adjustment === "object" ? item.adjustment : {};
  const position = adjustment.position && typeof adjustment.position === "object" ? adjustment.position : {};
  const instId = item.instId || position.instId || "";
  const instType = item.instType || position.instType || (String(instId || "").endsWith("-SWAP") ? "SWAP" : "SPOT");
  const action = String(item.action || adjustment.action || item.side || "watch").toLowerCase();
  const side = normalizeModelOperationSide(item.side || item.positionSide || item.posSide || position.posSide || item.operation || item.reason);
  const leverage = firstFiniteNumber(item.leverage, item.lever, adjustment.leverage, position.lever);
  const referencePrice = firstFiniteNumber(item.referencePrice, adjustment.referencePrice, position.avgPx, item.avgPx);
  const feeRate = Math.max(firstFiniteNumber(item.feeRate, adjustment.feeRate, position.feeRate, defaultFeeRate(instType, action)) || 0, 0);
  const executionFee = firstFiniteNumber(item.executionFee, adjustment.executionFee);
  const ctVal = firstFiniteNumber(item.ctVal, adjustment.ctVal, position.ctVal, 1) || 1;
  const notionalUsd = firstFiniteNumber(
    item.notionalUsd,
    adjustment.notionalUsd,
    feeRate > 0 && Number.isFinite(executionFee) ? Math.abs(executionFee) / feeRate : NaN,
    Number.isFinite(referencePrice) && Number.isFinite(position.pos) ? Math.abs(Number(position.pos) * referencePrice * ctVal) : NaN
  );
  const marginUsdt = firstFiniteNumber(
    item.marginUsdt,
    item.margin,
    item.requiredCapitalUsdt,
    adjustment.marginUsdt,
    adjustment.requiredCapitalUsdt,
    Number.isFinite(notionalUsd) && Number.isFinite(leverage) && leverage > 0 && instType === "SWAP" ? notionalUsd / leverage : NaN,
    position.capital
  );
  const positionSize = firstFiniteNumber(
    item.positionSize,
    item.contracts,
    item.sz,
    adjustment.positionSize,
    adjustment.contracts,
    adjustment.sz,
    Number.isFinite(notionalUsd) && Number.isFinite(referencePrice) && referencePrice > 0 ? notionalUsd / (referencePrice * ctVal) : NaN,
    position.pos
  );
  const realizedPnl = firstFiniteNumber(item.realizedPnl, adjustment.realizedPnl);
  const realizedReturnPct = firstFiniteNumber(
    item.realizedReturnPct,
    adjustment.realizedReturnPct,
    Number.isFinite(realizedPnl) && Number.isFinite(marginUsdt) && marginUsdt > 0 ? realizedPnl / marginUsdt * 100 : NaN
  );
  return {
    id: item.id || `${Date.parse(fallbackTs) || Date.now()}-${hashShort(JSON.stringify(item)).slice(0, 8)}`,
    ts: item.ts || fallbackTs,
    accountId,
    accountLabel,
    instId,
    instType,
    action,
    rawAction: item.rawAction || action,
    side,
    operation: item.operation || "",
    status: item.status || "",
    reason: item.reason || "",
    leverage: Number.isFinite(leverage) ? Number(leverage) : null,
    marginUsdt: Number.isFinite(marginUsdt) ? roundMoney(Number(marginUsdt)) : null,
    positionSize: Number.isFinite(positionSize) ? Number(positionSize) : null,
    equityBefore: Number.isFinite(Number(item.equityBefore)) ? roundMoney(Number(item.equityBefore)) : null,
    equityAfter: Number.isFinite(Number(item.equityAfter)) ? roundMoney(Number(item.equityAfter)) : null,
    notionalUsd: Number.isFinite(notionalUsd) ? roundMoney(Number(notionalUsd)) : null,
    referencePrice: Number.isFinite(referencePrice) ? Number(referencePrice) : null,
    realizedPnl: Number.isFinite(realizedPnl) ? roundMoney(Number(realizedPnl)) : null,
    realizedReturnPct: Number.isFinite(realizedReturnPct) ? roundMoney(Number(realizedReturnPct)) : null,
    executionFee: Number.isFinite(executionFee) ? roundMoney(Number(executionFee)) : null
  };
}

function classifyModelOperationSequence(operations = []) {
  const active = new Map();
  return operations
    .slice()
    .sort((a, b) => (Date.parse(a.ts || "") || 0) - (Date.parse(b.ts || "") || 0))
    .map((operation) => {
      const next = { ...operation };
      const action = String(next.action || "").toLowerCase();
      const status = String(next.status || "").toLowerCase();
      if (!status.includes("applied")) return next;
      const activeState = active.get(next.instId || "");
      if (!next.side && activeState?.side) next.side = activeState.side;
      if (!next.leverage && activeState?.leverage) next.leverage = activeState.leverage;
      if (next.notionalUsd && next.leverage && !next.marginUsdt && next.instType === "SWAP") {
        next.marginUsdt = roundMoney(Number(next.notionalUsd) / Number(next.leverage));
      }
      if (action === "add" || action === "buy") {
        next.action = activeState ? "add" : "open";
        active.set(next.instId || "", {
          side: next.side || normalizeModelOperationSide(next.reason || next.operation) || "long",
          leverage: next.leverage || activeState?.leverage || null,
        });
      } else if (action === "close" || action === "sell") {
        next.action = "close";
        active.delete(next.instId || "");
      } else if (action === "reduce") {
        next.action = "reduce";
        if (!activeState) {
          active.set(next.instId || "", {
            side: next.side || normalizeModelOperationSide(next.reason || next.operation) || "long",
            leverage: next.leverage || null,
          });
        }
      }
      return next;
    });
}

function buildModelTradeStats(operations = []) {
  const applied = operations.filter((item) => String(item.status || "").includes("applied"));
  const opens = applied.filter((item) => ["open", "buy"].includes(String(item.action || "").toLowerCase()));
  const adds = applied.filter((item) => String(item.action || "").toLowerCase() === "add");
  const reduces = applied.filter((item) => String(item.action || "").toLowerCase() === "reduce");
  const closes = applied.filter((item) => ["close", "sell"].includes(String(item.action || "").toLowerCase()));
  const closedWithPnl = applied.filter((item) => ["reduce", "close", "sell"].includes(String(item.action || "").toLowerCase())
    && Number.isFinite(Number(item.realizedPnl)));
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

function writeModelLogFiles(log, primaryPath) {
  const scope = sanitizePathSegment(log.scope || "live");
  const runId = sanitizePathSegment(log.runId || "default");
  const modelId = sanitizePathSegment(log.modelId || "model");
  const archiveDir = path.join(modelLogsByModelDir, scope, modelId);
  const archiveJsonPath = log.paths?.modelJson || path.join(archiveDir, `${runId}.json`);
  const archiveLogPath = log.paths?.readableLog || path.join(archiveDir, `${runId}.log`);
  const latestJsonPath = log.paths?.latestJson || path.join(archiveDir, "latest.json");
  const latestLogPath = log.paths?.latestReadableLog || path.join(archiveDir, "latest.log");
  const next = {
    ...log,
    paths: {
      json: primaryPath,
      modelJson: archiveJsonPath,
      readableLog: archiveLogPath,
      latestJson: latestJsonPath,
      latestReadableLog: latestLogPath
    }
  };
  writeJsonFileAtomic(primaryPath, next);
  writeJsonFileAtomic(archiveJsonPath, next);
  writeJsonFileAtomic(latestJsonPath, next);
  const readable = buildReadableModelRunLog(next, archiveLogPath);
  writeTextAtomic(archiveLogPath, readable);
  writeTextAtomic(latestLogPath, readable);
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
  lines.push(`减/平仓胜率: ${formatLogPct(stats.winRatePct)} | 已实现盈亏: ${formatLogMoney(stats.realizedPnl)} USDT | 手续费: ${formatLogMoney(stats.totalFees)} USDT`);
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
  if (hasFiniteLogNumber(op.realizedPnl)) details.push(`实现盈亏: ${formatLogMoney(op.realizedPnl)} USDT`);
  if (hasFiniteLogNumber(op.realizedReturnPct)) details.push(`本次收益率: ${formatLogPct(op.realizedReturnPct)}`);
  if (hasFiniteLogNumber(op.equityBefore) || hasFiniteLogNumber(op.equityAfter)) {
    details.push(`权益: ${formatLogMoney(op.equityBefore)} -> ${formatLogMoney(op.equityAfter)} USDT`);
  }
  return [
    header,
    `  ${details.join(" | ")}`,
    `  原因: ${op.reason || op.operation || "--"}`
  ];
}

function hasFiniteLogNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isTradeOperation(item = {}) {
  const action = String(item.action || "").toLowerCase();
  const status = String(item.status || "").toLowerCase();
  if (["open", "add", "reduce", "close", "buy", "sell"].includes(action)) return true;
  return status.includes("applied") && !["watch", "skip", "skipped"].includes(action);
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

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) result.push(...listJsonFiles(fullPath));
    else if (item.isFile() && item.name.endsWith(".json")) result.push(fullPath);
  }
  return result;
}

function readJsonFile(filePath, fallback) {
  for (let index = 0; index < 3; index += 1) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  return fallback;
}

function writeJsonFileAtomic(filePath, value) {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeTextAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, value, "utf8");
  fs.renameSync(tempPath, filePath);
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function normalizeModelOperationSide(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("short") || text.includes("空")) return "short";
  if (text.includes("long") || text.includes("多")) return "long";
  if (text.includes("spot") || text.includes("现货")) return "spot";
  return "";
}

function defaultFeeRate(instType, action) {
  if (["add", "open", "buy", "reduce", "close", "sell"].includes(String(action || "").toLowerCase())) {
    return instType === "SWAP" ? 0.0005 : 0.001;
  }
  return 0;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return NaN;
}

function formatLogTime(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return "--";
  return new Date(ts + 8 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC+8";
}

function formatLogMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toFixed(8);
}

function formatLogPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) >= 100) return number.toFixed(4);
  if (Math.abs(number) >= 1) return number.toFixed(6);
  return number.toFixed(10);
}

function formatLogNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) >= 1000) return number.toFixed(2);
  return number.toFixed(8);
}

function formatLogPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function sum(values) {
  return values.reduce((total, item) => total + Number(item || 0), 0);
}

function hashShort(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

main().catch((error) => {
  console.error(`[model-log-repair] ${error.stack || error.message}`);
  process.exitCode = 1;
});
