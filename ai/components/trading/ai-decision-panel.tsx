'use client'

import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BellRing,
  Brain,
  ChevronDown,
  ChevronUp,
  Eye,
  Play,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Star,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice } from '@/lib/format'
import type { AIDirection, AIRecommendation, AIPlan, CryptoAsset, MarketAlert, PlanSettings } from '@/lib/mock-data'

interface AIDecisionPanelProps {
  currentInstId: string
  currentRecommendation: AIRecommendation | null
  alerts: MarketAlert[]
  monitoredCount: number
  onDismissAlert: (id: string) => void
  loadingFocused: boolean
  recommendations: AIRecommendation[]
  plan: AIPlan
  settings: PlanSettings
  onSettingsChange: (settings: PlanSettings) => void
  availableFunds: number
  assets: CryptoAsset[]
  favorites: Set<string>
  onToggleFavorite: (instId: string) => void
  favoriteCount: number
  onGeneratePlan: () => void
  loadingPlan: boolean
  autoTrading: boolean
  onToggleAutomation: (enabled: boolean) => void
  onDryRun: () => void
  onExecute: () => void
  accountSource: 'test' | 'live-readonly'
  initialEquity: number
  onResetAccount: (initialEquity: number) => void
  actionPending: boolean
  notice: string
  error: string
}

export function AIDecisionPanel({
  currentInstId,
  currentRecommendation,
  alerts,
  monitoredCount,
  onDismissAlert,
  loadingFocused,
  recommendations,
  plan,
  settings,
  onSettingsChange,
  availableFunds,
  assets,
  favorites,
  onToggleFavorite,
  favoriteCount,
  onGeneratePlan,
  loadingPlan,
  autoTrading,
  onToggleAutomation,
  onDryRun,
  onExecute,
  accountSource,
  initialEquity,
  onResetAccount,
  actionPending,
  notice,
  error,
}: AIDecisionPanelProps) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())
  const [isPlanExpanded, setIsPlanExpanded] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [testEquity, setTestEquity] = useState(initialEquity)
  const [poolSearch, setPoolSearch] = useState('')
  const liveRecommendation = currentRecommendation?.instId === currentInstId ? currentRecommendation : null
  const poolAssets = assets.filter((asset) => favorites.has(asset.id))
  const matchingPoolAssets = poolSearch.trim()
    ? assets.filter((asset) => {
      const query = poolSearch.trim().toUpperCase()
      return asset.instId.includes(query) || asset.symbol.includes(query)
    }).slice(0, 8)
    : []

  function toggleCardExpansion(symbol: string) {
    setExpandedCards((current) => {
      const next = new Set(current)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  function setNumeric(key: keyof PlanSettings, value: string) {
    const number = Number(value)
    if (Number.isFinite(number)) onSettingsChange({ ...settings, [key]: number })
  }

  return (
    <div className="border-l border-border bg-sidebar">
        <div className="p-3 space-y-3">
          <MarketAlertFeed alerts={alerts} monitoredCount={monitoredCount} onDismiss={onDismissAlert} />

          <div className="p-3 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-primary/20">
                  <Brain className="h-4 w-4 text-primary" />
                </div>
                <span className="font-semibold text-sm">AI 实时建议</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">自动化操作</span>
                <Switch
                  checked={autoTrading}
                  disabled={actionPending || (accountSource !== 'test' && !autoTrading)}
                  onCheckedChange={onToggleAutomation}
                  className="scale-75"
                  aria-label="开启自动化操作"
                />
              </div>
            </div>

            {liveRecommendation ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-[10px]', actionColor(liveRecommendation.action))}>
                    {actionText(liveRecommendation.action)}
                  </Badge>
                  <span className="flex items-center gap-1 text-xs">
                    {sideIcon(liveRecommendation.side)}
                    {sideText(liveRecommendation.side)}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {liveRecommendation.type === 'spot' ? '现货' : '永续'}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    信心度 <span className={confidenceColor(liveRecommendation.confidence)}>
                      {(liveRecommendation.confidence * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{liveRecommendation.reasoning}</p>
                {liveRecommendation.directions && <DirectionComparison recommendation={liveRecommendation} />}
                {liveRecommendation.directionNotice && <DirectionNotice text={liveRecommendation.directionNotice} />}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
                  <Metric label="建议仓位" value={`${liveRecommendation.suggestedPosition.toFixed(2)}%`} />
                  <Metric label="止盈" value={`$${formatPrice(liveRecommendation.takeProfit)}`} tone="text-gain" />
                  <Metric label="止损" value={`$${formatPrice(liveRecommendation.stopLoss)}`} tone="text-loss" />
                </div>
                {liveRecommendation.leverage && (
                  <div className="flex items-center justify-center gap-1 pt-2 text-xs">
                    <span className="text-muted-foreground">建议杠杆:</span>
                    <span className="font-mono font-medium text-warning">{liveRecommendation.leverage}x</span>
                    {liveRecommendation.maxLeverage && (
                      <span className="text-muted-foreground">/ 可用上限 {liveRecommendation.maxLeverage}x</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                {loadingFocused ? '正在根据当前真实行情生成该币种建议...' : '当前币种建议暂不可用，请稍后重试'}
              </p>
            )}
          </div>

          {(notice || error) && (
            <div className={cn(
              'px-3 py-2 rounded-md border text-[11px]',
              error ? 'border-loss/50 bg-loss text-loss' : 'border-gain bg-gain text-gain',
            )}>
              {error || notice}
            </div>
          )}

          <Collapsible open={isPlanExpanded} onOpenChange={setIsPlanExpanded}>
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm">AI 组合计划</span>
                </div>
                {isPlanExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 p-3 rounded-lg bg-card border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{plan.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => setShowSettings(!showSettings)}
                  >
                    <Settings2 className="h-3 w-3" />
                    设置
                  </Button>
                </div>

                {showSettings && (
                  <div className="grid grid-cols-2 gap-2 p-2 rounded bg-muted/30 text-[10px]">
                    <div className="col-span-2 rounded bg-background/40 px-2 py-1.5">
                      <span className="text-muted-foreground">计划资金来源</span>
                      <p className="mt-1 font-mono text-xs text-foreground">账户可用资金 ${formatMoney(availableFunds)}</p>
                      <p className="mt-1 text-muted-foreground">AI 仅在可用资金范围内决定实际投入与备用现金。</p>
                    </div>
                    <SettingInput label="回看天数" value={settings.lookbackDays} onChange={(value) => setNumeric('lookbackDays', value)} />
                    <label className="space-y-1">
                      <span className="text-muted-foreground">模式</span>
                      <Select
                        value={settings.objective}
                        onValueChange={(value) => onSettingsChange({ ...settings, objective: value as PlanSettings['objective'] })}
                      >
                        <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="defensive">防守</SelectItem>
                          <SelectItem value="balanced">均衡</SelectItem>
                          <SelectItem value="growth">进攻</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-muted-foreground">产品倾向</span>
                      <Select
                        value={settings.productPreference}
                        onValueChange={(value) => onSettingsChange({ ...settings, productPreference: value as PlanSettings['productPreference'] })}
                      >
                        <SelectTrigger size="sm" className="w-full text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="both">现货 + 合约</SelectItem>
                          <SelectItem value="spot">仅现货</SelectItem>
                          <SelectItem value="swap">仅合约</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <SettingInput label="风险 1-10" value={settings.riskLevel} onChange={(value) => setNumeric('riskLevel', value)} />
                    <SettingInput label="目标收益 %" value={settings.targetReturn} onChange={(value) => setNumeric('targetReturn', value)} />
                    <SettingInput label="最大回撤 %" value={settings.maxDrawdown} onChange={(value) => setNumeric('maxDrawdown', value)} />
                    <label className="col-span-2 flex items-center justify-between rounded bg-background/40 px-2 py-1.5">
                      <span className="text-muted-foreground">AI 排除上市不足 30 天的新币</span>
                      <Switch
                        checked={settings.excludeNewCoins}
                        onCheckedChange={(checked) => onSettingsChange({ ...settings, excludeNewCoins: checked })}
                        className="scale-75"
                        aria-label="AI 排除新币"
                      />
                    </label>
                    <label className="col-span-2 flex items-center justify-between rounded bg-background/40 px-2 py-1.5">
                      <span className="text-muted-foreground">自动管理已有仓位（含手动测试仓位）</span>
                      <Switch
                        checked={settings.manageExistingPositions}
                        onCheckedChange={(checked) => onSettingsChange({ ...settings, manageExistingPositions: checked })}
                        className="scale-75"
                        aria-label="自动管理已有仓位"
                      />
                    </label>
                    <label className="col-span-2 flex items-center justify-between rounded bg-background/40 px-2 py-1.5">
                      <span className="text-muted-foreground">允许 AI 自动开立新仓位</span>
                      <Switch
                        checked={settings.allowNewPositions}
                        onCheckedChange={(checked) => onSettingsChange({ ...settings, allowNewPositions: checked })}
                        className="scale-75"
                        aria-label="允许 AI 自动开立新仓位"
                      />
                    </label>
                    <label className="col-span-2 flex items-center justify-between rounded bg-background/40 px-2 py-1.5">
                      <span className="text-muted-foreground">允许已持仓方向确认后自动加仓</span>
                      <Switch
                        checked={settings.allowPositionIncrease}
                        onCheckedChange={(checked) => onSettingsChange({ ...settings, allowPositionIncrease: checked })}
                        className="scale-75"
                        aria-label="允许 AI 自动加仓"
                      />
                    </label>
                    <SettingInput label="每轮最多动作" value={settings.maxActionsPerCycle} onChange={(value) => setNumeric('maxActionsPerCycle', value)} />
                    {accountSource === 'test' && (
                      <div className="col-span-2 flex items-end gap-2 border-t border-border/50 pt-2">
                        <SettingInput label="测试初始资金 USDT" value={testEquity} onChange={(value) => setTestEquity(Number(value) || 0)} />
                        <Button
                          size="sm"
                          variant="outline"
                          className="mb-0.5 h-8 text-[10px]"
                          disabled={actionPending || testEquity <= 0}
                          onClick={() => onResetAccount(testEquity)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          重置账户
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Summary label="组合预算（可用资金）" value={`$${formatMoney(plan.id === 'pending' ? availableFunds : plan.budget)}`} icon={<Target className="h-3 w-3" />} />
                  <Summary label="回看周期" value={plan.lookbackPeriod} icon={<Eye className="h-3 w-3" />} />
                  <Summary label="风险等级" value={riskText(plan.riskLevel)} icon={<AlertTriangle className="h-3 w-3" />} tone={riskColor(plan.riskLevel)} />
                  <Summary label="模式" value={modeText(plan.mode)} icon={<Zap className="h-3 w-3" />} tone={modeColor(plan.mode)} />
                </div>

                <div className="grid grid-cols-3 pt-2 border-t border-border">
                  <Metric label="目标收益" value={`+${plan.targetReturn}%`} tone="text-gain" />
                  <Metric label="最大回撤" value={`-${plan.maxDrawdown}%`} tone="text-loss" />
                  <Metric label="现金保留" value={`${(plan.cashReserve * 100).toFixed(0)}%`} />
                </div>

                <Button className="w-full h-8 text-xs" disabled={loadingPlan || actionPending} onClick={onGeneratePlan}>
                  <Sparkles className="h-3.5 w-3.5" />
                  {loadingPlan ? '生成中...' : '按当前设置生成计划'}
                </Button>
                {plan.notes[0] && <p className="text-[10px] text-muted-foreground">{plan.notes[0]}</p>}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Star className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">自定义 AI 候选币池</span>
                <Badge variant="outline" className="h-5 text-[10px]">{favoriteCount} 个</Badge>
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                仅此币池
                <Switch
                  checked={settings.favoritePoolOnly}
                  onCheckedChange={(checked) => onSettingsChange({ ...settings, favoritePoolOnly: checked })}
                  className="scale-75"
                  aria-label="仅从自选币种池生成建议"
                />
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {settings.favoritePoolOnly ? '当前计划只分析本币池；修改后重新生成计划。' : '未限制推荐范围；加入币种后可切换为仅分析本币池。'}
            </p>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={poolSearch}
                onChange={(event) => setPoolSearch(event.target.value)}
                placeholder="搜索币种加入候选池..."
                className="h-8 pl-7 pr-7 text-xs"
              />
              {poolSearch && (
                <button
                  type="button"
                  aria-label="清除候选币种搜索"
                  onClick={() => setPoolSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {matchingPoolAssets.length > 0 && (
              <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-border bg-background/40 p-1">
                {matchingPoolAssets.map((asset) => (
                  <button
                    type="button"
                    key={asset.id}
                    disabled={favorites.has(asset.id)}
                    onClick={() => onToggleFavorite(asset.id)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-[10px] hover:bg-accent disabled:cursor-default disabled:opacity-60"
                  >
                    <span className="font-medium">{asset.instId}</span>
                    <span className={favorites.has(asset.id) ? 'text-muted-foreground' : 'text-gain'}>
                      {favorites.has(asset.id) ? '已加入' : '添加'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {poolAssets.length > 0 ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-border/70 bg-background/20 p-1">
                {poolAssets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between gap-2 rounded bg-primary/5 px-2 py-1">
                    <div className="min-w-0 text-[10px]">
                      <span className="font-medium text-foreground">{asset.instId}</span>
                      <span className="ml-1.5 text-muted-foreground">{asset.instType === 'SWAP' ? '永续' : '现货'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(asset.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-loss hover:bg-loss/10"
                      aria-label={`从 AI 候选币池删除 ${asset.instId}`}
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded bg-muted/30 px-2 py-1.5 text-[10px] text-muted-foreground">尚未指定候选币种，AI 当前按筛选范围扫描。</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">全币种建议</span>
              <span className="text-[10px] text-muted-foreground">{recommendations.length} 个候选</span>
            </div>
            {recommendations.map((recommendation) => (
              <Collapsible
                key={recommendation.instId}
                open={expandedCards.has(recommendation.instId)}
                onOpenChange={() => toggleCardExpansion(recommendation.instId)}
              >
                <div className={cn(
                  'rounded-lg border transition-colors',
                  recommendation.instId === currentInstId ? 'border-primary/50 bg-primary/5' : 'border-border bg-card',
                )}>
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between p-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{recommendation.symbol}</span>
                        <Badge className={cn('text-[10px] h-5', actionColor(recommendation.action))}>{actionText(recommendation.action)}</Badge>
                        {sideIcon(recommendation.side)}
                        <Badge variant="outline" className="text-[10px] h-5">{recommendation.type === 'spot' ? '现货' : '永续'}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {Number(recommendation.allocationUsdt || 0) > 0 ? `$${formatMoney(Number(recommendation.allocationUsdt))}` : '$0'}
                        </span>
                        <span className={cn('text-xs font-mono', confidenceColor(recommendation.confidence))}>
                          {(recommendation.confidence * 100).toFixed(0)}%
                        </span>
                        {expandedCards.has(recommendation.instId)
                          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{recommendation.reasoning}</p>
                      <div className="flex items-center justify-between rounded bg-muted/30 px-2 py-1.5 text-[10px]">
                        <span className="text-muted-foreground">目标投入</span>
                        <span className={cn('font-mono', Number(recommendation.allocationUsdt || 0) > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                          {Number(recommendation.allocationUsdt || 0) > 0
                            ? `$${formatMoney(Number(recommendation.allocationUsdt))}${recommendation.action === 'watch' ? ' / 等待入场' : ''}`
                            : '$0.00 / 不下单'}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                        <MiniMetric label="仓位" value={`${recommendation.suggestedPosition.toFixed(2)}%`} />
                        <MiniMetric label="杠杆" value={recommendation.leverage ? `${recommendation.leverage}x` : '-'} tone="text-warning" />
                        <MiniMetric label="止盈" value={`$${formatPrice(recommendation.takeProfit)}`} tone="text-gain" />
                        <MiniMetric label="止损" value={`$${formatPrice(recommendation.stopLoss)}`} tone="text-loss" />
                      </div>
                      {recommendation.directions && <DirectionComparison recommendation={recommendation} compact />}
                      {recommendation.directionNotice && <DirectionNotice text={recommendation.directionNotice} />}
                      {recommendation.type === 'spot' && Number(recommendation.allocationUsdt || 0) > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          预估开仓手续费 ${formatMoney(Number(recommendation.estimatedEntryFee || 0))} ({feeLabel(recommendation.feeSource)})
                        </p>
                      )}
                      {recommendation.maxLeverage && (
                        <p className="text-[10px] text-warning">交易所当前可用杠杆上限：{recommendation.maxLeverage}x</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>

          {accountSource === 'test' && plan.orderPlan.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/50 hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">本地测试 · {plan.orderPlan.length} 笔可执行计划</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 p-3 rounded-lg bg-card border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">执行面板</span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actionPending} onClick={onDryRun}>
                        风险检查
                      </Button>
                      <Button size="sm" className="h-7 text-xs gap-1" disabled={actionPending} onClick={onExecute}>
                        <Play className="h-3 w-3" />
                        应用到测试账户
                      </Button>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    此处仅改变本地测试账户，不向欧易发送订单；金额已计入开仓手续费，永续成本另含资金费率预估。
                  </p>
                  <div className="space-y-1.5">
                    {plan.orderPlan.map((order) => (
                      <div key={order.instId} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1.5 text-[10px]">
                        <span className="flex items-center gap-1.5">
                          <strong>{order.instId}</strong>
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">{order.instType === 'SWAP' ? '永续' : '现货'}</Badge>
                          {order.instType === 'SWAP' && <span className={order.positionSide === 'short' ? 'text-loss' : 'text-gain'}>{order.positionSide === 'short' ? '空' : '多'} {order.leverage}x</span>}
                        </span>
                        <span className="font-mono text-right">
                          {order.instType === 'SWAP'
                            ? `${order.contracts} 张 / 成本 $${formatMoney(Number(order.requiredCapitalUsdt || 0))}`
                            : `投入 $${formatMoney(order.quoteValueUsdt)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
    </div>
  )
}

function DirectionComparison({ recommendation, compact = false }: { recommendation: AIRecommendation; compact?: boolean }) {
  if (!recommendation.directions) return null
  const marketFlow = recommendation.directions.long.marketFlow || recommendation.directions.short.marketFlow
  return (
    <div className={cn('space-y-1.5 border-t border-border/50 pt-2', compact && 'text-[10px]')}>
      {recommendation.directionReferenceOnly && (
        <p className="rounded bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
          双向对照来自 {recommendation.directionInstrumentId}；当前计划仍按现货执行，不会建立做空仓位。
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        {([recommendation.directions.long, recommendation.directions.short] as AIDirection[]).map((direction) => (
          <div
            key={direction.side}
            className={cn(
              'rounded border px-2 py-1.5',
              direction.recommended
                ? direction.side === 'long' ? 'border-gain/60 bg-gain/10' : 'border-loss/60 bg-loss/10'
                : 'border-border bg-muted/20',
            )}
          >
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className={cn('font-medium', direction.side === 'long' ? 'text-gain' : 'text-loss')}>
                {direction.side === 'long' ? '做多' : '做空'}
              </span>
              {direction.recommended && <Badge className="h-4 bg-primary/20 px-1 text-[9px] text-primary">更推荐</Badge>}
            </div>
            <p className="text-muted-foreground">{direction.timingLabel} · {direction.leverage}x · {direction.contracts} 张</p>
            <p className="font-mono">保证金 ${formatMoney(direction.marginRequired)}</p>
            <p className="font-mono text-muted-foreground">7日资金费 {direction.weeklyFundingCost >= 0 ? '-' : '+'}${formatMoney(Math.abs(direction.weeklyFundingCost))}</p>
            {!compact && (
              <p className="mt-1 font-mono">
                <span className="text-gain">止盈 ${formatPrice(direction.takeProfit)}</span>
                <span className="ml-2 text-loss">止损 ${formatPrice(direction.stopLoss)}</span>
              </p>
            )}
          </div>
        ))}
      </div>
      {marketFlow && <FlowInsightCard flow={marketFlow} compact={compact} />}
    </div>
  )
}

function MarketAlertFeed({ alerts, monitoredCount, onDismiss }: { alerts: MarketAlert[]; monitoredCount: number; onDismiss: (id: string) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <BellRing className={cn('h-3.5 w-3.5', alerts.length ? 'text-warning' : 'text-muted-foreground')} />
          <span className="text-xs font-medium">AI 异动判读</span>
          {alerts.length > 0 && <Badge className="h-4 bg-warning/20 px-1 text-[9px] text-warning">{alerts.length}</Badge>}
        </div>
        <span className="text-[10px] text-muted-foreground">监控 {monitoredCount} 个永续标的</span>
      </div>
      {alerts.length ? (
        <div className="mt-2 space-y-1.5">
          {alerts.slice(0, 3).map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'rounded border px-2 py-1.5 text-[10px]',
                flowSurfaceClass(alert.side),
              )}
            >
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-label={`查看 ${alert.symbol} 异动指标明细`}
                  onClick={() => setExpandedId((current) => current === alert.id ? null : alert.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('flex items-center gap-1 font-medium', flowTextClass(alert.side))}>
                      {alert.classification}
                      <span className="font-mono text-[9px]">AI {alert.confidence}%</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-muted-foreground">
                      {new Date(alert.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                      {expandedId === alert.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{alert.symbol} · {alert.verdict}</p>
                </button>
                <button type="button" aria-label={`关闭 ${alert.symbol} 异动提醒`} onClick={() => onDismiss(alert.id)} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {expandedId === alert.id && <FlowMetrics flow={alert.flow} />}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-1.5 text-[10px] text-muted-foreground">当前未识别到高置信度异动布局；只有多项资金信号同向确认时才会提醒。</p>
      )}
      <p className="mt-1.5 text-[9px] text-muted-foreground">依据公开盘口、主动成交与 OI 代理判断，不能确认真实操盘主体。</p>
    </div>
  )
}

function FlowInsightCard({ flow, compact = false }: { flow: NonNullable<AIDirection['marketFlow']>; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const judgment = flow.aiJudgment || flow.label
  const confidence = Number.isFinite(flow.aiConfidence) ? flow.aiConfidence : flow.confidence
  const bias = flow.aiBias || flow.direction
  const displaySide = judgment === '暂无明显主力布局' ? 'neutral' : bias

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          aria-label="查看 AI 资金判读明细"
          className={cn('w-full rounded border px-2 py-1.5 text-left transition-colors hover:bg-muted/30', flowSurfaceClass(displaySide))}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="font-medium">AI 资金判读</span>
              <Badge variant="outline" className={cn('h-4 px-1 text-[9px]', flowTextClass(displaySide))}>{judgment}</Badge>
            </span>
            <span className={cn('flex shrink-0 items-center gap-1 font-mono', flowTextClass(displaySide))}>
              {confidence}% {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </span>
          </div>
          {!compact && <p className="mt-1 text-[10px] text-muted-foreground">{flow.aiVerdict || flow.label}</p>}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FlowMetrics flow={flow} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function FlowMetrics({ flow }: { flow: NonNullable<AIDirection['marketFlow']> }) {
  const oiValue = flow.openInterestSamples >= 2 ? formatSignedPercent(flow.openInterestChangePct) : '采样中'
  return (
    <div className="mt-1.5 space-y-1.5 rounded border border-border/60 bg-background/45 p-2 text-[10px]">
      <div className="grid grid-cols-2 gap-1.5">
        <FlowDatum label="盘口买卖比" value={flow.bookImbalance > 0 ? `${flow.bookImbalance.toFixed(2)}x` : '--'} meaning="大于 1 表示可见买方挂单更厚" />
        <FlowDatum label="主动成交 Delta" value={formatSignedPercent(flow.deltaRatio * 100)} meaning="正值代表主动买入占优" />
        <FlowDatum label="1H 量比" value={flow.relativeVolume > 0 ? `${flow.relativeVolume.toFixed(2)}x` : '--'} meaning="当前量相对近期均值" />
        <FlowDatum label="OI 变化" value={oiValue} meaning="持仓量扩张可能代表新资金进场" />
      </div>
      {!!flow.aiReasons?.length && (
        <p className="text-muted-foreground">
          依据：{flow.aiReasons.join('；')}
        </p>
      )}
      <p className="text-[9px] text-muted-foreground">{flow.caveat}</p>
    </div>
  )
}

function FlowDatum({ label, value, meaning }: { label: string; value: string; meaning: string }) {
  return (
    <div className="rounded bg-muted/30 px-1.5 py-1">
      <div className="flex items-center justify-between gap-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <p className="mt-0.5 text-[9px] text-muted-foreground">{meaning}</p>
    </div>
  )
}

function flowSurfaceClass(side: 'long' | 'short' | 'neutral') {
  if (side === 'long') return 'border-gain/40 bg-gain/5'
  if (side === 'short') return 'border-loss/40 bg-loss/5'
  return 'border-border bg-muted/20'
}

function flowTextClass(side: 'long' | 'short' | 'neutral') {
  if (side === 'long') return 'text-gain'
  if (side === 'short') return 'text-loss'
  return 'text-muted-foreground'
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function DirectionNotice({ text }: { text: string }) {
  return (
    <p className="rounded border border-border bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
      {text}
    </p>
  )
}

function feeLabel(source?: string) {
  return source === 'okx-account-rate' ? 'OKX 账户费率' : '默认费率估算'
}

function Metric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-mono font-medium', tone)}>{value}</p>
    </div>
  )
}

function MiniMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-1.5 rounded bg-muted/50 text-center">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn('font-mono font-medium', tone)}>{value}</p>
    </div>
  )
}

function Summary({ label, value, icon, tone = '' }: { label: string; value: string; icon: ReactNode; tone?: string }) {
  return (
    <div className="p-2 rounded bg-muted/50">
      <div className="flex items-center gap-1 text-muted-foreground mb-1">{icon}<span>{label}</span></div>
      <p className={cn('font-mono font-medium', tone)}>{value}</p>
    </div>
  )
}

function SettingInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-muted-foreground">{label}</span>
      <Input className="h-8 text-xs" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function actionColor(action: AIRecommendation['action']) {
  if (action === 'buy') return 'bg-gain text-gain border border-gain'
  if (action === 'sell') return 'bg-loss text-loss border border-loss'
  if (action === 'watch') return 'bg-warning/20 text-warning'
  return 'bg-muted text-foreground'
}

function actionText(action: AIRecommendation['action']) {
  if (action === 'buy') return '买入'
  if (action === 'sell') return '做空'
  if (action === 'hold') return '持有'
  return '观察'
}

function sideIcon(side: AIRecommendation['side']) {
  if (side === 'long') return <TrendingUp className="h-3 w-3 text-gain" />
  if (side === 'short') return <TrendingDown className="h-3 w-3 text-loss" />
  return <Eye className="h-3 w-3 text-muted-foreground" />
}

function sideText(side: AIRecommendation['side']) {
  if (side === 'long') return '做多'
  if (side === 'short') return '做空'
  return '观望'
}

function confidenceColor(confidence: number) {
  return cn('font-mono font-medium', confidence >= 0.8 ? 'text-gain' : confidence >= 0.6 ? 'text-warning' : 'text-loss')
}

function modeText(mode: AIPlan['mode']) {
  if (mode === 'defensive') return '防守'
  if (mode === 'aggressive') return '进攻'
  return '均衡'
}

function modeColor(mode: AIPlan['mode']) {
  if (mode === 'defensive') return 'text-blue-400'
  if (mode === 'aggressive') return 'text-red-400'
  return 'text-amber-400'
}

function riskText(level: AIPlan['riskLevel']) {
  if (level === 'low') return '低'
  if (level === 'high') return '高'
  return '中'
}

function riskColor(level: AIPlan['riskLevel']) {
  if (level === 'low') return 'text-gain'
  if (level === 'high') return 'text-loss'
  return 'text-warning'
}
