export async function buildDecisionComparison({
  selectedInstId,
  settings = {},
  account,
  plan,
  marketData,
  marketFlow = null,
  llmProvider
}) {
  const instId = normalizeInstId(selectedInstId || plan?.best?.symbol || "BTC-USDT");
  const planAsset = findPlanAsset(plan, instId);
  const market = marketData?.[instId] || {};
  const mode = normalizeDecisionMode(settings.decisionEngine);
  const skills = buildSkillsDecision({ instId, settings, account, plan, planAsset, market, marketFlow });
  const tradingAgents = mode === "skills" && settings.forceTradingAgents !== true
    ? unavailableTradingAgents("当前请求为 Skills-only，未运行 TradingAgents LLM 复核。", llmProvider?.publicConfig?.() || {})
    : await buildTradingAgentsDecision({
      instId,
      settings,
      account,
      plan,
      planAsset,
      market,
      marketFlow,
      llmProvider
    });
  const hybrid = buildHybridDecision({
    instId,
    settings,
    skills,
    tradingAgents,
    weight: Number(settings.tradingAgentsWeight ?? 50)
  });

  const selected = mode === "tradingagents" ? tradingAgents : mode === "hybrid" ? hybrid : skills;
  return {
    generatedAt: new Date().toISOString(),
    instId,
    mode,
    selected,
    weight: hybrid.weight,
    engines: {
      skills,
      tradingAgents,
      hybrid
    },
    notes: buildComparisonNotes({ skills, tradingAgents, hybrid })
  };
}

function buildSkillsDecision({ instId, settings, account, plan, planAsset, market, marketFlow }) {
  const last = latestPrice(market, planAsset);
  const score = Math.round(clamp(Number(planAsset?.score || 0) * 100, 0, 100));
  const targetPct = Number(planAsset?.targetPct || 0);
  const confidence = clamp(Number(plan?.confidence || score), 0, 100);
  const product = instId.endsWith("-SWAP") ? "swap" : "spot";
  const flowBias = marketFlow?.aiBias || marketFlow?.direction || "neutral";
  const action = targetPct > 0 ? "buy" : score >= 55 ? "watch" : "hold";
  const side = product === "swap" && flowBias !== "neutral" ? flowBias : targetPct > 0 ? "long" : "neutral";
  const allocationUsdt = Number(planAsset?.valueUsdt || 0);

  return {
    engine: "skills",
    label: "仅使用 Skills",
    available: true,
    action,
    side,
    product,
    score,
    confidence,
    targetPct,
    allocationUsdt,
    takeProfit: last > 0 ? roundPrice(last * (1 + clamp(Number(settings.targetReturn || 12), 1, 1000) / 100)) : 0,
    stopLoss: last > 0 ? roundPrice(last * (1 - clamp(Number(settings.maxDrawdown || 8), 0.1, 95) / 100)) : 0,
    veto: false,
    summary: planAsset?.reason || plan?.best?.reason || "本地 Skills 已根据行情、指标、资金与组合约束生成确定性评分。",
    reasons: [
      `计划置信度 ${Math.round(confidence)}%。`,
      `目标配置 ${round(targetPct, 2)}%，现金保留 ${round(Number(plan?.cashReserve || 0) * 100, 1)}%。`,
      marketFlow ? `资金异动判断：${marketFlow.aiJudgment || marketFlow.label}（${marketFlow.aiConfidence || marketFlow.confidence}%）。` : "未检测到需要附加说明的资金异动信号。"
    ],
    riskNotes: [
      `预算基准：使用 ${round(Number(plan?.budgetUsdt || settings.budgetUsdt || 0), 2)} USDT 可用资金生成计划。`,
      product === "swap" ? "合约执行仍需通过 OKX 杠杆、手续费、资金费率和强平价检查。" : "现货没有强平风险，但仍需计入手续费、滑点和成交深度。"
    ],
    raw: {
      planConfidence: plan?.confidence,
      planCashReserve: plan?.cashReserve,
      planAsset
    }
  };
}

async function buildTradingAgentsDecision({ instId, settings, account, plan, planAsset, market, marketFlow, llmProvider }) {
  const publicConfig = llmProvider?.publicConfig?.() || { configured: false, enabled: false };
  if (!publicConfig.configured) {
    return unavailableTradingAgents(`${providerLabel(publicConfig.provider)} API key 尚未配置，请先保存密钥再运行 TradingAgents 复核。`, publicConfig);
  }
  if (publicConfig.enabled === false && settings.forceTradingAgents !== true) {
    return unavailableTradingAgents("LLM 复核配置已保存但未启用；如需依赖 TradingAgents，请先在实验室设置中开启。", publicConfig);
  }

  const prompt = buildTradingAgentsPrompt({ instId, settings, account, plan, planAsset, market, marketFlow });
  try {
    const response = await llmProvider.chat([
      {
        role: "system",
        content: [
          "You are a TradingAgents-style crypto review committee.",
          "Act as Market Analyst, News/Sentiment Analyst, Bull Researcher, Bear Researcher, Trader, Risk Manager, and Portfolio Manager.",
          "Return strict JSON only. Do not include markdown.",
          "All human-readable fields must be Simplified Chinese."
        ].join(" ")
      },
      { role: "user", content: prompt }
    ], {
      responseFormat: { type: "json_object" },
      maxTokens: Number(publicConfig.maxTokens || 900),
      timeoutMs: 45_000
    });
    const parsed = parseJsonObject(response.content);
    const decision = normalizeTradingAgentsJson(parsed, instId);
    return {
      ...decision,
      engine: "tradingagents",
      label: "仅使用 TradingAgents",
      available: true,
      model: response.model,
      usage: response.usage,
      latencyMs: response.latencyMs,
      provider: publicConfig.provider,
      raw: parsed
    };
  } catch (error) {
    return unavailableTradingAgents(`TradingAgents LLM 复核失败：${error.message || "未知错误"}`, publicConfig);
  }
}

function buildHybridDecision({ instId, skills, tradingAgents, weight }) {
  const boundedWeight = clamp(Number(weight), 0, 100);
  const taWeight = tradingAgents.available ? boundedWeight / 100 : 0;
  const skillsWeight = 1 - taWeight;
  const score = Math.round(skills.score * skillsWeight + Number(tradingAgents.score || 0) * taWeight);
  const confidence = Math.round(skills.confidence * skillsWeight + Number(tradingAgents.confidence || 0) * taWeight);
  const conflict = tradingAgents.available && meaningfulConflict(skills, tradingAgents);
  const veto = Boolean(tradingAgents.veto);
  const action = veto || conflict && confidence < 72
    ? "watch"
    : taWeight >= 0.5 && tradingAgents.available
      ? tradingAgents.action
      : skills.action;
  const side = veto || conflict && confidence < 72
    ? "neutral"
    : taWeight >= 0.5 && tradingAgents.available
      ? tradingAgents.side
      : skills.side;

  return {
    engine: "hybrid",
    label: "混合权重",
    available: true,
    action,
    side,
    product: chooseProduct(skills, tradingAgents, taWeight),
    score,
    confidence,
    targetPct: round(skills.targetPct * skillsWeight + Number(tradingAgents.targetPct || skills.targetPct) * taWeight, 2),
    allocationUsdt: round(skills.allocationUsdt * skillsWeight + Number(tradingAgents.allocationUsdt || skills.allocationUsdt) * taWeight, 2),
    takeProfit: tradingAgents.available && tradingAgents.takeProfit ? tradingAgents.takeProfit : skills.takeProfit,
    stopLoss: tradingAgents.available && tradingAgents.stopLoss ? tradingAgents.stopLoss : skills.stopLoss,
    veto,
    conflict,
    weight: { skills: Math.round(skillsWeight * 100), tradingAgents: Math.round(taWeight * 100) },
    summary: veto
      ? "TradingAgents 风控复核否决执行，混合模式切换为观察。"
      : conflict
        ? "Skills 与 TradingAgents 存在分歧，混合模式会降低激进程度，等待更高置信度。"
        : "Skills 与 TradingAgents 方向基本一致，保留当前加权决策。",
    reasons: [
      `Skills 评分 ${skills.score}，TradingAgents 评分 ${tradingAgents.available ? tradingAgents.score : "不可用"}。`,
      `权重分配：Skills ${Math.round(skillsWeight * 100)}%，TradingAgents ${Math.round(taWeight * 100)}%。`,
      conflict ? "检测到方向或操作分歧。" : "未检测到明显操作分歧。"
    ],
    riskNotes: [
      ...skills.riskNotes.slice(0, 1),
      ...(tradingAgents.riskNotes || []).slice(0, 2)
    ],
    raw: { instId }
  };
}

function buildTradingAgentsPrompt({ instId, settings, account, plan, planAsset, market, marketFlow }) {
  const candles = Array.isArray(market?.candles) ? market.candles.slice(-35) : [];
  const compactCandles = candles.map((candle) => ({
    ts: candle.ts,
    o: Number(candle.open),
    h: Number(candle.high),
    l: Number(candle.low),
    c: Number(candle.close),
    vq: Number(candle.volQuote || candle.volCcy || candle.vol || 0)
  }));
  const context = {
    instrument: instId,
    productPreference: settings.productPreference || "both",
    objective: settings.objective || "balanced",
    riskLevel: Number(settings.riskLevel || 5),
    targetReturnPct: Number(settings.targetReturn || 12),
    maxDrawdownPct: Number(settings.maxDrawdown || 8),
    maxLeverage: Number(settings.maxLeverage || 5),
    account: account ? {
      source: account.accountSource,
      label: account.accountLabel,
      totalEqUsd: account.totalEqUsd,
      availableUsdt: account.availableUsdt,
      usedMargin: account.usedMargin,
      marginUsagePct: account.marginUsagePct,
      positions: (account.positions || []).map((position) => ({
        instId: position.instId,
        instType: position.instType,
        posSide: position.posSide,
        uplRatioPct: position.uplRatioPct,
        margin: position.margin,
        notionalUsd: position.notionalUsd
      }))
    } : null,
    skillsPlan: {
      confidence: plan?.confidence,
      cashReserve: plan?.cashReserve,
      selectedAsset: planAsset,
      topAssets: (plan?.assets || []).slice(0, 8)
    },
    market: {
      ticker: market?.ticker || null,
      recentCandles: compactCandles
    },
    marketFlow
  };

  return [
    "请用 TradingAgents 风格的多智能体委员会复核这个 OKX 加密资产决策。",
    "所有 summary、reasons、riskNotes、committee 字段必须使用简体中文。",
    "返回 JSON，字段必须严格如下：",
    "{",
    "\"action\":\"buy|sell|hold|watch\",",
    "\"side\":\"long|short|neutral\",",
    "\"product\":\"spot|swap|both\",",
    "\"score\":0-100,",
    "\"confidence\":0-100,",
    "\"targetPct\":number,",
    "\"allocationUsdt\":number,",
    "\"takeProfit\":number,",
    "\"stopLoss\":number,",
    "\"veto\":boolean,",
    "\"summary\":\"short Chinese summary\",",
    "\"reasons\":[\"3-5 concrete Chinese reasons\"],",
    "\"riskNotes\":[\"2-4 Chinese risk notes\"],",
    "\"committee\":{\"market\":\"...\",\"bull\":\"...\",\"bear\":\"...\",\"risk\":\"...\",\"portfolio\":\"...\"}",
    "}",
    "不要编造 OKX 不存在的杠杆档位。若数据不足，请选择 watch 或 hold。",
    JSON.stringify(context)
  ].join("\n");
}

function normalizeTradingAgentsJson(parsed, instId) {
  const action = normalizeAction(parsed.action);
  const side = normalizeSide(parsed.side);
  const score = Math.round(clamp(Number(parsed.score ?? parsed.confidence ?? 0), 0, 100));
  const confidence = Math.round(clamp(Number(parsed.confidence ?? score), 0, 100));
  return {
    action,
    side,
    product: normalizeProduct(parsed.product, instId),
    score,
    confidence,
    targetPct: round(clamp(Number(parsed.targetPct || 0), 0, 100), 2),
    allocationUsdt: round(Math.max(Number(parsed.allocationUsdt || 0), 0), 2),
    takeProfit: roundPrice(Number(parsed.takeProfit || 0)),
    stopLoss: roundPrice(Number(parsed.stopLoss || 0)),
    veto: Boolean(parsed.veto),
    summary: translateKnownDecisionText(String(parsed.summary || "TradingAgents 复核已完成。")),
    reasons: normalizeStringArray(parsed.reasons).map(translateKnownDecisionText).slice(0, 6),
    riskNotes: normalizeStringArray(parsed.riskNotes).map(translateKnownDecisionText).slice(0, 6),
    committee: parsed.committee && typeof parsed.committee === "object" ? parsed.committee : {}
  };
}

function unavailableTradingAgents(message, config) {
  return {
    engine: "tradingagents",
    label: "仅使用 TradingAgents",
    available: false,
    action: "watch",
    side: "neutral",
    product: "both",
    score: 0,
    confidence: 0,
    targetPct: 0,
    allocationUsdt: 0,
    takeProfit: 0,
    stopLoss: 0,
    veto: true,
    summary: message,
    reasons: [message],
    riskNotes: ["TradingAgents 复核当前不可用，自动化不应单独依赖该结果。"],
    provider: config.provider,
    model: config.model,
    raw: { configured: config.configured, enabled: config.enabled }
  };
}

function buildComparisonNotes({ skills, tradingAgents, hybrid }) {
  const notes = [];
  if (!tradingAgents.available) notes.push("TradingAgents 当前不可用，混合模式已回退到 Skills。");
  if (hybrid.conflict) notes.push("Skills 与 TradingAgents 存在分歧，建议观察或降低仓位，等待分歧收敛。");
  if (hybrid.veto) notes.push("TradingAgents 风控已否决该信号，请勿自动开仓。");
  if (!notes.length) notes.push("对比已完成，请按当前账户 AI 设置采用选中的决策引擎。");
  return notes;
}

function findPlanAsset(plan, instId) {
  const base = instId.replace(/-SWAP$/, "");
  return (plan?.assets || []).find((asset) => asset.symbol === instId || asset.symbol === base)
    || null;
}

function latestPrice(market, planAsset) {
  return Number(market?.ticker?.last || planAsset?.last || market?.candles?.at?.(-1)?.close || 0);
}

function parseJsonObject(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LLM did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function meaningfulConflict(a, b) {
  if (!b.available) return false;
  const actionConflict = new Set([a.action, b.action]).has("buy") && new Set([a.action, b.action]).has("sell");
  const sideConflict = a.side !== "neutral" && b.side !== "neutral" && a.side !== b.side;
  return actionConflict || sideConflict || Boolean(b.veto);
}

function chooseProduct(skills, tradingAgents, taWeight) {
  if (tradingAgents.available && taWeight >= 0.5) return tradingAgents.product;
  return skills.product;
}

function normalizeDecisionMode(value) {
  return ["skills", "tradingagents", "hybrid"].includes(String(value)) ? String(value) : "hybrid";
}

function providerLabel(provider) {
  return provider === "zhipu" ? "Zhipu" : "OpenRouter";
}

function normalizeAction(value) {
  const action = String(value || "").toLowerCase();
  return ["buy", "sell", "hold", "watch"].includes(action) ? action : "watch";
}

function normalizeSide(value) {
  const side = String(value || "").toLowerCase();
  return ["long", "short", "neutral"].includes(side) ? side : "neutral";
}

function normalizeProduct(value, instId) {
  const product = String(value || "").toLowerCase();
  if (["spot", "swap", "both"].includes(product)) return product;
  return String(instId).endsWith("-SWAP") ? "swap" : "spot";
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function translateKnownDecisionText(text) {
  return String(text || "")
    .replace(/TradingAgents review completed\./gi, "TradingAgents 复核已完成。")
    .replace(/Local skills produced a deterministic market and portfolio score\./gi, "本地 Skills 已根据行情、指标、资金与组合约束生成确定性评分。")
    .replace(/Plan confidence ([\d.]+)%\./gi, "计划置信度 $1%。")
    .replace(/Target allocation ([\d.]+)% and cash reserve ([\d.]+)%\./gi, "目标配置 $1%，现金保留 $2%。")
    .replace(/Market-flow read: (.+?) \(([\d.]+)%\)\./gi, "资金异动判断：$1（$2%）。")
    .replace(/No market-flow exception was attached\./gi, "未检测到需要附加说明的资金异动信号。")
    .replace(/Budget basis: ([\d.]+) USDT available-budget plan\./gi, "预算基准：使用 $1 USDT 可用资金生成计划。")
    .replace(/Spot execution has no liquidation risk but still needs fee\/slippage checks\./gi, "现货没有强平风险，但仍需计入手续费、滑点和成交深度。")
    .replace(/Contract execution still requires OKX leverage, fee, funding, and liquidation checks\./gi, "合约执行仍需通过 OKX 杠杆、手续费、资金费率和强平价检查。")
    .replace(/Comparison completed; use the selected engine according to account AI settings\./gi, "对比已完成，请按当前账户 AI 设置采用选中的决策引擎。")
    .replace(/Skills and TradingAgents disagree; use watch\/reduced sizing until resolved\./gi, "Skills 与 TradingAgents 存在分歧，建议观察或降低仓位，等待分歧收敛。")
    .replace(/TradingAgents veto is active; do not auto-open this signal\./gi, "TradingAgents 风控已否决该信号，请勿自动开仓。");
}

function normalizeInstId(value) {
  const instId = String(value || "").trim().toUpperCase();
  return instId || "BTC-USDT";
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function roundPrice(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number >= 100) return round(number, 2);
  if (number >= 1) return round(number, 4);
  return round(number, 8);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
