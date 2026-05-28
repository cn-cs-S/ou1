import type {
  AccountSummary,
  AccountDetailSnapshot,
  AccountsOverview,
  AccountSource,
  AIPlan,
  AIDirection,
  AIRecommendation,
  MarketFlowReference,
  AutomationState,
  CandleData,
  CryptoAsset,
  IndicatorPack,
  PlanSettings,
  Position,
  TradeOrder,
} from '@/lib/mock-data'

export interface ChartSnapshot {
  candles: CandleData[]
  indicators: IndicatorPack | null
  marketSource?: string
  stats: {
    high?: number
    low?: number
    updatedAt?: string
  }
}

export interface TerminalHealth {
  connected: boolean
  accountSource: AccountSource
  accountLabel: string
  privateReady: boolean
  marketSource?: string
  automation: AutomationState | null
}

export interface SkillStatus {
  active: boolean
  installed: number
  executable: number
}

interface ContractPlan {
  instId: string
  side: 'long' | 'short'
  market?: {
    orderFlow?: MarketFlowReference | null
  }
  recommendation: {
    leverage: number
    maxLeverage: number
    exchangeMaxLeverage: number
    entry: number
    stop: number
    target1: number
    target2: number
    riskScore: number
    riskLevel: string
    timing: {
      state: 'enter' | 'watch' | 'wait'
      label: string
      reason: string
      exitHint: string
    }
    notes: string[]
    contracts: number
    contractValue: number
    notional: number
    marginRequired: number
    capitalRequired: number
    weeklyFundingCost: number
    feeRate: number
    feeSource: string
    estimatedEntryFee: number
    estimatedSevenDayCost: number
  }
}

interface RawPlanAsset {
  symbol: string
  last?: number
  score?: number
  targetPct?: number
  weight?: number
  reason?: string
  momentum30?: number
  valueUsdt?: number
  feeRate?: number
  feeSource?: string
  estimatedEntryFee?: number
}

interface RawInvestmentPlan {
  generatedAt: string
  objective: PlanSettings['objective']
  objectiveLabel?: string
  riskLevel: number
  budgetUsdt: number
  confidence: number
  cashReserve: number
  assets: RawPlanAsset[]
  orderPlan: TradeOrder[]
  notes: string[]
}

export const defaultPlanSettings: PlanSettings = {
  budgetUsdt: 1000,
  lookbackDays: 60,
  objective: 'balanced',
  riskLevel: 5,
  maxAssetWeight: 35,
  minOrderUsdt: 10,
  targetReturn: 12,
  maxDrawdown: 8,
  excludeNewCoins: true,
  productPreference: 'both',
  favoritePoolOnly: false,
  manageExistingPositions: true,
  allowNewPositions: true,
  allowPositionIncrease: true,
  maxActionsPerCycle: 6,
}

const OKX_LEVERAGE_TIERS = [1, 2, 3, 5, 10, 20, 50]

function displayLeverageTier(value: number) {
  const cap = Math.min(Math.max(Number(value || 1), 1), 50)
  return OKX_LEVERAGE_TIERS.filter((tier) => tier <= cap).at(-1) || 1
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/backend${path}`, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      ...options,
    })
  } catch {
    throw new Error('行情服务暂时不可用，系统将在下一轮自动重试')
  }
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
  if (!response.ok) {
    throw new Error(payload?.error?.message || `请求失败 (${response.status})`)
  }
  return payload as T
}

export async function fetchHealth(): Promise<TerminalHealth> {
  const data = await request<{
    defaults: { accountSource: 'test' | 'live-readonly'; accountLabel: string; marketSource?: string }
    credentials: { privateReady: boolean }
    autopilot: AutomationState
  }>('/health')
  return {
    connected: true,
    accountSource: data.defaults.accountSource,
    accountLabel: data.defaults.accountLabel,
    privateReady: data.credentials.privateReady,
    marketSource: data.defaults.marketSource,
    automation: data.autopilot,
  }
}

export async function fetchSkillStatus(): Promise<SkillStatus> {
  const data = await request<{ installed: number; executable: number }>('/skills')
  return { active: data.executable > 0, installed: data.installed, executable: data.executable }
}

export async function fetchAssets(): Promise<CryptoAsset[]> {
  type UniverseResponse = {
    marketSource?: string
    universe: {
      candidates: Array<{
        instId: string
        instType: 'SPOT' | 'SWAP'
        baseCcy: string
        last: number
        change24h: number
        volumeQuote24h: number
        aiScore: number
        reason: string
        tags: string[]
        isNew: boolean
        ageDays: number | null
        lever: number
        ctVal: number
      }>
    }
  }
  const [spot, swap] = await Promise.all([
    request<UniverseResponse>('/universe?instType=SPOT&quoteCcy=USDT&excludeNew=0&minAgeDays=30&limit=500'),
    request<UniverseResponse>('/universe?instType=SWAP&quoteCcy=USDT&excludeNew=0&minAgeDays=30&limit=500'),
  ])
  return [...spot.universe.candidates, ...swap.universe.candidates].map((asset) => ({
    id: asset.instId,
    instId: asset.instId,
    instType: asset.instType,
    symbol: asset.baseCcy,
    name: asset.baseCcy,
    price: asset.last,
    change24h: asset.change24h * 100,
    volume24h: asset.volumeQuote24h,
    aiScore: asset.aiScore,
    reason: asset.reason,
    tags: asset.tags,
    isNew: asset.isNew,
    ageDays: asset.ageDays,
    maxLeverage: asset.instType === 'SWAP' ? displayLeverageTier(asset.lever) : 1,
    contractValue: asset.ctVal,
  })).sort((a, b) => b.aiScore - a.aiScore || a.instType.localeCompare(b.instType))
}

export async function fetchChart(instId: string, bar: string): Promise<ChartSnapshot> {
  const data = await request<{
    marketSource?: string
    candles: Array<{ ts: number; open: number; high: number; low: number; close: number; vol: number; volQuote: number }>
    indicators?: IndicatorPack
    stats?: { high?: number; low?: number; updatedAt?: string }
  }>(`/chart?instId=${encodeURIComponent(instId)}&bar=${encodeURIComponent(bar)}&limit=180&_=${Date.now()}`)
  return {
    candles: data.candles.map((candle) => ({
      time: Math.floor(candle.ts / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volQuote || candle.vol,
    })),
    indicators: data.indicators || null,
    marketSource: data.marketSource,
    stats: data.stats || {},
  }
}

export async function fetchMarketFlow(instId: string): Promise<MarketFlowReference> {
  const data = await request<{ marketFlow: MarketFlowReference }>(`/market-flow?instId=${encodeURIComponent(instId)}&_=${Date.now()}`)
  return data.marketFlow
}

export async function fetchAccount(source: AccountSource = 'test', accountId = 'default'): Promise<AccountSummary> {
  const data = await request<{ account: RawAccountSummary }>(`/account/summary?source=${encodeURIComponent(source)}&accountId=${encodeURIComponent(accountId)}`)
  return mapAccount(data.account)
}

export async function fetchAccountsOverview(): Promise<AccountsOverview> {
  const data = await request<{ overview: RawAccountsOverview }>('/accounts/overview')
  return {
    ...data.overview,
    accounts: data.overview.accounts.map((entry) => ({
      ...entry,
      account: entry.account ? mapAccount(entry.account) : undefined,
    })),
  }
}

export async function fetchAccountDetails(): Promise<AccountDetailSnapshot> {
  const data = await request<{ detail: RawAccountDetail }>('/accounts/detail')
  return {
    ...data.detail,
    accounts: data.detail.accounts.map((entry) => ({
      ...entry,
      account: entry.account ? mapAccount(entry.account) : undefined,
    })),
    operations: data.detail.operations || [],
  }
}

export async function fetchAutomation(accountId = 'default'): Promise<AutomationState> {
  const data = await request<{ autopilot: AutomationState }>(`/autopilot?accountId=${encodeURIComponent(accountId)}`)
  return data.autopilot
}

type RawAccountSummary = Omit<AccountSummary, 'positions'> & {
  positions: Array<{
    instId: string
    instType: string
    posSide?: string
    pos: number
    avgPx: number
    markPx: number
    upl: number
    uplRatioPct: number
    lever: number
    notionalUsd?: number
    margin?: number
    marginMode?: string
    mgnMode?: string
    maintenanceMarginRatePct?: number
    maintenanceMarginRatioPct?: number
    maintenanceMarginUsd?: number
    fundingFee?: number
    fundingRate?: number
    liqPx: number
    bePx: number
    advice: string
    valuationLabel?: string
    entryLabel?: string
    liqLabel?: string
    valuationWarning?: string
    isTestPosition?: boolean
  }>
}

type RawAccountsOverview = Omit<AccountsOverview, 'accounts'> & {
  accounts: Array<Omit<AccountsOverview['accounts'][number], 'account'> & { account?: RawAccountSummary }>
}

type RawAccountDetail = RawAccountsOverview & {
  operations: AccountDetailSnapshot['operations']
}

function mapAccount(account: RawAccountSummary): AccountSummary {
  return {
    ...account,
    positions: account.positions.map((position, index): Position => ({
      id: `${position.instId}-${index}`,
      instId: position.instId,
      symbol: position.instId.split('-')[0],
      side: position.posSide === 'short' || position.pos < 0 ? 'short' : 'long',
      type: position.instType === 'SPOT' ? 'spot' : 'perpetual',
      entryPrice: position.avgPx,
      markPrice: position.markPx,
      size: Math.abs(position.pos),
      leverage: position.lever || 1,
      notionalUsd: position.notionalUsd,
      margin: position.margin,
      marginMode: position.marginMode || position.mgnMode,
      maintenanceMarginRatePct: position.maintenanceMarginRatePct,
      maintenanceMarginRatioPct: position.maintenanceMarginRatioPct,
      maintenanceMarginUsd: position.maintenanceMarginUsd,
      fundingFee: position.fundingFee,
      fundingRate: position.fundingRate,
      pnl: position.upl,
      pnlPercent: position.uplRatioPct,
      liquidationPrice: position.liqPx,
      breakEvenPrice: position.bePx,
      aiSuggestion: position.advice,
      valuationLabel: position.valuationLabel,
      entryLabel: position.entryLabel,
      liquidationLabel: position.liqLabel,
      valuationWarning: position.valuationWarning,
      isTestPosition: position.isTestPosition,
    })),
  }
}

export async function generateInvestmentPlan(settings: PlanSettings, assets: CryptoAsset[], accountSource: AccountSource = 'test', accountId = 'default', directionUniverse: CryptoAsset[] = assets): Promise<AIPlan> {
  const allowedAssets = assets.filter((item) => (
    settings.productPreference === 'spot' ? item.instType === 'SPOT'
      : settings.productPreference === 'swap' ? item.instType === 'SWAP'
        : true
  ))
  const scopedAssets = (settings.excludeNewCoins ? allowedAssets.filter((item) => !item.isNew) : allowedAssets).slice(0, 12)
  if (!scopedAssets.length) throw new Error('当前偏好与筛选条件下没有可分析的真实交易品种。')
  const symbols = scopedAssets.map((item) => item.instId).join(',')
  const sourceByInstId = new Map(scopedAssets.map((item) => [item.instId, item]))
  const data = await request<{ plan: RawInvestmentPlan }>('/analyze', {
    method: 'POST',
    body: JSON.stringify({ ...settings, symbols }),
  })
  const rankedAssets = data.plan.assets.filter((asset) => asset.score !== undefined)
  const selectedCandidate = rankedAssets.find((asset) => asset.symbol === scopedAssets[0]?.instId)
  const candidateAssets = [
    ...(selectedCandidate ? [selectedCandidate] : []),
    ...rankedAssets.filter((asset) => asset.symbol !== selectedCandidate?.symbol),
  ].slice(0, 12)
  const contractResults = await Promise.all(candidateAssets.map(async (asset, index) => {
    const sourceAsset = sourceByInstId.get(asset.symbol)
    const directionAsset = sourceAsset ? findDirectionAsset(sourceAsset, directionUniverse) : undefined
    if (!sourceAsset || !directionAsset) {
      return {
        plans: null,
        directionAsset: undefined,
        notice: '该币种当前没有对应的 USDT 永续合约，无法生成可执行的做空方案。',
      }
    }
    try {
      const capitalBudget = Number(asset.valueUsdt || 0)
      const plans = await fetchContractPair(
        directionAsset, settings.riskLevel, index === 0 ? 15000 : 10000,
        accountSource, accountId, capitalBudget,
      )
      return { plans, directionAsset, notice: undefined }
    } catch {
      return {
        plans: null,
        directionAsset,
        notice: '对应永续市场的双向建议暂未同步完成，系统会继续重试。',
      }
    }
  }))
  const recommendations = candidateAssets.map((asset, index) => (
    mapRecommendation(
      asset,
      sourceByInstId.get(asset.symbol),
      contractResults[index].plans,
      data.plan.confidence,
      contractResults[index].directionAsset,
      contractResults[index].notice,
    )
  ))
  const orderPlan = recommendations.flatMap((recommendation): TradeOrder[] => {
    const allocation = Number(recommendation.allocationUsdt || 0)
    if (allocation < settings.minOrderUsdt || recommendation.action === 'watch') return []
    if (recommendation.type === 'spot') {
      return [{
        instId: recommendation.instId,
        instType: 'SPOT',
        side: 'buy',
        positionSide: 'long',
        action: 'add',
        quoteValueUsdt: allocation,
        requiredCapitalUsdt: allocation + Number(recommendation.estimatedEntryFee || 0),
        estimatedFee: recommendation.estimatedEntryFee,
        sz: String(allocation),
        reason: recommendation.reasoning,
      }]
    }
    if (!recommendation.orderQuantity || !recommendation.notionalUsd || !recommendation.capitalRequired) return []
    return [{
      instId: recommendation.instId,
      instType: 'SWAP',
      side: recommendation.side === 'short' ? 'sell' : 'buy',
      positionSide: recommendation.side === 'short' ? 'short' : 'long',
      action: 'add',
      leverage: recommendation.leverage,
      contracts: recommendation.orderQuantity,
      quoteValueUsdt: recommendation.notionalUsd,
      requiredCapitalUsdt: recommendation.capitalRequired,
      estimatedFee: recommendation.estimatedEntryFee,
      weeklyFundingCost: recommendation.weeklyFundingCost,
      sz: String(recommendation.orderQuantity),
      reason: recommendation.reasoning,
    }]
  })
  const scopeNote = settings.excludeNewCoins
    ? 'AI 扫描已排除上市不足 30 天的新币；市场列表仍显示真实已上线品种供查看。'
    : 'AI 扫描已包含真实市场中的新上线品种，请注意流动性与波动风险。'
  const poolNote = settings.favoritePoolOnly
    ? `候选范围：仅使用自选币种池中的 ${scopedAssets.length} 个真实品种；分配为 0 的品种不会下单。`
    : '候选范围：当前市场筛选池；可开启“仅从自选币种池生成建议”收窄推荐范围。'
  const preferenceNote = settings.productPreference === 'spot'
    ? '产品倾向：计划仅执行现货；如存在对应永续合约，仍显示双向盘口分析供决策对照。'
    : settings.productPreference === 'swap'
      ? '产品倾向：仅分析永续合约，计划不会生成现货建议或现货应用指令。'
      : '产品倾向：现货与永续合约均可进入候选。'

  return {
    id: data.plan.generatedAt,
    name: `${preferenceLabel(settings.productPreference)}${data.plan.objectiveLabel || modeLabel(settings.objective)}实时组合`,
    budget: data.plan.budgetUsdt,
    lookbackPeriod: `${settings.lookbackDays}天`,
    riskLevel: settings.riskLevel <= 3 ? 'low' : settings.riskLevel >= 7 ? 'high' : 'medium',
    mode: settings.objective === 'growth' ? 'aggressive' : settings.objective,
    targetReturn: settings.targetReturn,
    maxDrawdown: settings.maxDrawdown,
    recommendations,
    orderPlan,
    confidence: data.plan.confidence,
    cashReserve: data.plan.cashReserve,
    notes: [preferenceNote, poolNote, scopeNote, ...(data.plan.notes || [])],
  }
}

export async function fetchFocusedRecommendation(settings: PlanSettings, asset: CryptoAsset, accountSource: AccountSource = 'test', accountId = 'default', directionAsset?: CryptoAsset): Promise<AIRecommendation> {
  const data = await request<{ plan: RawInvestmentPlan }>('/analyze', {
    method: 'POST',
    body: JSON.stringify({ ...settings, symbols: asset.instId }),
  })
  const candidate = data.plan.assets[0] || {
    symbol: asset.instId,
    last: asset.price,
    score: 0,
    targetPct: 0,
    reason: '指标样本不足，暂以观察为主。',
  }
  let contract: [ContractPlan, ContractPlan] | null = null
  const derivativeAsset = asset.instType === 'SWAP' ? asset : directionAsset
  let directionNotice: string | undefined
  if (derivativeAsset?.instType === 'SWAP') {
    const capitalBudget = settings.budgetUsdt * settings.maxAssetWeight / 100
    contract = await fetchContractPair(derivativeAsset, settings.riskLevel, 15000, accountSource, accountId, capitalBudget)
  } else {
    directionNotice = '该币种当前没有对应的 USDT 永续合约，现货只能给出买入/观望判断，无法生成可执行做空方案。'
  }
  return mapRecommendation(candidate, asset, contract, data.plan.confidence, derivativeAsset, directionNotice)
}

async function fetchContractPair(asset: CryptoAsset, riskLevel: number, timeoutMs: number, accountSource: AccountSource, accountId: string, capitalBudget: number): Promise<[ContractPlan, ContractPlan]> {
  const riskPct = Math.min(Math.max(riskLevel / 5, 0.5), 2)
  const path = `/contract/pair?instId=${encodeURIComponent(asset.instId)}&riskPct=${riskPct}&maxLeverage=${asset.maxLeverage || 1}&accountSource=${encodeURIComponent(accountSource)}&accountId=${encodeURIComponent(accountId)}&capitalBudget=${capitalBudget}`
  try {
    const data = await request<{ plans: { long: ContractPlan; short: ContractPlan } }>(path, { signal: AbortSignal.timeout(timeoutMs) })
    return [data.plans.long, data.plans.short]
  } catch {
    await new Promise((resolve) => window.setTimeout(resolve, 280))
    const data = await request<{ plans: { long: ContractPlan; short: ContractPlan } }>(path, { signal: AbortSignal.timeout(timeoutMs) })
    return [data.plans.long, data.plans.short]
  }
}

function mapRecommendation(asset: RawPlanAsset, sourceAsset: CryptoAsset | undefined, contract: [ContractPlan, ContractPlan] | null, confidence: number, directionAsset?: CryptoAsset, directionNotice?: string): AIRecommendation {
  if (contract) {
    const long = mapDirection(contract[0], false)
    const short = mapDirection(contract[1], false)
    const preferredSide = directionScore(long) >= directionScore(short) ? 'long' : 'short'
    const preferred = preferredSide === 'long' ? long : short
    long.recommended = preferredSide === 'long'
    short.recommended = preferredSide === 'short'
    if (sourceAsset?.instType !== 'SWAP') {
      return {
        instId: sourceAsset?.instId || asset.symbol,
        symbol: sourceAsset?.symbol || asset.symbol.split('-')[0],
        action: Number(asset.weight || 0) > 0 ? 'buy' : 'watch',
        type: 'spot',
        side: Number(asset.weight || 0) > 0 ? 'long' : 'neutral',
        confidence: Math.min(Math.max(Number(asset.score || 0), 0.05), 0.96),
        suggestedPosition: Number(asset.targetPct || 0),
        allocationUsdt: Number(asset.valueUsdt || 0),
        estimatedEntryFee: Number(asset.estimatedEntryFee || 0),
        feeRate: Number(asset.feeRate || 0),
        feeSource: asset.feeSource,
        takeProfit: Number(asset.last || 0) * 1.08,
        stopLoss: Number(asset.last || 0) * 0.94,
        preferredSide,
        directionInstrumentId: directionAsset?.instId || contract[0].instId,
        directionReferenceOnly: true,
        directions: { long, short },
        reasoning: `现货执行判断：${asset.reason || '当前仅观察。'} 对应永续双向参考更偏向${preferredSide === 'long' ? '做多' : '做空'}。`,
      }
    }
    return {
      instId: sourceAsset?.instId || asset.symbol,
      symbol: sourceAsset?.symbol || asset.symbol.split('-')[0],
      action: preferred.action,
      type: 'perpetual',
      side: preferredSide,
      confidence: Math.min(Math.max((Number(asset.score || 0) + confidence / 100) / 2, 0.05), 0.96),
      suggestedPosition: Number(asset.targetPct || 0),
      allocationUsdt: Number(asset.valueUsdt || 0),
      leverage: preferred.leverage,
      maxLeverage: preferred.maxLeverage,
      takeProfit: preferred.takeProfit,
      stopLoss: preferred.stopLoss,
      orderQuantity: preferred.contracts,
      notionalUsd: preferred.notionalUsd,
      marginRequired: preferred.marginRequired,
      capitalRequired: preferred.capitalRequired,
      weeklyFundingCost: preferred.weeklyFundingCost,
      estimatedEntryFee: preferred.estimatedEntryFee,
      estimatedSevenDayCost: preferred.estimatedSevenDayCost,
      feeRate: contract[0].recommendation.feeRate,
      feeSource: contract[0].recommendation.feeSource,
      preferredSide,
      directionInstrumentId: directionAsset?.instId || sourceAsset?.instId,
      directions: { long, short },
      reasoning: `更偏向${preferredSide === 'long' ? '做多' : '做空'}：${preferred.reasoning} ${asset.reason || ''}`.trim(),
    }
  }
  if (sourceAsset?.instType === 'SWAP') {
    return {
      instId: sourceAsset.instId,
      symbol: sourceAsset.symbol,
      action: 'watch',
      type: 'perpetual',
      side: 'neutral',
      confidence: Math.min(Math.max(Number(asset.score || 0), 0.05), 0.96),
      suggestedPosition: 0,
      allocationUsdt: Number(asset.valueUsdt || 0),
      maxLeverage: sourceAsset.maxLeverage,
      takeProfit: 0,
      stopLoss: 0,
      directionNotice,
      reasoning: `真实永续合约，最大可用杠杆 ${sourceAsset.maxLeverage || 1}x；风险数据暂未完成，暂不建议开仓。`,
    }
  }
  return {
    instId: sourceAsset?.instId || asset.symbol,
    symbol: sourceAsset?.symbol || asset.symbol.split('-')[0],
    action: Number(asset.weight || 0) > 0 ? 'buy' : 'watch',
    type: 'spot',
    side: Number(asset.weight || 0) > 0 ? 'long' : 'neutral',
    confidence: Math.min(Math.max(Number(asset.score || 0), 0.05), 0.96),
    suggestedPosition: Number(asset.targetPct || 0),
    allocationUsdt: Number(asset.valueUsdt || 0),
    estimatedEntryFee: Number(asset.estimatedEntryFee || 0),
    feeRate: Number(asset.feeRate || 0),
    feeSource: asset.feeSource,
    takeProfit: Number(asset.last || 0) * 1.08,
    stopLoss: Number(asset.last || 0) * 0.94,
    directionNotice,
    reasoning: asset.reason || '当前仅观察，不满足计划入场阈值。',
  }
}

function findDirectionAsset(asset: CryptoAsset, assets: CryptoAsset[]) {
  return asset.instType === 'SWAP'
    ? asset
    : assets.find((candidate) => candidate.instType === 'SWAP' && candidate.symbol === asset.symbol)
}

function mapDirection(contract: ContractPlan, recommended: boolean): AIDirection {
  const rec = contract.recommendation
  return {
    side: contract.side,
    recommended,
    action: rec.timing.state === 'enter' ? (contract.side === 'short' ? 'sell' : 'buy') : 'watch',
    leverage: rec.leverage,
    maxLeverage: rec.exchangeMaxLeverage,
    takeProfit: rec.target1,
    stopLoss: rec.stop,
    contracts: rec.contracts,
    notionalUsd: rec.notional,
    marginRequired: rec.marginRequired,
    capitalRequired: rec.capitalRequired,
    weeklyFundingCost: rec.weeklyFundingCost,
    estimatedEntryFee: rec.estimatedEntryFee,
    estimatedSevenDayCost: rec.estimatedSevenDayCost,
    riskScore: rec.riskScore,
    timingLabel: rec.timing.label,
    reasoning: `${rec.timing.label}：${rec.timing.reason} ${rec.timing.exitHint}`.trim(),
    marketFlow: contract.market?.orderFlow || undefined,
  }
}

function directionScore(direction: AIDirection) {
  const timing = direction.action === 'watch' ? 0 : 100
  const marketFlow = direction.marketFlow
  const effectiveFlowSide = !marketFlow
    ? 'neutral'
    : marketFlow.direction !== 'neutral'
      ? marketFlow.direction
      : Math.abs(marketFlow.deltaRatio) >= 0.65
        ? marketFlow.deltaRatio > 0 ? 'long' : 'short'
        : 'neutral'
  const flowStrength = !marketFlow
    ? 0
    : marketFlow.direction !== 'neutral'
      ? marketFlow.confidence
      : Math.min(Math.abs(marketFlow.deltaRatio) * 50, 50)
  const flowAlignment = effectiveFlowSide === 'neutral'
    ? 0
    : effectiveFlowSide === direction.side
      ? flowStrength * 0.35
      : -flowStrength * 0.35
  return timing + flowAlignment - direction.riskScore - Math.max(direction.estimatedSevenDayCost, 0) / Math.max(direction.marginRequired, 1) * 10
}

export async function setAutomation(enabled: boolean, settings: PlanSettings, accountId: string, symbols: string[]): Promise<AutomationState> {
  const data = await request<{ autopilot: AutomationState }>('/autopilot', {
    method: 'POST',
    body: JSON.stringify({
      enabled,
      intervalSeconds: 30,
      executionMode: 'auto',
      dryRun: false,
      accountId,
      settings: { ...settings, symbols: symbols.join(',') },
    }),
  })
  return data.autopilot
}

export async function applyTestPlan(orders: TradeOrder[], submit: boolean, accountSource: AccountSource, accountId: string) {
  const maxRequiredCapital = orders.reduce((max, order) => Math.max(max, Number(order.requiredCapitalUsdt || order.quoteValueUsdt || 0)), 0)
  return request<{ execution: { dryRun: boolean; skipped: boolean; results: unknown[] } }>('/execute', {
    method: 'POST',
    body: JSON.stringify({
      orders,
      dryRun: !submit,
      confirmation: submit ? 'APPLY_TEST' : '',
      maxOrderUsdt: Math.max(500, maxRequiredCapital),
      accountSource,
      accountId,
    }),
  })
}

export async function adjustTestPosition(
  asset: CryptoAsset,
  recommendation: AIRecommendation,
  action: 'add' | 'reduce' | 'close',
  notionalUsd: number,
  accountId: string,
): Promise<AccountSummary> {
  const data = await request<{ account: RawAccountSummary }>('/test-account/position', {
    method: 'POST',
    body: JSON.stringify({
      instId: asset.instId,
      instType: asset.instType,
      action,
      side: recommendation.side === 'short' ? 'short' : 'long',
      leverage: recommendation.leverage || 1,
      notionalUsd,
      accountId,
    }),
  })
  return mapAccount(data.account)
}

export async function resetTestAccount(initialEquityUsdt: number, accountId: string): Promise<AccountSummary> {
  const data = await request<{ account: RawAccountSummary }>('/test-account/reset', {
    method: 'POST',
    body: JSON.stringify({ initialEquityUsdt, accountId }),
  })
  return mapAccount(data.account)
}

export async function createTestAccount(label: string, initialEquityUsdt: number): Promise<{ account: AccountSummary; overview: AccountsOverview }> {
  const data = await request<{ account: RawAccountSummary; overview: RawAccountsOverview }>('/test-accounts', {
    method: 'POST',
    body: JSON.stringify({ label, initialEquityUsdt }),
  })
  return {
    account: mapAccount(data.account),
    overview: {
      ...data.overview,
      accounts: data.overview.accounts.map((entry) => ({
        ...entry,
        account: entry.account ? mapAccount(entry.account) : undefined,
      })),
    },
  }
}

export async function deleteTestAccount(accountId: string): Promise<AccountsOverview> {
  const data = await request<{ overview: RawAccountsOverview }>(
    `/test-accounts/${encodeURIComponent(accountId)}`,
    { method: 'DELETE' },
  )
  return {
    ...data.overview,
    accounts: data.overview.accounts.map((entry) => ({
      ...entry,
      account: entry.account ? mapAccount(entry.account) : undefined,
    })),
  }
}

export async function runAutomationNow(accountId: string): Promise<AutomationState> {
  const data = await request<{ autopilot: AutomationState }>('/autopilot/run', { method: 'POST', body: JSON.stringify({ accountId }) })
  return data.autopilot
}

function modeLabel(mode: PlanSettings['objective']) {
  if (mode === 'defensive') return '防守'
  if (mode === 'growth') return '进攻'
  return '均衡'
}

function preferenceLabel(preference: PlanSettings['productPreference']) {
  if (preference === 'spot') return '现货'
  if (preference === 'swap') return '合约'
  return '综合'
}
