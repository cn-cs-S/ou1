const WATCH_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "OKB-USDT", "DOGE-USDT", "XRP-USDT"];

const state = {
  symbol: "BTC-USDT",
  bar: "30m",
  chart: null,
  chartMeta: null,
  hoverIndex: null,
  plan: null,
  objective: "balanced",
  selectedSymbols: ["BTC-USDT", "ETH-USDT", "SOL-USDT", "OKB-USDT"],
  universe: null,
  universeMode: "all",
  focusedMarket: "BTC-USDT",
  account: null,
  autopilot: null,
  chartCollapsed: false,
  positionsCollapsed: false,
  timers: []
};

const els = {
  simStatus: $("#simStatus"),
  keyStatus: $("#keyStatus"),
  skillStatus: $("#skillStatus"),
  liveStatus: $("#liveStatus"),
  autoStatus: $("#autoStatus"),
  pairTabs: $("#pairTabs"),
  timeframes: $("#timeframes"),
  refreshBtn: $("#refreshBtn"),
  chartPanel: $(".chart-panel"),
  toggleChartBtn: $("#toggleChartBtn"),
  togglePositionsBtn: $("#togglePositionsBtn"),
  instrumentTitle: $("#instrumentTitle"),
  instrumentMeta: $("#instrumentMeta"),
  lastPrice: $("#lastPrice"),
  priceChange: $("#priceChange"),
  sideSymbol: $("#sideSymbol"),
  sideName: $("#sideName"),
  sidePrice: $("#sidePrice"),
  sideChange: $("#sideChange"),
  klineCanvas: $("#klineCanvas"),
  chartTooltip: $("#chartTooltip"),
  maLabel: $("#maLabel"),
  bbLabel: $("#bbLabel"),
  rsiLabel: $("#rsiLabel"),
  macdLabel: $("#macdLabel"),
  ohlcNow: $("#ohlcNow"),
  rangeStats: $("#rangeStats"),
  updatedAt: $("#updatedAt"),
  timingSignal: $("#timingSignal"),
  timingText: $("#timingText"),
  watchTable: $("#watchTable"),
  accountTotal: $("#accountTotal"),
  availableUsdt: $("#availableUsdt"),
  floatingPnl: $("#floatingPnl"),
  marginUsage: $("#marginUsage"),
  positionCount: $("#positionCount"),
  positionsList: $("#positionsList"),
  hedgeNotice: $("#hedgeNotice"),
  positionsBox: $(".positions-box"),
  summaryAction: $("#summaryAction"),
  oscSignal: $("#oscSignal"),
  oscCounts: $("#oscCounts"),
  maSignal: $("#maSignal"),
  maCounts: $("#maCounts"),
  signalScore: $("#signalScore"),
  oscTable: $("#oscTable"),
  maTable: $("#maTable"),
  universeType: $("#universeType"),
  marketSearchInput: $("#marketSearchInput"),
  addSymbolBtn: $("#addSymbolBtn"),
  universeModeGroup: $("#universeModeGroup"),
  universeRiskFilter: $("#universeRiskFilter"),
  marketDetail: $("#marketDetail"),
  minAgeInput: $("#minAgeInput"),
  excludeNewInput: $("#excludeNewInput"),
  scanUniverseBtn: $("#scanUniverseBtn"),
  universeCount: $("#universeCount"),
  universeList: $("#universeList"),
  selectedSymbols: $("#selectedSymbols"),
  symbolsInput: $("#symbolsInput"),
  budgetInput: $("#budgetInput"),
  lookbackInput: $("#lookbackInput"),
  riskInput: $("#riskInput"),
  riskValue: $("#riskValue"),
  targetReturnInput: $("#targetReturnInput"),
  maxDrawdownInput: $("#maxDrawdownInput"),
  strategyHelp: $("#strategyHelp"),
  objectiveGroup: $("#objectiveGroup"),
  analyzeBtn: $("#analyzeBtn"),
  adviceAction: $("#adviceAction"),
  adviceWhy: $("#adviceWhy"),
  adviceMetrics: $("#adviceMetrics"),
  positionAdvicePanel: $("#positionAdvicePanel"),
  marketOpportunities: $("#marketOpportunities"),
  automationBadge: $("#automationBadge"),
  automationToggleBtn: $("#automationToggleBtn"),
  bestSymbol: $("#bestSymbol"),
  bestReason: $("#bestReason"),
  confidenceMetric: $("#confidenceMetric"),
  confidenceLabel: $("#confidenceLabel"),
  cashMetric: $("#cashMetric"),
  cashValue: $("#cashValue"),
  generatedAt: $("#generatedAt"),
  allocations: $("#allocations"),
  tradeIdeas: $("#tradeIdeas"),
  contractInstInput: $("#contractInstInput"),
  contractSideInput: $("#contractSideInput"),
  leverageEnabledInput: $("#leverageEnabledInput"),
  riskPctInput: $("#riskPctInput"),
  maxLeverageInput: $("#maxLeverageInput"),
  contractPlanBtn: $("#contractPlanBtn"),
  contractStatus: $("#contractStatus"),
  contractPlan: $("#contractPlan"),
  tpSlBox: $("#tpSlBox"),
  dryRunInput: $("#dryRunInput"),
  executionPanel: $(".execution-panel"),
  maxOrderInput: $("#maxOrderInput"),
  orderCount: $("#orderCount"),
  orders: $("#orders"),
  dryRunBtn: $("#dryRunBtn"),
  executeBtn: $("#executeBtn"),
  executionResult: $("#executionResult"),
  notes: $("#notes"),
  skillsInstalled: $("#skillsInstalled"),
  skillsExecutable: $("#skillsExecutable"),
  skillsWrite: $("#skillsWrite"),
  skillsList: $("#skillsList"),
  toast: $("#toast")
};

init();

function init() {
  bindEvents();
  renderSelectedSymbols();
  renderEmptyPlan();
  updateStrategyHelp();
  refreshAll();
  startRealtime();
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", refreshAll);
  els.toggleChartBtn.addEventListener("click", toggleChart);
  els.togglePositionsBtn.addEventListener("click", togglePositions);
  els.pairTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-symbol]");
    if (!button) return;
    setSymbol(button.dataset.symbol);
    syncActive(els.pairTabs, button);
  });
  els.timeframes.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-bar]");
    if (!button) return;
    state.bar = button.dataset.bar;
    syncActive(els.timeframes, button);
    loadMarket();
  });
  els.objectiveGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    state.objective = button.dataset.value;
    syncActive(els.objectiveGroup, button);
    updateStrategyHelp();
  });
  els.riskInput.addEventListener("input", () => {
    els.riskValue.textContent = els.riskInput.value;
    updateStrategyHelp();
    renderTradeIdeas(state.plan);
    renderAdvice();
  });
  els.lookbackInput.addEventListener("input", updateStrategyHelp);
  els.targetReturnInput.addEventListener("input", () => {
    updateStrategyHelp();
    renderTradeIdeas(state.plan);
    renderAdvice();
  });
  els.maxDrawdownInput.addEventListener("input", () => {
    updateStrategyHelp();
    renderTradeIdeas(state.plan);
    renderAdvice();
  });
  els.leverageEnabledInput.addEventListener("change", () => {
    els.maxLeverageInput.disabled = !els.leverageEnabledInput.checked;
    if (!els.leverageEnabledInput.checked) els.maxLeverageInput.value = "1";
  });
  els.scanUniverseBtn.addEventListener("click", scanUniverse);
  els.marketSearchInput.addEventListener("input", () => renderUniverse(state.universe));
  els.marketSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSymbolFromSearch();
  });
  els.addSymbolBtn.addEventListener("click", addSymbolFromSearch);
  els.marketDetail.addEventListener("click", handleMarketDetailAction);
  els.marketOpportunities.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-opportunity]");
    if (button) focusUniverseItem(button.dataset.opportunity);
  });
  els.universeRiskFilter.addEventListener("change", () => renderUniverse(state.universe));
  els.universeModeGroup.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    state.universeMode = button.dataset.mode;
    syncActive(els.universeModeGroup, button);
    renderUniverse(state.universe);
  });
  els.analyzeBtn.addEventListener("click", analyze);
  els.contractPlanBtn.addEventListener("click", loadContractPlan);
  els.automationToggleBtn.addEventListener("click", toggleAutomation);
  els.dryRunBtn.addEventListener("click", () => executeSelected(true));
  els.executeBtn.addEventListener("click", () => executeSelected(false));
  els.klineCanvas.addEventListener("mousemove", handleChartMove);
  els.klineCanvas.addEventListener("mouseleave", () => {
    state.hoverIndex = null;
    els.chartTooltip.hidden = true;
    drawKline(state.chart);
  });
  window.addEventListener("resize", () => drawKline(state.chart));
}

function toggleChart() {
  state.chartCollapsed = !state.chartCollapsed;
  els.chartPanel.classList.toggle("collapsed", state.chartCollapsed);
  els.toggleChartBtn.textContent = state.chartCollapsed ? "展开K线" : "收起K线";
  if (!state.chartCollapsed) requestAnimationFrame(() => drawKline(state.chart));
}

function togglePositions() {
  state.positionsCollapsed = !state.positionsCollapsed;
  els.positionsBox.classList.toggle("collapsed", state.positionsCollapsed);
  els.togglePositionsBtn.textContent = state.positionsCollapsed ? "展开" : "收起";
}

function startRealtime() {
  state.timers.forEach(clearInterval);
  state.timers = [
    setInterval(loadMarket, 10_000),
    setInterval(refreshAccount, 15_000),
    setInterval(loadWatchlist, 30_000)
  ];
}

async function refreshAll() {
  await Promise.allSettled([
    refreshHealth(),
    refreshSkills(),
    refreshAccount(),
    loadWatchlist(),
    loadMarket(),
    scanUniverse(false)
  ]);
}

async function refreshHealth() {
  const data = await request("/api/health");
  const credentials = data.credentials || {};
  setPill(els.simStatus, credentials.simulated ? "模拟盘" : "实盘已阻断", credentials.simulated ? "good" : "bad");
  setPill(els.keyStatus, credentials.privateReady ? `私有接口可用 · ${credentials.profile || "env"}` : "私有接口未就绪", credentials.privateReady ? "good" : "warn");
  state.autopilot = data.autopilot || {};
  renderAutomationState();
}

function renderAutomationState() {
  const enabled = Boolean(state.autopilot?.enabled);
  els.autoStatus.textContent = enabled ? "开启" : "关闭";
  els.automationBadge.textContent = enabled ? "自动化开启" : "自动化关闭";
  els.automationBadge.className = enabled ? "on" : "";
  els.automationToggleBtn.textContent = enabled ? "关闭自动化" : "开启自动化";
  els.automationToggleBtn.classList.toggle("on", enabled);
}

async function toggleAutomation() {
  const enable = !state.autopilot?.enabled;
  setBusy(els.automationToggleBtn, true, enable ? "开启中" : "关闭中");
  try {
    const data = await request("/api/autopilot", {
      method: "POST",
      body: JSON.stringify({
        enabled: enable,
        intervalMinutes: 15,
        executionMode: "analysis",
        dryRun: true,
        settings: readSettings()
      })
    });
    state.autopilot = data.autopilot;
    renderAutomationState();
    showToast(enable ? "自动化分析已开启：每 15 分钟刷新计划，不会自动实盘下单。" : "自动化已关闭");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.automationToggleBtn, false, enable ? "关闭自动化" : "开启自动化");
    renderAutomationState();
  }
}

async function refreshSkills() {
  const data = await request("/api/skills");
  const skills = data.skills || [];
  setPill(els.skillStatus, `${data.installed}/${skills.length} Skills`, data.installed === skills.length ? "good" : "warn");
  els.skillsInstalled.textContent = `${data.installed} 个已安装`;
  els.skillsExecutable.textContent = `${data.executable}/${skills.length}`;
  els.skillsWrite.textContent = `${data.writeEnabled} 个`;
  els.skillsList.innerHTML = skills.map((skill) => `
    <span class="skill-chip ${skill.writeAccess ? "write" : ""}" title="${escapeHtml(skill.logic)}">${escapeHtml(skill.name)}</span>
  `).join("");
}

async function refreshAccount() {
  try {
    const data = await request("/api/account/summary");
    state.account = data.account;
    renderAccount(data.account);
    renderAdvice();
  } catch (error) {
    els.availableUsdt.textContent = "--";
    els.accountTotal.textContent = "--";
    els.floatingPnl.textContent = error.message;
  }
}

function renderAccount(account) {
  if (!account) return;
  els.accountTotal.textContent = formatMoney(account.totalEqUsd);
  els.availableUsdt.textContent = formatMoney(account.availableUsdt);
  els.floatingPnl.textContent = `${formatMoney(account.totalUpl)} (${formatSignedNumber(account.uplRatio)}%)`;
  els.floatingPnl.className = Number(account.totalUpl || 0) >= 0 ? "up" : "down";
  els.marginUsage.textContent = `${formatMoney(account.usedMargin)} · ${formatMaybe(account.marginUsagePct)}%`;

  const positions = account.positions || [];
  els.positionCount.textContent = String(positions.length);
  els.positionsList.innerHTML = positions.length
    ? positions.map((item) => `
      <div class="position-row ${item.upl >= 0 ? "profit" : "loss"}">
        <strong>${escapeHtml(item.instId)} · ${escapeHtml(item.sideLabel || item.posSide || "")}</strong>
        <b class="${item.upl >= 0 ? "up" : "down"}">${formatMoney(item.upl)} / ${formatSignedNumber(item.uplRatioPct)}%</b>
        <span>数量 ${formatMaybe(item.pos)} · 杠杆 ${formatMaybe(item.lever)}x · ${escapeHtml(item.mgnMode || "--")}</span>
        <span>标记 ${formatPrice(item.markPx)} · 开仓 ${formatPrice(item.avgPx)}</span>
        <span>强平 ${formatPrice(item.liqPx)} · 距离 ${formatMaybe(item.liqDistancePct)}%</span>
        <span>盈亏平衡 ${formatPrice(item.bePx)}</span>
        <small>${escapeHtml(item.advice || positionAdvice(item))}</small>
      </div>
    `).join("")
    : `<div class="empty-state">暂无持仓</div>`;
  const hedge = account.hedge || {};
  els.hedgeNotice.textContent = hedge.text || "未检测到明显多空对冲。";
  els.hedgeNotice.className = `hedge-notice ${hedge.active ? hedge.severity || "medium" : ""}`.trim();
}

async function loadMarket() {
  try {
    const data = await request(`/api/chart?instId=${encodeURIComponent(state.symbol)}&bar=${encodeURIComponent(state.bar)}&limit=180&_=${Date.now()}`);
    state.chart = data;
    renderTicker(data);
    renderIndicators(data.indicators || {});
    renderTiming(data);
    renderAdvice();
    drawKline(data);
    setPill(els.liveStatus, `实时 ${shortClock(new Date())}`, "good");
  } catch (error) {
    setPill(els.liveStatus, "实时异常", "warn");
    showToast(error.message, true);
  }
}

async function loadWatchlist() {
  try {
    const data = await request(`/api/market/snapshot?symbols=${WATCH_SYMBOLS.join(",")}&limit=45&_=${Date.now()}`);
    renderWatchlist(data.data || {});
  } catch (error) {
    els.watchTable.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

async function scanUniverse(showNotice = true) {
  setBusy(els.scanUniverseBtn, true, "扫描中");
  try {
    const query = new URLSearchParams({
      instType: els.universeType.value,
      minAgeDays: els.minAgeInput.value,
      excludeNew: els.excludeNewInput.checked ? "1" : "0",
      limit: "500"
    });
    const data = await request(`/api/universe?${query.toString()}`);
    state.universe = data.universe;
    renderUniverse(data.universe);
    if (showNotice) showToast("AI 选币扫描完成");
  } catch (error) {
    els.universeList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    setBusy(els.scanUniverseBtn, false, "AI 扫描");
  }
}

function renderUniverse(universe) {
  if (!universe) {
    els.universeList.innerHTML = `<div class="empty-state">等待 AI 扫描</div>`;
    renderMarketDetail();
    return;
  }
  const rows = filteredUniverseRows(universe);
  if (!state.focusedMarket && rows[0]) state.focusedMarket = rows[0].instId;
  els.universeCount.textContent = `${universe.total} 个候选 · 显示 ${rows.length}`;
  els.universeList.innerHTML = rows.map((item) => {
    const selected = state.selectedSymbols.includes(toSpotSymbol(item.instId));
    const focused = item.instId === state.focusedMarket || toSpotSymbol(item.instId) === state.focusedMarket;
    const tone = scoreClass(item.aiScore);
    const probability = clamp(Number(item.aiScore || 0), 0, 100);
    const title = `${item.instId} | AI ${probability}% | 24H ${formatSignedPct(item.change24h)} | 成交额 ${formatCompact(item.volumeQuote24h)} | 上市 ${ageLabel(item.ageDays)} | ${item.reason}`;
    return `
      <button class="candidate-card ${tone} ${selected ? "active" : ""} ${focused ? "is-focus" : ""}" data-candidate="${escapeHtml(item.instId)}" title="${escapeHtml(title)}">
        <strong>${escapeHtml(item.instId.replace(/-/g, ""))}</strong>
        <span class="coin-price">${formatPrice(item.last)}</span>
        <b class="${Number(item.change24h || 0) >= 0 ? "up" : "down"}">${formatSignedPct(item.change24h)}</b>
        <em>${probability}</em>
      </button>
    `;
  }).join("") || `<div class="empty-state">没有匹配币种，换个搜索词或筛选条件</div>`;
  els.universeList.querySelectorAll("[data-candidate]").forEach((button) => {
    button.addEventListener("click", () => focusUniverseItem(button.dataset.candidate));
  });
  renderMarketDetail();
  renderAdvice();
}

function focusUniverseItem(instId) {
  state.focusedMarket = instId;
  setSymbol(toSpotSymbol(instId));
  renderUniverse(state.universe);
}

function renderMarketDetail() {
  const item = findUniverseSymbol(state.focusedMarket || state.symbol) || findUniverseSymbol(state.symbol);
  if (!item) {
    els.marketDetail.innerHTML = `<div class="empty-state">点击币种查看详情</div>`;
    return;
  }
  const spot = toSpotSymbol(item.instId);
  const selected = state.selectedSymbols.includes(spot);
  const longBias = Number(item.aiScore || 0) >= 65 && Number(item.change24h || 0) >= -0.01;
  const shortBias = Number(item.change24h || 0) < -0.025 || Number(item.aiScore || 0) <= 42;
  els.marketDetail.innerHTML = `
    <div class="market-detail-head">
      <div>
        <strong>${escapeHtml(item.instId.replace(/-/g, ""))}</strong>
        <span>${escapeHtml(item.tags?.join(" / ") || "常规")}</span>
      </div>
      <b class="${Number(item.change24h || 0) >= 0 ? "up" : "down"}">${formatSignedPct(item.change24h)}</b>
    </div>
    <div class="market-detail-grid">
      <span><b>最新价</b><strong>${formatPrice(item.last)}</strong></span>
      <span><b>AI分</b><strong>${item.aiScore}/100</strong></span>
      <span><b>24H额</b><strong>${formatCompact(item.volumeQuote24h)}</strong></span>
      <span><b>上市</b><strong>${ageLabel(item.ageDays)}</strong></span>
    </div>
    <p>${escapeHtml(item.reason || "等待更多数据确认。")}</p>
    <div class="market-bias ${longBias ? "long" : shortBias ? "short" : "wait"}">
      ${longBias ? "偏多观察：流动性与动量占优，可等待回踩确认。" : shortBias ? "偏空观察：动量偏弱，若使用永续可关注反抽做空。" : "中性观察：暂不适合追单，等待指标重新排列。"}
    </div>
    <div class="market-detail-actions">
      <button data-market-action="chart" data-symbol="${escapeHtml(spot)}">看图表</button>
      <button data-market-action="toggle" data-symbol="${escapeHtml(spot)}">${selected ? "移出组合" : "加入组合"}</button>
      <button data-market-action="swap" data-symbol="${escapeHtml(spot)}">合约计划</button>
    </div>
  `;
}

function handleMarketDetailAction(event) {
  const button = event.target.closest("button[data-market-action]");
  if (!button) return;
  const symbol = button.dataset.symbol;
  if (button.dataset.marketAction === "chart") setSymbol(symbol);
  if (button.dataset.marketAction === "toggle") toggleSelectedSymbol(symbol);
  if (button.dataset.marketAction === "swap") {
    setSymbol(symbol);
    els.contractInstInput.value = `${symbol.replace(/-USDT$/, "")}-USDT-SWAP`;
    loadContractPlan();
  }
}

function filteredUniverseRows(universe) {
  const source = state.universeMode === "recommended" ? universe.recommended || [] : universe.candidates || [];
  const query = normalizeSymbolInput(els.marketSearchInput.value).replace(/-USDT(-SWAP)?$/, "");
  const riskFilter = els.universeRiskFilter.value;
  return source
    .filter((item) => {
      const spot = toSpotSymbol(item.instId);
      if (state.universeMode === "selected" && !state.selectedSymbols.includes(spot)) return false;
      if (state.universeMode === "rising" && Number(item.change24h || 0) <= 0) return false;
      if (state.universeMode === "liquid" && Number(item.volumeQuote24h || 0) < 20_000_000) return false;
      if (query && !item.instId.replace(/-/g, "").includes(query.replace(/-/g, "")) && !String(item.baseCcy || "").includes(query)) return false;
      if (riskFilter === "mainstream" && !(item.tags || []).includes("主流")) return false;
      if (riskFilter === "noHighVol" && (item.tags || []).includes("高波动")) return false;
      if (riskFilter === "newOnly" && !item.isNew) return false;
      return true;
    })
    .slice(0, 260);
}

async function addSymbolFromSearch() {
  const raw = els.marketSearchInput.value;
  const symbol = normalizeSymbolInput(raw);
  if (!symbol) {
    showToast("输入币种代码，例如 BTC 或 BTC-USDT", true);
    return;
  }
  const found = findUniverseSymbol(symbol);
  if (found) {
    toggleSelectedSymbol(toSpotSymbol(found.instId));
    setSymbol(toSpotSymbol(found.instId));
    return;
  }
  setBusy(els.addSymbolBtn, true, "查找");
  try {
    const query = new URLSearchParams({ q: symbol, instType: els.universeType.value });
    const data = await request(`/api/instruments/search?${query.toString()}`);
    const match = data.matches?.[0];
    if (!match) throw new Error("OKX 未找到这个 USDT 交易对");
    const spotSymbol = toSpotSymbol(match.instId);
    if (!state.selectedSymbols.includes(spotSymbol)) state.selectedSymbols = [...state.selectedSymbols, spotSymbol].slice(0, 16);
    renderSelectedSymbols();
    setSymbol(spotSymbol);
    showToast(`已添加 ${spotSymbol.replace("-", "")}`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.addSymbolBtn, false, "添加");
  }
}

function findUniverseSymbol(symbol) {
  const normalized = normalizeSymbolInput(symbol);
  const compact = normalized.replace(/-/g, "");
  return (state.universe?.candidates || []).find((item) => {
    const inst = item.instId.replace("-SWAP", "");
    return inst === normalized || inst.replace(/-/g, "") === compact || item.baseCcy === normalized.replace("-USDT", "");
  });
}

function toggleSelectedSymbol(symbol) {
  if (state.selectedSymbols.includes(symbol)) {
    state.selectedSymbols = state.selectedSymbols.filter((item) => item !== symbol);
  } else {
    state.selectedSymbols = [...state.selectedSymbols, symbol].slice(0, 16);
  }
  renderSelectedSymbols();
  renderMarketDetail();
  if (state.universe) renderUniverse(state.universe);
}

function renderSelectedSymbols() {
  els.symbolsInput.value = state.selectedSymbols.join(", ");
  els.selectedSymbols.innerHTML = state.selectedSymbols.map((symbol) => `
    <span class="selected-symbol">
      ${escapeHtml(symbol.replace("-", ""))}
      <button data-remove-symbol="${escapeHtml(symbol)}">×</button>
    </span>
  `).join("");
  els.selectedSymbols.querySelectorAll("[data-remove-symbol]").forEach((button) => {
    button.addEventListener("click", () => toggleSelectedSymbol(button.dataset.removeSymbol));
  });
}

async function analyze() {
  if (!state.selectedSymbols.length) {
    showToast("请先选择至少一个币种", true);
    return;
  }
  setBusy(els.analyzeBtn, true, "计算中");
  clearExecutionResult();
  try {
    const data = await request("/api/analyze", {
      method: "POST",
      body: JSON.stringify(readSettings())
    });
    state.plan = data.plan;
    renderPlan(data.plan);
    showToast("组合计划已生成");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(els.analyzeBtn, false, "生成组合");
  }
}

async function loadContractPlan() {
  setBusy(els.contractPlanBtn, true, "生成中");
  try {
    const query = new URLSearchParams({
      instId: els.contractInstInput.value,
      side: els.contractSideInput.value,
      riskPct: els.riskPctInput.value,
      maxLeverage: els.leverageEnabledInput.checked ? els.maxLeverageInput.value : "1"
    });
    const data = await request(`/api/contract/plan?${query.toString()}`);
    renderContractPlan(data.plan);
  } catch (error) {
    els.contractPlan.className = "contract-plan empty-state";
    els.contractPlan.textContent = error.message;
  } finally {
    setBusy(els.contractPlanBtn, false, "AI 推荐");
  }
}

function renderContractPlan(plan) {
  const rec = plan.recommendation;
  const timing = rec.timing || {};
  const tpSl = rec.tpSl || {};
  els.contractStatus.textContent = `${plan.instId} · ${rec.leverage}x · ${rec.riskLevel}风险`;
  els.contractPlan.className = "contract-plan";
  els.contractPlan.innerHTML = `
    <div class="timing-card ${timing.state || "watch"}">
      <span>${escapeHtml(timing.label || "等待确认")}</span>
      <strong>${escapeHtml(timing.reason || "等待实时指标确认")}</strong>
      <small>${escapeHtml(timing.exitHint || "")}</small>
    </div>
    <div class="contract-hero">
      <article><span>推荐杠杆</span><strong>${rec.leverage}x</strong></article>
      <article><span>建议张数</span><strong>${rec.contracts}</strong></article>
      <article><span>保证金</span><strong>${formatMoney(rec.marginRequired)}</strong></article>
      <article><span>风险评分</span><strong>${rec.riskScore}</strong></article>
    </div>
    <div class="contract-hero">
      <article><span>入场</span><strong>${formatPrice(rec.entry)}</strong></article>
      <article><span>止损</span><strong>${formatPrice(rec.stop)}</strong></article>
      <article><span>止盈1</span><strong>${formatPrice(rec.target1)}</strong></article>
      <article><span>预估强平</span><strong>${formatPrice(rec.liquidationPrice)}</strong></article>
    </div>
    <div class="tier-grid">
      ${plan.tiers.map((tier) => `
        <div class="tier-card">
          <span>${escapeHtml(tier.name)} · ${tier.leverage}x</span>
          <strong>${tier.contracts} 张</strong>
          <span>止损 ${formatPrice(tier.stop)}</span>
          <span>目标 ${formatPrice(tier.target)}</span>
          <span>风险 ${formatMoney(tier.dollarRisk)}</span>
        </div>
      `).join("")}
    </div>
    <ul class="risk-notes">${rec.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
  `;
  els.tpSlBox.className = "tp-sl-box";
  els.tpSlBox.innerHTML = `
    <div class="tp-sl-head">
      <strong>AI 止盈止损</strong>
      <span>${escapeHtml(plan.side === "short" ? "空头计划" : "多头计划")}</span>
    </div>
    <div class="tp-sl-grid">
      <article class="danger-zone"><span>止损</span><strong>${formatPrice(tpSl.stopLoss || rec.stop)}</strong></article>
      <article class="profit-zone"><span>止盈1</span><strong>${formatPrice(tpSl.takeProfit1 || rec.target1)}</strong></article>
      <article class="profit-zone strong"><span>止盈2</span><strong>${formatPrice(tpSl.takeProfit2 || rec.target2)}</strong></article>
      <article><span>移动止损</span><strong>${formatPrice(tpSl.trailingStopAfterTp1)}</strong></article>
    </div>
    <p>${escapeHtml(tpSl.invalidation || timing.invalidation || "计划失效条件等待刷新。")}</p>
  `;
}

async function executeSelected(forceDryRun) {
  if (!state.plan) {
    showToast("先生成组合计划", true);
    return;
  }
  const selected = selectedOrders();
  if (!selected.length) {
    showToast("没有选中的订单", true);
    return;
  }
  const dryRun = forceDryRun || els.dryRunInput.checked;
  if (!dryRun && !window.confirm("提交到 OKX 模拟盘？会使用当前模拟盘资金。")) return;

  const button = forceDryRun ? els.dryRunBtn : els.executeBtn;
  setBusy(button, true, dryRun ? "检查中" : "提交中");
  clearExecutionResult();
  try {
    const data = await request("/api/execute", {
      method: "POST",
      body: JSON.stringify({
        orders: selected,
        dryRun,
        confirmation: dryRun ? "" : "EXECUTE_SIM",
        maxOrderUsdt: Number(els.maxOrderInput.value || 500)
      })
    });
    renderExecutionResult(data.execution);
    if (!dryRun) await refreshAccount();
  } catch (error) {
    renderExecutionError(error);
  } finally {
    setBusy(button, false, forceDryRun ? "检查订单" : "提交模拟盘");
  }
}

function readSettings() {
  return {
    symbols: state.selectedSymbols.join(","),
    budgetUsdt: Number(els.budgetInput.value || 0),
    lookbackDays: Number(els.lookbackInput.value || 90),
    objective: state.objective,
    riskLevel: Number(els.riskInput.value || 5),
    targetReturnPct: Number(els.targetReturnInput.value || 8),
    maxDrawdownPct: Number(els.maxDrawdownInput.value || 3),
    maxAssetWeight: 35,
    minOrderUsdt: 10,
    maxOrderUsdt: Number(els.maxOrderInput.value || 500)
  };
}

function updateStrategyHelp() {
  const copy = {
    defensive: "防守：提高现金和低波动资产权重，适合回撤敏感或趋势不明时使用。",
    balanced: "均衡：在回撤控制和趋势收益之间折中，适合默认模拟盘验证。",
    growth: "进攻：提高强动量资产权重，收益弹性更大，同时回撤和换手也会更高。"
  };
  els.strategyHelp.textContent = `${copy[state.objective] || copy.balanced} 回看 ${els.lookbackInput.value} 天用于评估近期波动、趋势和资产相关性；风险 ${els.riskInput.value}/10 会影响现金比例与单币上限；目标收益 ${els.targetReturnInput.value}%、最大回撤 ${els.maxDrawdownInput.value}% 会用于持仓和执行建议。`;
}

function selectedOrders() {
  const checked = new Set([...els.orders.querySelectorAll("input[type='checkbox']:checked")].map((item) => Number(item.dataset.index)));
  return (state.plan?.orderPlan || []).filter((_, index) => checked.has(index));
}

function renderTicker(data) {
  const ticker = data.ticker || {};
  const last = Number(ticker.last || data.candles?.at(-1)?.close || 0);
  const open = Number(ticker.open24h || 0);
  const change = open > 0 ? last / open - 1 : 0;
  const signClass = change >= 0 ? "up" : "down";
  const display = state.symbol.replace("-", "");
  const lastCandle = data.candles?.at(-1);

  els.instrumentTitle.textContent = state.symbol.replace("-", "/");
  els.instrumentMeta.textContent = `OKX · ${formatBar(state.bar)} · 技术指标`;
  els.lastPrice.textContent = formatPrice(last);
  els.priceChange.textContent = `${formatSignedPct(change)} 24H`;
  els.priceChange.className = signClass;
  els.sideSymbol.textContent = display;
  els.sideName.textContent = state.symbol.replace("-", "/");
  els.sidePrice.textContent = formatPrice(last);
  els.sideChange.textContent = formatSignedPct(change);
  els.sideChange.className = signClass;
  if (lastCandle) {
    els.ohlcNow.textContent = `开 ${formatPrice(lastCandle.open)} 高 ${formatPrice(lastCandle.high)} 低 ${formatPrice(lastCandle.low)} 收 ${formatPrice(lastCandle.close)}`;
  }
  const stats = data.stats || {};
  els.rangeStats.textContent = `区间最高 ${formatPrice(stats.high)} · 区间最低 ${formatPrice(stats.low)}`;
  els.updatedAt.textContent = `更新 ${shortClock(new Date(stats.updatedAt || Date.now()))}`;
}

function renderWatchlist(data) {
  els.watchTable.innerHTML = WATCH_SYMBOLS.map((symbol) => {
    const ticker = data[symbol]?.ticker || {};
    const last = Number(ticker.last || 0);
    const open = Number(ticker.open24h || 0);
    const change = open > 0 ? last / open - 1 : 0;
    const active = symbol === state.symbol ? "active" : "";
    return `
      <button class="watch-row ${active}" data-watch-symbol="${escapeHtml(symbol)}">
        <span>${escapeHtml(symbol.replace("-", ""))}</span>
        <strong>${formatPrice(last)}</strong>
        <em class="${change >= 0 ? "up" : "down"}">${formatSignedPct(change)}</em>
      </button>
    `;
  }).join("");

  els.watchTable.querySelectorAll("[data-watch-symbol]").forEach((button) => {
    button.addEventListener("click", () => setSymbol(button.dataset.watchSymbol));
  });
}

function setSymbol(symbol) {
  state.symbol = symbol;
  els.contractInstInput.value = `${symbol.replace(/-USDT$/, "")}-USDT-SWAP`;
  els.pairTabs.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab.dataset.symbol === symbol));
  loadMarket();
  loadWatchlist();
}

function renderIndicators(indicators) {
  const oscillators = indicators.oscillators || [];
  const movingAverages = indicators.movingAverages || [];
  const summary = indicators.summary || { buy: 0, sell: 0, neutral: 0, action: "中立", score: 50 };
  const oscSummary = summarizeRows(oscillators);
  const maSummary = summarizeRows(movingAverages);
  const chart = state.chart || {};
  const overlays = chart.overlays || {};
  const macd = chart.macd || {};

  els.summaryAction.textContent = summary.action;
  els.summaryAction.className = `signal ${actionClass(summary.action)}`;
  els.oscSignal.textContent = oscSummary.action;
  els.oscCounts.textContent = countsText(oscSummary);
  els.maSignal.textContent = maSummary.action;
  els.maCounts.textContent = countsText(maSummary);
  els.signalScore.textContent = `${summary.score}`;
  els.oscTable.innerHTML = rowsToHtml(oscillators);
  els.maTable.innerHTML = rowsToHtml(movingAverages);
  els.maLabel.textContent = `MA7 ${formatMaybe(last(overlays.ma7))} · MA25 ${formatMaybe(last(overlays.ma25))} · MA99 ${formatMaybe(last(overlays.ma99))}`;
  els.bbLabel.textContent = `BOLL ${formatMaybe(last(overlays.bbLower))} / ${formatMaybe(last(overlays.bbMiddle))} / ${formatMaybe(last(overlays.bbUpper))}`;
  els.rsiLabel.textContent = `RSI ${formatMaybe(oscillators.find((item) => item.name.startsWith("RSI"))?.value)}`;
  els.macdLabel.textContent = `MACD ${formatMaybe(last(macd.macd))} · Signal ${formatMaybe(last(macd.signal))}`;
}

function renderTiming(data) {
  const summary = data.indicators?.summary || {};
  const action = summary.action || "中立";
  const score = Number(summary.score || 50);
  const lastCandle = data.candles?.at(-1);
  const overlays = data.overlays || {};
  const ma25 = last(overlays.ma25);
  let label = "等待确认";
  let text = "当前没有高置信入场点，等待下一根 K 线确认。";
  if (/买/.test(action) && score >= 62) {
    label = "可观察入场";
    text = `买入信号占优；若价格回踩不破 MA25 ${formatMaybe(ma25)}，可小仓试入并用最近低点做防守。`;
  } else if (/卖/.test(action) && score <= 42) {
    label = "不建议追多";
    text = `卖出信号占优；已有多单应检查止损，空仓等待止跌或反抽失败。`;
  } else if (lastCandle && ma25 && lastCandle.close < ma25) {
    label = "偏防守";
    text = `价格低于 MA25 ${formatPrice(ma25)}，入场需要更严格确认，持仓可降低风险敞口。`;
  }
  els.timingSignal.textContent = label;
  els.timingSignal.className = `signal ${actionClass(action)}`;
  els.timingText.textContent = text;
}

function renderAdvice() {
  const chart = state.chart;
  const account = state.account;
  const plan = state.plan;
  if (!chart?.indicators) {
    els.adviceAction.textContent = "等待行情";
    els.adviceWhy.textContent = "K 线和指标还在加载。";
    els.adviceMetrics.innerHTML = "";
    renderPositionAdvice();
    renderMarketOpportunities();
    return;
  }
  const summary = chart.indicators.summary || {};
  const score = Number(summary.score || 50);
  const action = summary.action || "中立";
  const marginUsage = Number(account?.marginUsagePct || 0);
  const cashReserve = Number(plan?.cashReserve ?? (marginUsage > 20 ? 0.35 : 0.2));
  const target = plan?.allocations?.find((item) => item.symbol === state.symbol);
  const targetPct = Number(target?.targetPct || target?.weight * 100 || 0);
  const confidence = Number(plan?.confidence || 0);
  const universePick = (state.universe?.candidates || []).find((item) => toSpotSymbol(item.instId) === state.symbol);
  const aiScore = Number(universePick?.aiScore || 0);
  const targetReturn = Number(els.targetReturnInput.value || 8);
  const maxDrawdown = Number(els.maxDrawdownInput.value || 3);
  const trade = adviceDecision({ score, action, targetPct, confidence, marginUsage, aiScore, targetReturn, maxDrawdown });
  const reasons = [
    `技术面：${action}，综合分 ${score}/100`,
    plan ? `组合：目标 ${formatMaybe(targetPct)}%，现金 ${formatPct(cashReserve)}` : "组合：尚未生成，先按技术面和账户风险判断",
    account ? `账户：保证金占用 ${formatMaybe(marginUsage)}%，可用 ${formatMoney(account.availableUsdt)} USDT` : "账户：等待同步",
    `收益目标：目标 ${formatMaybe(targetReturn)}%，最大回撤 ${formatMaybe(maxDrawdown)}%`,
    universePick ? `选币：AI 候选分 ${aiScore}/100，${universePick.reason}` : "选币：当前币种不在最新候选列表"
  ];
  els.adviceAction.textContent = trade.label;
  els.adviceAction.className = trade.className;
  els.adviceWhy.textContent = reasons.join("；");
  els.adviceMetrics.innerHTML = [
    ["建议资金", trade.size],
    ["目标仓位", targetPct ? `${formatMaybe(targetPct)}%` : "--"],
    ["收益目标", `${formatMaybe(targetReturn)}%`],
    ["回撤上限", `${formatMaybe(maxDrawdown)}%`],
    ["现金防守", formatPct(cashReserve)],
    ["判断", trade.short]
  ].map(([label, value]) => `<span><b>${escapeHtml(label)}</b><strong>${escapeHtml(value)}</strong></span>`).join("");
  renderPositionAdvice();
  renderMarketOpportunities();
}

function renderPositionAdvice() {
  const positions = state.account?.positions || [];
  if (!positions.length) {
    els.positionAdvicePanel.innerHTML = `<div class="empty-state compact">暂无持仓，AI 会优先给出开仓观察位。</div>`;
    return;
  }
  const targetReturn = Number(els.targetReturnInput.value || 8);
  const maxDrawdown = Number(els.maxDrawdownInput.value || 3);
  els.positionAdvicePanel.innerHTML = positions.map((item) => {
    const advice = positionActionAdvice(item, targetReturn, maxDrawdown);
    return `
      <div class="position-advice ${advice.tone}">
        <strong>${escapeHtml(item.instId)} · ${escapeHtml(item.sideLabel || item.posSide || "")}</strong>
        <span>${escapeHtml(advice.label)}</span>
        <small>${escapeHtml(advice.reason)}</small>
      </div>
    `;
  }).join("");
}

function positionActionAdvice(item, targetReturn, maxDrawdown) {
  const pnlPct = Number(item.uplRatioPct || 0);
  const liqDistance = Number(item.liqDistancePct || 0);
  if (liqDistance > 0 && liqDistance < Math.max(4, maxDrawdown)) {
    return { label: "优先减仓/补保证金", tone: "bad", reason: `强平距离 ${formatMaybe(liqDistance)}%，低于风险阈值，先处理生存空间。` };
  }
  if (pnlPct <= -Math.abs(maxDrawdown)) {
    return { label: "触发止损检查", tone: "bad", reason: `浮亏 ${formatMaybe(pnlPct)}%，已接近或超过最大回撤目标 ${formatMaybe(maxDrawdown)}%。` };
  }
  if (pnlPct >= targetReturn) {
    return { label: "分批止盈", tone: "good", reason: `浮盈 ${formatMaybe(pnlPct)}%，已达到目标收益 ${formatMaybe(targetReturn)}%，建议锁定部分利润。` };
  }
  if (pnlPct > targetReturn * 0.55) {
    return { label: "上移止损", tone: "watch", reason: `距离收益目标较近，适合把止损抬到盈亏平衡价附近。` };
  }
  return { label: "持有观察", tone: "neutral", reason: item.advice || "等待下一次指标刷新确认。"};
}

function renderMarketOpportunities() {
  const rows = state.universe?.candidates || [];
  if (!rows.length) {
    els.marketOpportunities.innerHTML = `<div class="empty-state compact">等待全币种扫描</div>`;
    return;
  }
  const longs = rows
    .filter((item) => Number(item.aiScore || 0) >= 65 && Number(item.change24h || 0) > -0.01)
    .sort((a, b) => b.aiScore - a.aiScore || b.change24h - a.change24h)
    .slice(0, 4);
  const shorts = rows
    .filter((item) => Number(item.change24h || 0) < -0.015 || Number(item.aiScore || 0) <= 42)
    .sort((a, b) => a.change24h - b.change24h || b.volumeQuote24h - a.volumeQuote24h)
    .slice(0, 4);
  els.marketOpportunities.innerHTML = `
    <div>
      <h4>做多候选</h4>
      ${opportunityRows(longs, "long")}
    </div>
    <div>
      <h4>做空观察</h4>
      ${opportunityRows(shorts, "short")}
    </div>
  `;
}

function opportunityRows(rows, side) {
  if (!rows.length) return `<p class="muted">暂无明显${side === "long" ? "做多" : "做空"}候选</p>`;
  return rows.map((item) => `
    <button class="opportunity-row ${side}" data-opportunity="${escapeHtml(item.instId)}">
      <strong>${escapeHtml(item.instId.replace(/-/g, ""))}</strong>
      <span>${side === "long" ? "多" : "空"} · AI ${item.aiScore}</span>
      <b class="${Number(item.change24h || 0) >= 0 ? "up" : "down"}">${formatSignedPct(item.change24h)}</b>
    </button>
  `).join("");
}

function adviceDecision({ score, action, targetPct, confidence, marginUsage, aiScore, targetReturn, maxDrawdown }) {
  if (marginUsage >= 35) {
    return { label: "先降风险", short: "减仓/暂停加仓", size: "0%", className: "down" };
  }
  if (/卖/.test(action) || score <= 42) {
    return { label: "偏卖出/减仓", short: `止损优先 ${formatMaybe(maxDrawdown)}%`, size: targetPct ? `降至 ${formatMaybe(Math.max(targetPct * 0.5, 0))}%` : "0-5%", className: "down" };
  }
  if ((/买/.test(action) || score >= 62) && (confidence >= 60 || aiScore >= 65)) {
    const size = targetPct ? `${formatMaybe(targetPct)}%` : `${formatMaybe(clamp((score - 50) * 0.7, 5, 18))}%`;
    return { label: "可分批买入", short: `目标 ${formatMaybe(targetReturn)}%`, size, className: "up" };
  }
  if (targetPct > 0 && confidence >= 70) {
    return { label: "持有等待", short: "按计划仓位", size: `${formatMaybe(targetPct)}%`, className: "neutral-text" };
  }
  return { label: "观察为主", short: "不追单", size: "0-8%", className: "neutral-text" };
}

function renderPlan(plan) {
  els.bestSymbol.textContent = plan.best?.symbol || "--";
  els.bestReason.textContent = plan.best?.reason || "无首选资产";
  els.confidenceMetric.textContent = `${plan.confidence || 0}%`;
  els.confidenceLabel.textContent = confidenceLabel(plan.confidence || 0);
  els.cashMetric.textContent = formatPct(plan.cashReserve || 0);
  els.cashValue.textContent = `${formatMoney(plan.cashValueUsdt || 0)} USDT`;
  els.generatedAt.textContent = plan.generatedAt ? shortTime(plan.generatedAt) : "尚未生成";
  renderAllocations(plan.allocations || []);
  renderTradeIdeas(plan);
  renderOrders(plan.orderPlan || []);
  renderNotes(plan.notes || []);
  renderAdvice();
}

function renderEmptyPlan() {
  renderAllocations([]);
  renderTradeIdeas(null);
  renderOrders([]);
  renderNotes(["等待生成组合计划。"]);
}

function renderTradeIdeas(plan) {
  if (!plan?.allocations?.length) {
    els.tradeIdeas.innerHTML = `<div class="empty-state compact">生成组合后，这里会直接给出现货/合约、做多/做空和杠杆建议。</div>`;
    return;
  }
  const targetReturn = Number(els.targetReturnInput.value || 8);
  const maxDrawdown = Number(els.maxDrawdownInput.value || 3);
  const riskLevel = Number(els.riskInput.value || 5);
  const ideas = plan.allocations
    .filter((item) => item.symbol !== "USDT")
    .map((item) => tradeIdeaForAllocation(item, { targetReturn, maxDrawdown, riskLevel, confidence: plan.confidence || 0 }));
  const allocated = new Set(ideas.map((idea) => idea.symbol));
  const shortIdeas = (state.universe?.candidates || [])
    .filter((item) => !allocated.has(toSpotSymbol(item.instId)))
    .filter((item) => Number(item.change24h || 0) < -0.02 || Number(item.aiScore || 0) <= 42)
    .sort((a, b) => a.change24h - b.change24h)
    .slice(0, 2)
    .map((item) => ({
      symbol: toSpotSymbol(item.instId),
      mode: "永续合约",
      side: "做空观察",
      tone: "short",
      leverage: `${Math.min(3 + Math.floor(riskLevel / 2), 8)}x`,
      size: "0-5%",
      target: `目标 ${formatMaybe(targetReturn)}% / 止损 ${formatMaybe(maxDrawdown)}%`,
      reason: `${item.reason || "短线偏弱"}；未纳入现货组合，仅作为合约观察。`
    }));
  ideas.push(...shortIdeas);
  const cash = plan.allocations.find((item) => item.symbol === "USDT");
  if (cash) {
    ideas.push({
      symbol: "USDT",
      mode: "现金",
      side: "防守",
      tone: "cash",
      leverage: "1x",
      size: formatPct(cash.weight || 0),
      target: "等待更优入场",
      reason: `保留 ${formatMoney(cash.valueUsdt || 0)} USDT 作为波动缓冲。`
    });
  }
  els.tradeIdeas.innerHTML = ideas.map((idea) => `
    <article class="trade-idea ${idea.tone}">
      <div>
        <strong>${escapeHtml(idea.symbol.replace("-", ""))}</strong>
        <span>${escapeHtml(idea.mode)} · ${escapeHtml(idea.side)}</span>
      </div>
      <b>${escapeHtml(idea.size)}</b>
      <small>杠杆 ${escapeHtml(idea.leverage)} · ${escapeHtml(idea.target)}</small>
      <p>${escapeHtml(idea.reason)}</p>
    </article>
  `).join("");
}

function tradeIdeaForAllocation(item, context) {
  const universe = (state.universe?.candidates || []).find((candidate) => toSpotSymbol(candidate.instId) === item.symbol);
  const weightPct = Number(item.targetPct || item.weight * 100 || 0);
  const aiScore = Number(universe?.aiScore || item.score * 100 || 50);
  const change = Number(universe?.change24h || 0);
  const canUseSwap = context.riskLevel >= 6 && aiScore >= 70 && context.confidence >= 65;
  const shortSetup = change < -0.025 || aiScore <= 42;
  if (shortSetup && context.riskLevel >= 6) {
    return {
      symbol: item.symbol,
      mode: "永续合约",
      side: "做空观察",
      tone: "short",
      leverage: `${Math.min(3 + Math.floor(context.riskLevel / 2), 8)}x`,
      size: `${formatMaybe(Math.min(weightPct, 8))}%`,
      target: `目标 ${formatMaybe(context.targetReturn)}% / 止损 ${formatMaybe(context.maxDrawdown)}%`,
      reason: `${universe?.reason || item.reason || "动量偏弱"}；只适合作为观察或小仓对冲。`
    };
  }
  return {
    symbol: item.symbol,
    mode: canUseSwap ? "现货 + 永续" : "现货",
    side: "做多",
    tone: canUseSwap ? "swap-long" : "spot-long",
    leverage: canUseSwap ? `${Math.min(2 + Math.floor(context.riskLevel / 2), Number(els.maxLeverageInput.value || 10))}x` : "1x",
    size: `${formatMaybe(weightPct)}%`,
    target: `目标 ${formatMaybe(context.targetReturn)}% / 回撤 ${formatMaybe(context.maxDrawdown)}%`,
    reason: item.reason || universe?.reason || "组合权重为正，优先按分批入场处理。"
  };
}

function renderAllocations(allocations) {
  if (!allocations.length) {
    els.allocations.innerHTML = `<div class="empty-state">暂无目标仓位</div>`;
    return;
  }
  els.allocations.innerHTML = allocations.map((item) => `
    <div class="allocation-card ${item.symbol === "USDT" ? "cash" : ""}">
      <div class="allocation-head">
        <strong>${escapeHtml(item.symbol.replace("-", ""))}</strong>
        <b>${formatPct(item.weight || 0)}</b>
      </div>
      <div class="bar"><i style="width:${Math.max(2, Number(item.weight || 0) * 100)}%"></i></div>
      <div class="allocation-meta">
        <span>${formatMoney(item.valueUsdt || 0)} USDT</span>
        <span>${item.last ? `现价 ${formatPrice(item.last)}` : "现金仓位"}</span>
      </div>
    </div>
  `).join("");
}

function renderOrders(orders) {
  els.orderCount.textContent = `${orders.length} 笔`;
  els.executionPanel.classList.toggle("is-empty", !orders.length);
  if (!orders.length) {
    els.orders.innerHTML = `<div class="empty-state">暂无订单</div>`;
    return;
  }
  els.orders.innerHTML = orders.map((order, index) => `
    <label class="order-card">
      <input type="checkbox" data-index="${index}" checked>
      <span>
        <strong>${escapeHtml(order.instId)} · ${order.side === "buy" ? "买入" : "卖出"}</strong>
        <small>${escapeHtml(order.reason || "组合再平衡")}</small>
      </span>
      <b>${formatMoney(order.quoteValueUsdt || order.sz)} USDT</b>
    </label>
  `).join("");
}

function renderNotes(notes) {
  els.notes.innerHTML = notes.length ? notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("") : `<li>暂无提示</li>`;
}

function renderExecutionResult(execution) {
  const rows = execution.results || [];
  els.executionResult.hidden = false;
  els.executionResult.className = "execution-result good";
  els.executionResult.innerHTML = `
    <strong>${execution.dryRun ? "干跑检查通过" : "模拟盘订单已提交"}</strong>
    <p>${rows.length} 笔订单已处理。</p>
    ${rows.map((item) => `<span>${escapeHtml(item.instId)} · ${escapeHtml(item.status)} · ${escapeHtml(item.sz)}</span>`).join("")}
  `;
}

function renderExecutionError(error) {
  els.executionResult.hidden = false;
  els.executionResult.className = "execution-result bad";
  els.executionResult.innerHTML = `
    <strong>执行失败</strong>
    <p>${escapeHtml(error.message)}</p>
    ${error.detailText ? `<small>${escapeHtml(error.detailText)}</small>` : ""}
  `;
}

function clearExecutionResult() {
  els.executionResult.hidden = true;
  els.executionResult.innerHTML = "";
}

function handleChartMove(event) {
  if (!state.chartMeta || !state.chart?.candles?.length) return;
  const rect = els.klineCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const index = Math.round((x - state.chartMeta.pad.left - state.chartMeta.xStep / 2) / state.chartMeta.xStep);
  state.hoverIndex = clamp(index, 0, state.chart.candles.length - 1);
  const candle = state.chart.candles[state.hoverIndex];
  els.chartTooltip.hidden = false;
  els.chartTooltip.style.left = `${Math.min(rect.width - 210, Math.max(8, x + 12))}px`;
  els.chartTooltip.style.top = `${Math.max(8, event.clientY - rect.top + 12)}px`;
  els.chartTooltip.innerHTML = `
    <strong>${formatDateTime(candle.ts)}</strong><br>
    开 ${formatPrice(candle.open)} · 高 ${formatPrice(candle.high)}<br>
    低 ${formatPrice(candle.low)} · 收 ${formatPrice(candle.close)}<br>
    量 ${formatCompact(candle.volQuote || candle.vol)}
  `;
  drawKline(state.chart);
}

function drawKline(data) {
  const canvas = els.klineCanvas;
  if (!canvas || !data?.candles?.length) return;
  const candles = data.candles;
  const overlays = data.overlays || {};
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(760, Math.floor(rect.width * dpr));
  canvas.height = Math.max(420, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const pad = { left: 56, right: 72, top: 18, bottom: 34 };
  const volumeTop = Math.round(height * 0.76);
  const priceBottom = volumeTop - 12;
  const priceValues = [
    ...candles.flatMap((item) => [item.high, item.low]),
    ...Object.values(overlays).flat().filter(Number.isFinite)
  ];
  const min = Math.min(...priceValues);
  const max = Math.max(...priceValues);
  const range = max - min || 1;
  const xStep = (width - pad.left - pad.right) / candles.length;
  const candleWidth = Math.max(3, Math.min(10, xStep * 0.62));
  const maxVol = Math.max(...candles.map((item) => item.volQuote || item.vol || 0), 1);
  const yPrice = (value) => pad.top + (1 - (value - min) / range) * (priceBottom - pad.top);
  const xAt = (index) => pad.left + index * xStep + xStep / 2;
  state.chartMeta = { pad, xStep, yPrice, xAt, priceBottom, volumeTop };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = cssVar("--chart-bg", "#fff");
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, pad, volumeTop);

  candles.forEach((candle, index) => {
    const x = xAt(index);
    const up = candle.close >= candle.open;
    const color = up ? "#00a884" : "#f6465d";
    const yOpen = yPrice(candle.open);
    const yClose = yPrice(candle.close);
    const yHigh = yPrice(candle.high);
    const yLow = yPrice(candle.low);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();
    ctx.fillRect(x - candleWidth / 2, Math.min(yOpen, yClose), candleWidth, Math.max(Math.abs(yClose - yOpen), 1));

    const vol = candle.volQuote || candle.vol || 0;
    const volHeight = (height - pad.bottom - volumeTop) * (vol / maxVol);
    ctx.globalAlpha = 0.32;
    ctx.fillRect(x - candleWidth / 2, height - pad.bottom - volHeight, candleWidth, volHeight);
    ctx.globalAlpha = 1;
  });

  drawLine(ctx, overlays.bbUpper, xAt, yPrice, "#53a8ff", 1.5);
  drawLine(ctx, overlays.bbLower, xAt, yPrice, "#ff6b6b", 1.5);
  drawLine(ctx, overlays.ma7, xAt, yPrice, "#ffb020", 2);
  drawLine(ctx, overlays.ma25, xAt, yPrice, "#f6465d", 2);
  drawLine(ctx, overlays.ma99, xAt, yPrice, "#2f80ed", 2);

  drawHighLowLabels(ctx, candles, xAt, yPrice);
  drawLastPrice(ctx, candles.at(-1), width, pad, yPrice);
  if (state.hoverIndex !== null) drawCrosshair(ctx, candles[state.hoverIndex], state.hoverIndex, width, height, pad, xAt, yPrice);
  drawAxisLabels(ctx, width, pad, min, max, yPrice);
}

function drawGrid(ctx, width, height, pad, volumeTop) {
  ctx.strokeStyle = cssVar("--chart-grid", "#edf0f2");
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i += 1) {
    const y = pad.top + ((volumeTop - pad.top) / 6) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 8; i += 1) {
    const x = pad.left + ((width - pad.left - pad.right) / 8) * i;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, height - pad.bottom);
    ctx.stroke();
  }
  ctx.strokeStyle = cssVar("--line-strong", "#dfe3e6");
  ctx.beginPath();
  ctx.moveTo(pad.left, volumeTop);
  ctx.lineTo(width - pad.right, volumeTop);
  ctx.stroke();
}

function drawLine(ctx, values, xAt, yPrice, color, width) {
  if (!Array.isArray(values)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    const x = xAt(index);
    const y = yPrice(value);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (started) ctx.stroke();
}

function drawHighLowLabels(ctx, candles, xAt, yPrice) {
  const highIndex = candles.reduce((best, item, index) => item.high > candles[best].high ? index : best, 0);
  const lowIndex = candles.reduce((best, item, index) => item.low < candles[best].low ? index : best, 0);
  ctx.font = "12px Inter, Segoe UI, sans-serif";
  ctx.fillStyle = cssVar("--ink", "#111418");
  ctx.strokeStyle = cssVar("--ink", "#111418");
  [
    { index: highIndex, value: candles[highIndex].high, label: `高 ${formatPrice(candles[highIndex].high)}`, align: -1 },
    { index: lowIndex, value: candles[lowIndex].low, label: `低 ${formatPrice(candles[lowIndex].low)}`, align: 1 }
  ].forEach((mark) => {
    const x = xAt(mark.index);
    const y = yPrice(mark.value);
    const tx = mark.align < 0 ? x - 72 : x + 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx + (mark.align < 0 ? 64 : -4), y);
    ctx.stroke();
    ctx.fillText(mark.label, tx, y - 4);
  });
}

function drawLastPrice(ctx, candle, width, pad, yPrice) {
  const y = yPrice(candle.close);
  const color = candle.close >= candle.open ? "#00a884" : "#f6465d";
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(pad.left, y);
  ctx.lineTo(width - pad.right + 6, y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawPriceTag(ctx, width - pad.right + 8, y, candle.close, color);
}

function drawCrosshair(ctx, candle, index, width, height, pad, xAt, yPrice) {
  const x = xAt(index);
  const y = yPrice(candle.close);
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = cssVar("--chart-crosshair", "rgba(17, 20, 24, 0.55)");
  ctx.beginPath();
  ctx.moveTo(x, pad.top);
  ctx.lineTo(x, height - pad.bottom);
  ctx.moveTo(pad.left, y);
  ctx.lineTo(width - pad.right, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawAxisLabels(ctx, width, pad, min, max, yPrice) {
  ctx.fillStyle = cssVar("--muted", "#69717a");
  ctx.font = "12px Inter, Segoe UI, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const value = min + ((max - min) / 4) * i;
    ctx.fillText(formatPrice(value), width - pad.right + 8, yPrice(value) + 4);
  }
}

function drawPriceTag(ctx, x, y, value, color) {
  const text = formatPrice(value);
  ctx.font = "12px Inter, Segoe UI, sans-serif";
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 12, width, 24);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + 6, y + 4);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`请求失败：HTTP ${response.status}`);
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(formatApiError(data.error));
    error.detail = data.error?.detail || {};
    error.detailText = formatDetail(data.error?.detail);
    throw error;
  }
  return data;
}

function formatApiError(error) {
  const failed = Array.isArray(error?.detail?.data) ? error.detail.data.find((item) => item.sMsg) : null;
  if (failed) return `OKX ${failed.sCode}: ${failed.sMsg}`;
  return error?.message || "请求失败";
}

function formatDetail(detail) {
  const failed = Array.isArray(detail?.data) ? detail.data.find((item) => item.sMsg) : null;
  if (failed) return `订单状态码 ${failed.sCode}，子码 ${failed.subCode || "--"}`;
  if (detail?.code === "INSUFFICIENT_SIMULATED_USDT") {
    return `需要 ${detail.requiredUsdt} USDT，可用 ${detail.availableUsdt} USDT`;
  }
  return "";
}

function rowsToHtml(rows) {
  return rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatMaybe(item.value)}</td>
      <td><span class="action ${actionClass(item.action)}">${escapeHtml(item.action)}</span></td>
    </tr>
  `).join("");
}

function summarizeRows(rows) {
  const buy = rows.filter((item) => item.action === "买入").length;
  const sell = rows.filter((item) => item.action === "卖出").length;
  const neutral = rows.length - buy - sell;
  let action = "中立";
  if (buy > sell) action = "买入";
  if (sell > buy) action = "卖出";
  return { buy, sell, neutral, action };
}

function countsText(summary) {
  return `买入 ${summary.buy} · 中立 ${summary.neutral} · 卖出 ${summary.sell}`;
}

function actionClass(action) {
  if (/买/.test(action)) return "buy";
  if (/卖/.test(action)) return "sell";
  if (/趋势/.test(action)) return "trend";
  return "neutral";
}

function scoreClass(score) {
  const value = Number(score || 0);
  if (value >= 72) return "score-strong";
  if (value >= 58) return "score-good";
  if (value <= 42) return "score-risk";
  return "score-watch";
}

function shortReason(reason) {
  const text = String(reason || "等待更多数据确认");
  return text.length > 28 ? `${text.slice(0, 28)}...` : text;
}

function ageLabel(ageDays) {
  if (!Number.isFinite(Number(ageDays))) return "未知";
  if (ageDays < 30) return `${Math.round(ageDays)}天`;
  if (ageDays < 365) return `${Math.round(ageDays / 30)}月`;
  return `${(ageDays / 365).toFixed(1)}年`;
}

function normalizeSymbolInput(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.includes("-")) return raw.endsWith("-SWAP") ? raw.replace("-SWAP", "-USDT-SWAP").replace("-USDT-USDT", "-USDT") : raw;
  return `${raw}-USDT`;
}

function positionAdvice(item) {
  const liqDistance = Number(item.liqDistancePct || 0);
  const pnlPct = Number(item.uplRatioPct || 0);
  if (liqDistance > 0 && liqDistance <= 4) return "强平距离过近，优先减仓或补保证金。";
  if (pnlPct <= -8) return "亏损扩大，检查止损或降低仓位。";
  if (pnlPct >= 10) return "浮盈明显，建议上移止损并分批止盈。";
  return "等待下一次实时刷新确认。";
}

function toSpotSymbol(instId) {
  return instId.replace("-SWAP", "");
}

function syncActive(parent, activeButton) {
  parent.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button === activeButton));
}

function setPill(element, text, status) {
  element.textContent = text;
  element.className = `status-pill ${status || ""}`.trim();
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  button.textContent = text;
}

function showToast(message, bad = false) {
  els.toast.textContent = message;
  els.toast.className = `toast ${bad ? "bad" : ""}`.trim();
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2800);
}

function confidenceLabel(value) {
  if (value >= 75) return "较高";
  if (value >= 55) return "中等";
  return "偏低";
}

function formatBar(bar) {
  const map = { "1m": "1分", "5m": "5分", "15m": "15分", "30m": "30分", "1H": "1小时", "4H": "4小时", "1D": "1天" };
  return map[bar] || bar;
}

function formatPrice(value) {
  const number = Number(value || 0);
  const digits = number >= 1000 ? 1 : number >= 1 ? 3 : 6;
  return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(value) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(2)}K`;
  return formatMaybe(number);
}

function formatPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatSignedPct(value) {
  const pct = Number(value || 0) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatSignedNumber(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}`;
}

function formatMaybe(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return Math.abs(Number(value)) >= 1000 ? formatPrice(value) : Number(value).toFixed(2);
}

function shortTime(value) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortClock(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(ts) {
  return new Date(Number(ts)).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function last(values) {
  return Array.isArray(values) ? values[values.length - 1] : undefined;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function $(selector) {
  return document.querySelector(selector);
}
