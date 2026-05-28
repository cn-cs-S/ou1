export interface CryptoAsset {
  id: string
  instId: string
  instType: 'SPOT' | 'SWAP'
  symbol: string
  name: string
  price: number
  change24h: number
  volume24h: number
  aiScore: number
  reason?: string
  tags?: string[]
  high24h?: number
  low24h?: number
  isSelected?: boolean
  isNew?: boolean
  ageDays?: number | null
  maxLeverage?: number
  contractValue?: number
}

export interface Position {
  id: string
  instId: string
  symbol: string
  side: 'long' | 'short'
  type: 'spot' | 'perpetual'
  entryPrice: number
  markPrice: number
  size: number
  leverage: number
  notionalUsd?: number
  margin?: number
  marginMode?: string
  maintenanceMarginRatePct?: number
  maintenanceMarginRatioPct?: number
  maintenanceMarginUsd?: number
  fundingFee?: number
  fundingRate?: number
  pnl: number
  pnlPercent: number
  liquidationPrice: number
  breakEvenPrice: number
  aiSuggestion: string
  valuationLabel?: string
  entryLabel?: string
  liquidationLabel?: string
  valuationWarning?: string
  isTestPosition?: boolean
}

export interface AIRecommendation {
  instId: string
  symbol: string
  action: 'buy' | 'sell' | 'hold' | 'watch'
  type: 'spot' | 'perpetual'
  side: 'long' | 'short' | 'neutral'
  confidence: number
  suggestedPosition: number
  leverage?: number
  maxLeverage?: number
  takeProfit: number
  stopLoss: number
  reasoning: string
  allocationUsdt?: number
  estimatedEntryFee?: number
  feeRate?: number
  feeSource?: string
  orderQuantity?: number
  notionalUsd?: number
  marginRequired?: number
  capitalRequired?: number
  weeklyFundingCost?: number
  estimatedSevenDayCost?: number
  preferredSide?: 'long' | 'short'
  directionInstrumentId?: string
  directionReferenceOnly?: boolean
  directionNotice?: string
  directions?: {
    long: AIDirection
    short: AIDirection
  }
}

export interface AIDirection {
  side: 'long' | 'short'
  recommended: boolean
  action: 'buy' | 'sell' | 'watch'
  leverage: number
  maxLeverage: number
  takeProfit: number
  stopLoss: number
  contracts: number
  notionalUsd: number
  marginRequired: number
  capitalRequired: number
  weeklyFundingCost: number
  estimatedEntryFee: number
  estimatedSevenDayCost: number
  riskScore: number
  timingLabel: string
  reasoning: string
  marketFlow?: MarketFlowReference
}

export interface MarketFlowReference {
  score: number
  direction: 'long' | 'short' | 'neutral'
  label: string
  confidence: number
  aiJudgment: string
  aiConfidence: number
  aiBias: 'long' | 'short' | 'neutral'
  aiLevel: 'low' | 'medium' | 'high'
  aiVerdict: string
  aiReasons: string[]
  bookImbalance: number
  deltaRatio: number
  relativeVolume: number
  openInterestChangePct: number
  openInterestSamples: number
  openInterestAnomaly: 'rising' | 'none'
  summary: string
  caveat: string
}

export interface MarketAlert {
  id: string
  instId: string
  symbol: string
  side: 'long' | 'short' | 'neutral'
  severity: 'medium' | 'high'
  title: string
  detail: string
  classification: string
  confidence: number
  verdict: string
  flow: MarketFlowReference
  score: number
  createdAt: number
}

export interface AIPlan {
  id: string
  name: string
  budget: number
  lookbackPeriod: string
  riskLevel: 'low' | 'medium' | 'high'
  mode: 'defensive' | 'balanced' | 'aggressive'
  targetReturn: number
  maxDrawdown: number
  recommendations: AIRecommendation[]
  orderPlan: TradeOrder[]
  confidence: number
  cashReserve: number
  notes: string[]
}

export interface CandleData {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TradeOrder {
  instId: string
  instType?: 'SPOT' | 'SWAP'
  side: 'buy' | 'sell'
  positionSide?: 'long' | 'short'
  action?: 'add' | 'reduce' | 'close'
  leverage?: number
  contracts?: number
  requiredCapitalUsdt?: number
  estimatedFee?: number
  weeklyFundingCost?: number
  quoteValueUsdt: number
  sz: string
  reason?: string
}

export interface IndicatorItem {
  name: string
  value: number | null
  action: string
}

export interface IndicatorPack {
  oscillators: IndicatorItem[]
  movingAverages: IndicatorItem[]
  summary: {
    buy: number
    sell: number
    neutral: number
    action: string
    score: number
  }
}

export type AccountSource = 'test' | 'live-readonly'

export interface AccountSummary {
  accountSource: AccountSource
  accountId?: string
  accountLabel: string
  totalEqUsd: number
  exchangeTotalEqUsd?: number
  initialEquityUsdt?: number
  realizedPnl?: number
  availableUsdt: number
  totalUpl: number
  uplRatio: number
  usedMargin: number
  marginUsagePct: number
  valuationSource?: string
  valuationNotice?: string
  positions: Position[]
  hedge?: {
    active: boolean
    severity: string
    text: string
  }
}

export interface AccountOverviewEntry {
  id: string
  source: AccountSource
  label: string
  status: 'connected' | 'not-configured' | 'unavailable'
  writable: boolean
  automation?: AutomationState | null
  message?: string
  account?: AccountSummary
}

export interface AccountsOverview {
  defaultSource: AccountSource
  defaultAccountId: string
  marketSource: string
  accounts: AccountOverviewEntry[]
}

export interface AccountOperationRecord {
  id: string
  ts: string
  accountId: string
  accountLabel?: string
  source: 'ai' | 'manual' | 'system'
  ai?: boolean
  event: string
  instId?: string
  instType?: string
  action?: string
  operation?: string
  status?: string
  reason?: string
  dryRun?: boolean
  referencePrice?: number | null
  notionalUsd?: number | null
  executionFee?: number | null
  realizedPnl?: number | null
  message?: string
}

export interface AccountDetailSnapshot extends AccountsOverview {
  operations: AccountOperationRecord[]
}

export interface AutomationState {
  enabled: boolean
  intervalSeconds: number
  intervalMinutes: number
  executionMode: 'analysis' | 'semi' | 'auto'
  dryRun: boolean
  accountId?: string
  running: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  lastResult?: {
    executed: number
    actions?: Array<{
      instId: string
      action: string
      operation?: string
      status: string
      reason: string
    }>
  } | null
}

export interface PlanSettings {
  budgetUsdt: number
  lookbackDays: number
  objective: 'defensive' | 'balanced' | 'growth'
  riskLevel: number
  maxAssetWeight: number
  minOrderUsdt: number
  targetReturn: number
  maxDrawdown: number
  excludeNewCoins: boolean
  productPreference: 'both' | 'spot' | 'swap'
  favoritePoolOnly: boolean
  manageExistingPositions: boolean
  allowNewPositions: boolean
  allowPositionIncrease: boolean
  maxActionsPerCycle: number
}

export const initialAsset: CryptoAsset = {
  id: 'BTC-USDT',
  instId: 'BTC-USDT',
  instType: 'SPOT',
  symbol: 'BTC',
  name: 'Bitcoin',
  price: 0,
  change24h: 0,
  volume24h: 0,
  aiScore: 0,
  maxLeverage: 1,
}

export const emptyPlan: AIPlan = {
  id: 'pending',
  name: '等待生成计划',
  budget: 0,
  lookbackPeriod: '--',
  riskLevel: 'medium',
  mode: 'balanced',
  targetReturn: 0,
  maxDrawdown: 0,
  recommendations: [],
  orderPlan: [],
  confidence: 0,
  cashReserve: 1,
  notes: [],
}

export const timeframes = [
  { label: '1分', value: '1m' },
  { label: '5分', value: '5m' },
  { label: '15分', value: '15m' },
  { label: '30分', value: '30m' },
  { label: '1时', value: '1H' },
  { label: '4时', value: '4H' },
  { label: '1天', value: '1D' },
]
