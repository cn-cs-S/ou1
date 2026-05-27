import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://www.okx.com";
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
      privateReady: Boolean(apiKey && apiSecret && passphrase)
    };
  }

  async function request(method, requestPath, body = undefined, options = {}) {
    const auth = Boolean(options.auth);
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const headers = {
      "Content-Type": "application/json"
    };

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

    const response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers,
      body: method === "GET" ? undefined : bodyText
    });

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new OkxError(`OKX returned non-JSON response (${response.status}).`, {
        status: response.status,
        text: text.slice(0, 500)
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

    return json;
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
