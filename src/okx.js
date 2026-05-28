import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://www.okx.com";
const DEFAULT_REQUEST_INTERVAL_MS = 220;
const MAX_RETRIES = 2;
const MAX_CACHE_ENTRIES = 600;
const SITE_BASE_URLS = {
  global: "https://www.okx.com",
  eea: "https://my.okx.com",
  us: "https://app.okx.com"
};

export class OkxError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = "OkxError";
    this.detail = detail;
  }
}

export function createOkxClient(config = {}) {
  const officialConfig = loadOfficialOkxConfig(config.configPath || process.env.OKX_CONFIG_PATH);
  const profileName = config.profile || process.env.OKX_PROFILE || officialConfig.defaultProfile || "";
  const profile = officialConfig.profiles[profileName] || {};
  const source = profileName && officialConfig.profiles[profileName] ? "official-config" : "env";
  const configuredSite = config.site || process.env.OKX_SITE || profile.site || "";
  const siteBaseUrl = SITE_BASE_URLS[String(configuredSite).toLowerCase()] || DEFAULT_BASE_URL;
  const baseUrl = normalizeBaseUrl(config.baseUrl || process.env.OKX_API_BASE || process.env.OKX_API_BASE_URL || siteBaseUrl);
  const apiKey = config.apiKey || process.env.OKX_API_KEY || profile.api_key || "";
  const apiSecret = config.apiSecret || process.env.OKX_API_SECRET || process.env.OKX_SECRET_KEY || profile.secret_key || "";
  const rawPassphrase = config.passphrase || process.env.OKX_API_PASSPHRASE || process.env.OKX_PASSPHRASE || profile.passphrase || "";
  const passphrase = isPlaceholder(rawPassphrase) ? "" : rawPassphrase;
  const minRequestIntervalMs = Math.max(Number(config.minRequestIntervalMs || process.env.OKX_REQUEST_INTERVAL_MS || DEFAULT_REQUEST_INTERVAL_MS), 80);
  const requestCache = new Map();
  const pendingRequests = new Map();
  let requestQueue = Promise.resolve();
  let lastRequestAt = 0;
  let rateLimitedUntil = 0;
  let consecutiveRateLimits = 0;

  function credentialsStatus() {
    return {
      baseUrl,
      source,
      profile: profileName || null,
      publicMarketSource: "live",
      hasApiKey: Boolean(apiKey),
      hasSecret: Boolean(apiSecret),
      hasPassphrase: Boolean(passphrase),
      passphrasePlaceholder: Boolean(rawPassphrase && !passphrase),
      privateReady: Boolean(apiKey && apiSecret && passphrase),
      throttle: {
        minRequestIntervalMs,
        rateLimitedUntil: rateLimitedUntil ? new Date(rateLimitedUntil).toISOString() : null,
        cacheEntries: requestCache.size,
        pending: pendingRequests.size
      }
    };
  }

  async function request(method, requestPath, body = undefined, options = {}) {
    const auth = Boolean(options.auth);
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const cacheKey = `${method}:${auth ? "auth" : "public"}:${requestPath}:${bodyText}`;
    const cacheMs = Number.isFinite(Number(options.cacheMs))
      ? Math.max(Number(options.cacheMs), 0)
      : defaultCacheMs(method, requestPath, auth);
    const cached = cacheMs > 0 ? requestCache.get(cacheKey) : null;
    if (cached && Date.now() - cached.at <= cacheMs) return cached.value;
    if (pendingRequests.has(cacheKey)) return pendingRequests.get(cacheKey);

    const pending = performRequest(method, requestPath, bodyText, auth)
      .then((json) => {
        if (cacheMs > 0) rememberCache(requestCache, cacheKey, json);
        return json;
      })
      .finally(() => pendingRequests.delete(cacheKey));
    pendingRequests.set(cacheKey, pending);
    return pending;
  }

  async function performRequest(method, requestPath, bodyText, auth) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      if (!apiKey || !apiSecret || !passphrase) {
        throw new OkxError("Private OKX request requires API key, secret key, and passphrase.", credentialsStatus());
      }

      const timestamp = new Date().toISOString();
      headers["OK-ACCESS-KEY"] = apiKey;
      headers["OK-ACCESS-SIGN"] = signRequest(apiSecret, timestamp, method, requestPath, bodyText);
      headers["OK-ACCESS-TIMESTAMP"] = timestamp;
      headers["OK-ACCESS-PASSPHRASE"] = passphrase;
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await waitForRequestSlot();
      let response;
      try {
        response = await fetch(`${baseUrl}${requestPath}`, {
          method,
          headers,
          body: method === "GET" ? undefined : bodyText
        });
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoffDelay(attempt, false));
          continue;
        }
        throw error;
      }

      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new OkxError(`OKX returned non-JSON response (${response.status}).`, {
          status: response.status,
          text: text.slice(0, 500)
        });
      }

      if (response.status === 429) {
        consecutiveRateLimits += 1;
        const retryAfterMs = retryAfterToMs(response.headers.get("retry-after"));
        const waitMs = retryAfterMs || backoffDelay(attempt, true);
        rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + waitMs);
        if (attempt < MAX_RETRIES) {
          await sleep(waitMs);
          continue;
        }
        throw new OkxError("OKX HTTP error 429. 本地请求已触发交易所限流，系统会自动退避后重试。", {
          status: response.status,
          retryAfterMs: waitMs,
          body: json
        });
      }

      if (!response.ok) {
        throw new OkxError(`OKX HTTP error ${response.status}.`, {
          status: response.status,
          body: json
        });
      }

      if (json.code && json.code !== "0") {
        throw new OkxError(formatOkxError(json), json);
      }

      consecutiveRateLimits = 0;
      return json;
    }

    throw new OkxError("OKX request failed after retries.", { requestPath });
  }

  async function waitForRequestSlot() {
    const previous = requestQueue.catch(() => {});
    let release;
    requestQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const now = Date.now();
      const waitMs = Math.max(
        0,
        rateLimitedUntil - now,
        lastRequestAt + minRequestIntervalMs - now
      );
      if (waitMs > 0) await sleep(waitMs);
      lastRequestAt = Date.now();
    } finally {
      release();
    }
  }

  function backoffDelay(attempt, rateLimited) {
    const base = rateLimited ? 2_500 : 700;
    const ratePenalty = rateLimited ? Math.min(consecutiveRateLimits * 1_000, 12_000) : 0;
    return Math.min(base * (2 ** attempt) + ratePenalty + Math.floor(Math.random() * 350), 30_000);
  }

  async function getTicker(instId) {
    const query = new URLSearchParams({ instId }).toString();
    const json = await request("GET", `/api/v5/market/ticker?${query}`);
    return json.data?.[0] || null;
  }

  async function getCandles(instId, bar = "1D", limit = 90) {
    const query = new URLSearchParams({
      instId,
      bar,
      limit: String(limit)
    }).toString();
    const json = await request("GET", `/api/v5/market/history-candles?${query}`);
    return (json.data || []).map(parseCandle).filter(Boolean).reverse();
  }

  async function getTickers(instType = "SPOT") {
    const query = new URLSearchParams({ instType }).toString();
    const json = await request("GET", `/api/v5/market/tickers?${query}`);
    return json.data || [];
  }

  async function getInstruments(instType = "SPOT", instId = "") {
    const params = { instType };
    if (instId) params.instId = instId;
    const query = new URLSearchParams(params).toString();
    const json = await request("GET", `/api/v5/public/instruments?${query}`);
    return json.data || [];
  }

  async function getFundingRate(instId) {
    const query = new URLSearchParams({ instId }).toString();
    const json = await request("GET", `/api/v5/public/funding-rate?${query}`);
    return json.data?.[0] || null;
  }

  async function getOpenInterest(instId, instType = "SWAP") {
    const query = new URLSearchParams({ instType, instId }).toString();
    const json = await request("GET", `/api/v5/public/open-interest?${query}`);
    return json.data?.[0] || null;
  }

  async function getMarkPrice(instId, instType = "SWAP") {
    const query = new URLSearchParams({ instType, instId }).toString();
    const json = await request("GET", `/api/v5/public/mark-price?${query}`);
    return json.data?.[0] || null;
  }

  async function getOrderBook(instId, depth = 20) {
    const query = new URLSearchParams({ instId, sz: String(Math.min(Math.max(Number(depth) || 20, 1), 400)) }).toString();
    const json = await request("GET", `/api/v5/market/books?${query}`);
    return json.data?.[0] || null;
  }

  async function getTrades(instId, limit = 100) {
    const query = new URLSearchParams({ instId, limit: String(Math.min(Math.max(Number(limit) || 100, 1), 500)) }).toString();
    const json = await request("GET", `/api/v5/market/trades?${query}`);
    return json.data || [];
  }

  async function getTradeFee(instType = "SPOT", instId = "") {
    const params = { instType };
    if (instType === "SPOT" || instType === "MARGIN") {
      if (instId) params.instId = instId;
    } else if (instId) {
      params.instFamily = instId.replace(/-SWAP$|-\d{6}$/, "");
    }
    const query = new URLSearchParams(params).toString();
    const json = await request("GET", `/api/v5/account/trade-fee?${query}`, undefined, { auth: true });
    return json.data?.[0] || null;
  }

  async function getBalance(ccy = "") {
    const query = ccy ? `?${new URLSearchParams({ ccy }).toString()}` : "";
    const json = await request("GET", `/api/v5/account/balance${query}`, undefined, { auth: true });
    return json.data || [];
  }

  async function getPositions(instType = "") {
    const query = instType ? `?${new URLSearchParams({ instType }).toString()}` : "";
    const json = await request("GET", `/api/v5/account/positions${query}`, undefined, { auth: true });
    return json.data || [];
  }

  return {
    credentialsStatus,
    getTicker,
    getTickers,
    getCandles,
    getInstruments,
    getFundingRate,
    getOpenInterest,
    getMarkPrice,
    getOrderBook,
    getTrades,
    getTradeFee,
    getBalance,
    getPositions
  };
}

function defaultCacheMs(method, requestPath, auth) {
  if (method !== "GET") return 0;
  if (/\/api\/v5\/public\/instruments/.test(requestPath)) return 10 * 60_000;
  if (/\/api\/v5\/account\/trade-fee/.test(requestPath)) return 10 * 60_000;
  if (/\/api\/v5\/market\/tickers/.test(requestPath)) return 5_000;
  if (/\/api\/v5\/market\/ticker/.test(requestPath)) return 2_500;
  if (/\/api\/v5\/market\/history-candles/.test(requestPath)) {
    const bar = new URLSearchParams(requestPath.split("?")[1] || "").get("bar") || "";
    if (/^(1m|3m|5m)$/.test(bar)) return 8_000;
    if (/^(15m|30m)$/.test(bar)) return 15_000;
    if (/^(1H|2H|4H)$/.test(bar)) return 30_000;
    return 60_000;
  }
  if (/\/api\/v5\/public\/funding-rate/.test(requestPath)) return 60_000;
  if (/\/api\/v5\/public\/open-interest/.test(requestPath)) return 20_000;
  if (/\/api\/v5\/public\/mark-price/.test(requestPath)) return 3_000;
  if (/\/api\/v5\/market\/books/.test(requestPath)) return 2_000;
  if (/\/api\/v5\/market\/trades/.test(requestPath)) return 2_000;
  if (/\/api\/v5\/account\/balance/.test(requestPath)) return 8_000;
  if (/\/api\/v5\/account\/positions/.test(requestPath)) return 8_000;
  return auth ? 3_000 : 2_000;
}

function rememberCache(cache, key, value) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const dropCount = Math.ceil(MAX_CACHE_ENTRIES * 0.2);
  for (const oldKey of cache.keys()) {
    cache.delete(oldKey);
    if (cache.size <= MAX_CACHE_ENTRIES - dropCount) break;
  }
}

function retryAfterToMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(date - Date.now(), 0), 60_000) : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOkxError(json) {
  const failed = Array.isArray(json.data) ? json.data.find((item) => item?.sCode && item.sCode !== "0") : null;
  if (failed?.sMsg) return `OKX ${failed.sCode}: ${failed.sMsg}`;
  return json.msg || "OKX API error.";
}

export function signRequest(secret, timestamp, method, requestPath, bodyText = "") {
  const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${bodyText}`;
  return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
}

export function parseCandle(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm] = row;
  const candle = {
    ts: Number(ts),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    vol: Number(vol),
    volCcy: Number(volCcy || 0),
    volQuote: Number(volCcyQuote || 0),
    confirm: String(confirm || "")
  };
  return Number.isFinite(candle.close) && candle.close > 0 ? candle : null;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl).replace(/\/+$/, "");
}

function loadOfficialOkxConfig(configPath) {
  const resolvedPath = configPath || path.join(os.homedir(), ".okx", "config.toml");
  if (!fs.existsSync(resolvedPath)) {
    return { defaultProfile: "", profiles: {} };
  }

  try {
    return parseOkxConfig(fs.readFileSync(resolvedPath, "utf8"));
  } catch {
    return { defaultProfile: "", profiles: {} };
  }
}

function parseOkxConfig(content) {
  const result = { defaultProfile: "", profiles: {} };
  let currentProfile = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;

    const section = line.match(/^\[profiles\.([^\]]+)\]$/);
    if (section) {
      currentProfile = section[1].trim().replace(/^["']|["']$/g, "");
      result.profiles[currentProfile] ||= {};
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = parseTomlValue(match[2]);
    if (!currentProfile && key === "default_profile") {
      result.defaultProfile = String(value || "");
    } else if (currentProfile) {
      result.profiles[currentProfile][key] = value;
    }
  }

  return result;
}

function stripTomlComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === "\"" || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? "" : quote || char;
    }
    if (char === "#" && !quote) return line.slice(0, i);
  }
  return line;
}

function parseTomlValue(value) {
  const trimmed = value.trim();
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPlaceholder(value) {
  return /missing|replace|your-|placeholder/i.test(String(value || ""));
}
