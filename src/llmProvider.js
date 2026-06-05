import fs from "node:fs";
import path from "node:path";

const DEFAULT_PROVIDER = normalizeProvider(process.env.LLM_PROVIDER || (process.env.ZHIPU_API_KEY ? "zhipu" : "openrouter"));

const DEFAULT_CONFIG = {
  provider: DEFAULT_PROVIDER,
  model: defaultEnvModel(DEFAULT_PROVIDER),
  baseUrl: defaultEnvBaseUrl(DEFAULT_PROVIDER),
  enabled: false,
  temperature: 0.2,
  maxTokens: 900,
  fallbackModels: process.env.ZHIPU_FALLBACK_MODELS || "",
  thinkingType: process.env.ZHIPU_THINKING_TYPE || "disabled"
};

export function createLlmProvider({ rootDir, appendLog } = {}) {
  const configPath = path.join(rootDir || process.cwd(), "data", "llm-config.json");

  function readConfig() {
    const stored = readJsonFile(configPath, {});
    const provider = normalizeProvider(stored.provider || process.env.LLM_PROVIDER || DEFAULT_CONFIG.provider);
    const envKey = provider === "zhipu" ? process.env.ZHIPU_API_KEY || "" : process.env.OPENROUTER_API_KEY || "";
    const envModel = provider === "zhipu" ? process.env.ZHIPU_MODEL || "" : process.env.OPENROUTER_MODEL || "";
    const envBaseUrl = provider === "zhipu" ? process.env.ZHIPU_BASE_URL || "" : process.env.OPENROUTER_BASE_URL || "";
    return normalizeConfig({
      ...DEFAULT_CONFIG,
      ...stored,
      provider,
      model: envModel || stored.model || defaultModel(provider),
      baseUrl: envBaseUrl || stored.baseUrl || defaultBaseUrl(provider),
      fallbackModels: process.env.ZHIPU_FALLBACK_MODELS || stored.fallbackModels || DEFAULT_CONFIG.fallbackModels,
      thinkingType: process.env.ZHIPU_THINKING_TYPE || stored.thinkingType || DEFAULT_CONFIG.thinkingType,
      apiKey: envKey || stored.apiKey || ""
    });
  }

  function publicConfig() {
    const config = readConfig();
    return {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      enabled: config.enabled,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      fallbackModels: config.fallbackModels,
      thinkingType: config.thinkingType,
      configured: Boolean(config.apiKey),
      keySource: envKeyName(config.provider) && process.env[envKeyName(config.provider)] ? "env" : config.apiKey ? "local" : "missing",
      maskedKey: maskKey(config.apiKey)
    };
  }

  function saveConfig(input = {}) {
    const current = readJsonFile(configPath, {});
    const next = normalizeConfig({
      ...DEFAULT_CONFIG,
      ...current,
      ...input
    });
    if (!String(input.apiKey || "").trim()) {
      next.apiKey = current.apiKey || "";
    }
    if (input.clearApiKey) {
      next.apiKey = "";
    }
    if (envKeyName(next.provider) && process.env[envKeyName(next.provider)] && input.apiKey) {
      appendLog?.({
        level: "warn",
        event: "llm_config_env_key_override",
        message: `${envKeyName(next.provider)} is set in the environment; the saved key will not be used until the env var is removed.`
      });
    }
    writeJsonFile(configPath, {
      provider: next.provider,
      model: next.model,
      baseUrl: next.baseUrl,
      enabled: next.enabled,
      temperature: next.temperature,
      maxTokens: next.maxTokens,
      fallbackModels: next.fallbackModels,
      thinkingType: next.thinkingType,
      apiKey: next.apiKey,
      updatedAt: new Date().toISOString()
    });
    return publicConfig();
  }

  async function chat(messages, options = {}) {
    const config = readConfig();
    if (!config.apiKey) {
      throw new Error(`${providerLabel(config.provider)} API key is not configured.`);
    }
    if (!["openrouter", "zhipu"].includes(config.provider)) {
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 45_000));
    const models = uniqueModels([options.model || config.model, ...splitModels(config.fallbackModels)]);
    let lastError = null;
    try {
      for (const model of models) {
        try {
          const payload = await postChatCompletion({
            config,
            model,
            messages,
            options,
            signal: controller.signal
          });
          return {
            content: payload?.choices?.[0]?.message?.content || "",
            model: payload?.model || model,
            usage: payload?.usage || null,
            latencyMs: Date.now() - startedAt
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("LLM request failed.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function testConnection() {
    const result = await chat([
      { role: "system", content: "Return compact JSON only." },
      { role: "user", content: `Respond with {"ok":true,"label":"${providerLabel(readConfig().provider)}"}.` }
    ], {
      maxTokens: 80,
      responseFormat: { type: "json_object" },
      timeoutMs: 25_000
    });
    return {
      ok: true,
      model: result.model,
      usage: result.usage,
      latencyMs: result.latencyMs,
      content: result.content
    };
  }

  return {
    readConfig,
    publicConfig,
    saveConfig,
    chat,
    testConnection
  };
}

function normalizeConfig(config) {
  const provider = normalizeProvider(config.provider);
  return {
    provider,
    model: String(config.model || defaultModel(provider)).trim() || defaultModel(provider),
    baseUrl: String(config.baseUrl || defaultBaseUrl(provider)).trim() || defaultBaseUrl(provider),
    enabled: Boolean(config.enabled),
    temperature: clamp(Number(config.temperature ?? DEFAULT_CONFIG.temperature), 0, 2),
    maxTokens: Math.round(clamp(Number(config.maxTokens || DEFAULT_CONFIG.maxTokens), 100, 4000)),
    fallbackModels: splitModels(config.fallbackModels).join(","),
    thinkingType: ["enabled", "disabled"].includes(String(config.thinkingType || "").toLowerCase())
      ? String(config.thinkingType).toLowerCase()
      : "disabled",
    apiKey: String(config.apiKey || "").trim()
  };
}

async function postChatCompletion({ config, model, messages, options, signal }) {
  const headers = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json"
  };
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-OpenRouter-Title"] = "OKX AI Trade Lab";
  }
  const body = {
    model,
    messages,
    temperature: Number(options.temperature ?? config.temperature),
    max_tokens: Number(options.maxTokens || config.maxTokens),
    response_format: options.responseFormat || undefined
  };
  if (config.provider === "zhipu" && config.thinkingType) {
    body.thinking = { type: config.thinkingType };
  }
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const label = config.provider === "zhipu" ? "Zhipu" : "OpenRouter";
    const message = payload?.error?.message || payload?.message || `${label} HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function normalizeProvider(value) {
  const provider = String(value || "").toLowerCase();
  return provider === "zhipu" || provider === "glm" ? "zhipu" : "openrouter";
}

function defaultBaseUrl(provider) {
  return provider === "zhipu" ? "https://open.bigmodel.cn/api/paas/v4" : "https://openrouter.ai/api/v1";
}

function defaultModel(provider) {
  return provider === "zhipu" ? "glm-4.7-flash" : "openrouter/free";
}

function defaultEnvModel(provider) {
  return provider === "zhipu"
    ? process.env.ZHIPU_MODEL || defaultModel(provider)
    : process.env.OPENROUTER_MODEL || defaultModel(provider);
}

function defaultEnvBaseUrl(provider) {
  return provider === "zhipu"
    ? process.env.ZHIPU_BASE_URL || defaultBaseUrl(provider)
    : process.env.OPENROUTER_BASE_URL || defaultBaseUrl(provider);
}

function providerLabel(provider) {
  return provider === "zhipu" ? "Zhipu" : "OpenRouter";
}

function envKeyName(provider) {
  return provider === "zhipu" ? "ZHIPU_API_KEY" : "OPENROUTER_API_KEY";
}

function splitModels(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function uniqueModels(models) {
  return [...new Set(models.map((model) => String(model || "").trim()).filter(Boolean))];
}

function maskKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
