'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { MarketSidebar } from '@/components/trading/market-sidebar'
import { CandlestickChart } from '@/components/trading/candlestick-chart'
import { AIDecisionPanel } from '@/components/trading/ai-decision-panel'
import { PositionsTable } from '@/components/trading/positions-table'
import { TechnicalIndicators } from '@/components/trading/technical-indicators'
import { TradingHeader } from '@/components/trading/trading-header'
import { AccountOverviewDialog } from '@/components/trading/account-overview-dialog'
import {
  adjustTestPosition,
  applyTestPlan,
  createTestAccount,
  defaultPlanSettings,
  deleteTestAccount,
  fetchAccount,
  fetchAccountsOverview,
  fetchAutomation,
  fetchAssets,
  fetchChart,
  fetchFocusedRecommendation,
  fetchHealth,
  fetchMarketFlow,
  fetchSkillStatus,
  generateInvestmentPlan,
  resetTestAccount,
  runAutomationNow,
  setAutomation,
  type ChartSnapshot,
  type SkillStatus,
  type TerminalHealth,
} from '@/lib/trading-api'
import {
  emptyPlan,
  initialAsset,
  type AccountSummary,
  type AccountOverviewEntry,
  type AccountsOverview,
  type AccountSource,
  type AIPlan,
  type AIRecommendation,
  type AutomationState,
  type CryptoAsset,
  type MarketAlert,
  type MarketFlowReference,
  type PlanSettings,
} from '@/lib/mock-data'

export default function TradingTerminal() {
  const [assets, setAssets] = useState<CryptoAsset[]>([])
  const [selectedInstId, setSelectedInstId] = useState(initialAsset.instId)
  const [detailHeight, setDetailHeight] = useState(180)
  const [isChartCollapsed, setIsChartCollapsed] = useState(false)
  const [bar, setBar] = useState('15m')
  const [chart, setChart] = useState<ChartSnapshot>({ candles: [], indicators: null, stats: {} })
  const [account, setAccount] = useState<AccountSummary | null>(null)
  const [accountsOverview, setAccountsOverview] = useState<AccountsOverview | null>(null)
  const [selectedAccountSource, setSelectedAccountSource] = useState<AccountSource>('test')
  const [selectedAccountId, setSelectedAccountId] = useState('default')
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [health, setHealth] = useState<TerminalHealth | null>(null)
  const [skills, setSkills] = useState<SkillStatus | null>(null)
  const [automation, setAutomationState] = useState<AutomationState | null>(null)
  const [settings, setSettings] = useState<PlanSettings>(defaultPlanSettings)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState<AIPlan>(emptyPlan)
  const [focusedRecommendation, setFocusedRecommendation] = useState<AIRecommendation | null>(null)
  const [marketAlerts, setMarketAlerts] = useState<MarketAlert[]>([])
  const [loadingChart, setLoadingChart] = useState(false)
  const [loadingFocused, setLoadingFocused] = useState(false)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [syncError, setSyncError] = useState('')
  const [chartError, setChartError] = useState('')
  const [actionError, setActionError] = useState('')
  const [focusedError, setFocusedError] = useState('')
  const focusedRequestRef = useRef(0)
  const alertGateRef = useRef<Map<string, { signature: string; at: number }>>(new Map())

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.instId === selectedInstId) || assets[0] || initialAsset,
    [assets, selectedInstId],
  )

  const monitoredSwapAssets = useMemo(() => {
    const ordered = [
      directionAssetFor(selectedAsset, assets),
      ...assets.filter((asset) => favoriteIds.has(asset.id)).map((asset) => directionAssetFor(asset, assets)),
      ...plan.recommendations.map((recommendation) => directionAssetFor(
        assets.find((asset) => asset.instId === recommendation.instId) || assets.find((asset) => asset.symbol === recommendation.symbol) || initialAsset,
        assets,
      )),
    ].filter((asset): asset is CryptoAsset => Boolean(asset))
    return ordered.filter((asset, index) => ordered.findIndex((candidate) => candidate.instId === asset.instId) === index).slice(0, 8)
  }, [assets, favoriteIds, plan.recommendations, selectedAsset])

  useEffect(() => {
    const saved = window.localStorage.getItem('okx-ai-favorites')
    if (saved) {
      try {
        setFavoriteIds(new Set(JSON.parse(saved) as string[]))
      } catch {
        window.localStorage.removeItem('okx-ai-favorites')
      }
    }
  }, [])

  const refreshTerminal = useCallback(async () => {
    const [healthResult, skillsResult, assetsResult, accountResult, automationResult] = await Promise.allSettled([
      fetchHealth(),
      fetchSkillStatus(),
      fetchAssets(),
      fetchAccount(selectedAccountSource, selectedAccountId),
      selectedAccountSource === 'test' ? fetchAutomation(selectedAccountId) : Promise.resolve(null),
    ])
    const failures: string[] = []
    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value)
    } else failures.push(`状态: ${requestMessage(healthResult.reason)}`)
    if (skillsResult.status === 'fulfilled') setSkills(skillsResult.value)
    else failures.push(`Skills: ${requestMessage(skillsResult.reason)}`)
    if (accountResult.status === 'fulfilled') setAccount(accountResult.value)
    else failures.push(`账户: ${requestMessage(accountResult.reason)}`)
    if (automationResult.status === 'fulfilled') setAutomationState(automationResult.value)
    else failures.push(`自动化: ${requestMessage(automationResult.reason)}`)
    if (assetsResult.status === 'fulfilled') {
      const nextAssets = assetsResult.value
      setAssets(nextAssets)
      setSelectedInstId((current) => (
        nextAssets.some((asset) => asset.instId === current) ? current : nextAssets[0]?.instId || initialAsset.instId
      ))
    } else failures.push(`币种: ${requestMessage(assetsResult.reason)}`)
    setSyncError(failures.join('；'))
    return {
      assets: assetsResult.status === 'fulfilled' ? assetsResult.value : [],
      account: accountResult.status === 'fulfilled' ? accountResult.value : null,
    }
  }, [selectedAccountId, selectedAccountSource])

  const buildPlan = useCallback(async (nextSettings = settings, sourceAssets = assets, source = selectedAccountSource, accountId = selectedAccountId, budgetAccount = account) => {
    const effectiveSettings = withAvailableBudget(nextSettings, budgetAccount)
    const scanAssets = effectiveSettings.favoritePoolOnly
      ? sourceAssets.filter((asset) => favoriteIds.has(asset.id))
      : sourceAssets
    if (!scanAssets.length) {
      setActionError('自选币种池为空，请先在左侧收藏币种，或关闭仅从自选生成。')
      return
    }
    setLoadingPlan(true)
    setActionError('')
    try {
      const orderedAssets = [
        ...(scanAssets.some((asset) => asset.instId === selectedAsset.instId) ? [selectedAsset] : []),
        ...scanAssets.filter((asset) => asset.instId !== selectedAsset.instId),
      ]
      const nextPlan = await generateInvestmentPlan(effectiveSettings, orderedAssets, source, accountId, assets)
      setPlan(nextPlan)
      if (source === 'test' && automation?.enabled && automation.accountId === accountId) {
        const symbols = automationSymbols(effectiveSettings, sourceAssets, favoriteIds)
        setAutomationState(await setAutomation(true, effectiveSettings, accountId, symbols))
      }
      setNotice(`组合已更新，当前置信度 ${nextPlan.confidence}%`)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '生成组合失败')
    } finally {
      setLoadingPlan(false)
    }
  }, [account, assets, automation, favoriteIds, selectedAsset, selectedAccountId, selectedAccountSource, settings])

  const refreshFocused = useCallback(async (asset = selectedAsset, nextSettings = settings, source = selectedAccountSource, accountId = selectedAccountId, budgetAccount = account) => {
    if (!asset.instId) return
    const effectiveSettings = withAvailableBudget(nextSettings, budgetAccount)
    const requestId = ++focusedRequestRef.current
    setLoadingFocused(true)
    setFocusedError('')
    try {
      let recommendation: AIRecommendation
      try {
        recommendation = await fetchFocusedRecommendation(effectiveSettings, asset, source, accountId, directionAssetFor(asset, assets))
      } catch (firstError) {
        if (requestId !== focusedRequestRef.current) return
        await new Promise((resolve) => window.setTimeout(resolve, 240))
        if (requestId !== focusedRequestRef.current) return
        try {
          recommendation = await fetchFocusedRecommendation(effectiveSettings, asset, source, accountId, directionAssetFor(asset, assets))
        } catch {
          throw firstError
        }
      }
      if (requestId !== focusedRequestRef.current) return
      setFocusedRecommendation(recommendation)
      setFocusedError('')
    } catch (requestError) {
      if (requestId !== focusedRequestRef.current) return
      setFocusedError('当前币种建议暂时不可用，系统会在下一轮自动重试')
      setFocusedRecommendation((current) => current?.instId === asset.instId ? current : null)
    } finally {
      if (requestId === focusedRequestRef.current) setLoadingFocused(false)
    }
  }, [account, assets, selectedAccountId, selectedAccountSource, selectedAsset, settings])

  const recordMarketAlert = useCallback((asset: CryptoAsset, flow: MarketFlowReference) => {
    const alert = buildMarketAlert(asset, flow)
    const previous = alertGateRef.current.get(asset.instId)
    if (!alert) {
      alertGateRef.current.delete(asset.instId)
      return
    }
    const signature = `${alert.side}:${alert.severity}:${Math.round(alert.score / 10)}`
    if (previous && previous.signature === signature && Date.now() - previous.at < 10 * 60 * 1000) return
    alertGateRef.current.set(asset.instId, { signature, at: Date.now() })
    setMarketAlerts((current) => [alert, ...current.filter((item) => item.instId !== alert.instId)].slice(0, 8))
    toast.warning(alert.title, { description: `${asset.instId} · AI 置信度 ${alert.confidence}% · ${alert.verdict}` })
  }, [])

  const scanMarketAlerts = useCallback(async () => {
    const samples = await Promise.allSettled(monitoredSwapAssets.map(async (asset) => ({
      asset,
      flow: await fetchMarketFlow(asset.instId),
    })))
    samples.forEach((sample) => {
      if (sample.status === 'fulfilled') recordMarketAlert(sample.value.asset, sample.value.flow)
    })
  }, [monitoredSwapAssets, recordMarketAlert])

  const refreshAccountsOverview = useCallback(async () => {
    setLoadingAccounts(true)
    try {
      const overview = await fetchAccountsOverview()
      setAccountsOverview(overview)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '账户总览读取失败')
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function boot() {
      try {
        const snapshot = await refreshTerminal()
        if (!active) return
        const nextAssets = snapshot.assets
        const startupSettings = withAvailableBudget(defaultPlanSettings, snapshot.account)
        const initialSelection = nextAssets[0] || initialAsset
        setSettings(startupSettings)
        setSelectedInstId(initialSelection.instId)
        if (nextAssets.length) {
          setLoadingPlan(true)
          const nextPlan = await generateInvestmentPlan(startupSettings, nextAssets, selectedAccountSource, selectedAccountId, nextAssets)
          if (active) setPlan(nextPlan)
        }
      } catch (requestError) {
        if (active) setSyncError(requestError instanceof Error ? requestError.message : '无法连接交易服务')
      } finally {
        if (active) setLoadingPlan(false)
      }
    }
    void boot()
    const timer = window.setInterval(() => {
      void refreshTerminal().catch((requestError) => {
        setSyncError(requestError instanceof Error ? requestError.message : '实时同步失败')
      })
    }, 15000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [refreshTerminal, selectedAccountId, selectedAccountSource])

  useEffect(() => {
    if (!account) return
    setSettings((current) => {
      const next = withAvailableBudget(current, account)
      return next.budgetUsdt === current.budgetUsdt ? current : next
    })
  }, [account])

  useEffect(() => {
    let active = true
    async function refreshChart() {
      setLoadingChart(true)
      try {
        const nextChart = await fetchChart(selectedAsset.instId, bar)
        if (active) {
          setChart(nextChart)
          setChartError('')
        }
      } catch (requestError) {
        if (active) setChartError(requestError instanceof Error ? requestError.message : 'K 线同步失败')
      } finally {
        if (active) setLoadingChart(false)
      }
    }
    void refreshChart()
    const timer = window.setInterval(() => void refreshChart(), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [bar, selectedAsset.instId])

  useEffect(() => {
    void refreshFocused()
    const timer = window.setInterval(() => void refreshFocused(), 15000)
    return () => {
      focusedRequestRef.current += 1
      window.clearInterval(timer)
    }
  }, [refreshFocused])

  useEffect(() => {
    if (!monitoredSwapAssets.length) return
    void scanMarketAlerts()
    const timer = window.setInterval(() => void scanMarketAlerts(), 15000)
    return () => window.clearInterval(timer)
  }, [monitoredSwapAssets.length, scanMarketAlerts])

  useEffect(() => {
    if (!accountDialogOpen) return
    void refreshAccountsOverview()
    const timer = window.setInterval(() => void refreshAccountsOverview(), 15000)
    return () => window.clearInterval(timer)
  }, [accountDialogOpen, refreshAccountsOverview])

  async function toggleAutomation(enabled: boolean, target?: AccountOverviewEntry) {
    const targetSource = target?.source || selectedAccountSource
    const targetId = target?.id || selectedAccountId
    if (enabled && targetSource !== 'test') {
      setActionError('自动化操作只能应用于本地测试账户，真实账户目前保持只读。')
      return
    }
    setActionPending(true)
    setActionError('')
    try {
      const targetAccount = targetId === selectedAccountId && targetSource === selectedAccountSource
        ? account
        : await fetchAccount(targetSource, targetId)
      const effectiveSettings = withAvailableBudget(settings, targetAccount)
      const symbols = automationSymbols(effectiveSettings, assets, favoriteIds)
      let nextState = await setAutomation(enabled, effectiveSettings, targetId, symbols)
      if (enabled) {
        nextState = await runAutomationNow(targetId)
        if (targetId === selectedAccountId && targetSource === selectedAccountSource) {
          setAccount(await fetchAccount('test', targetId))
        }
      }
      if (targetId === selectedAccountId && targetSource === selectedAccountSource) setAutomationState(nextState)
      if (accountDialogOpen) await refreshAccountsOverview()
      setNotice(enabled
        ? `${targetAccount?.accountLabel || '所选测试账户'}已开启自动化接管：每 15 秒评估买入、卖出、做多、做空、加减仓或平仓`
        : `${targetAccount?.accountLabel || '所选测试账户'}自动化操作已关闭`)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '自动化设置失败')
    } finally {
      setActionPending(false)
    }
  }

  async function runExecution(submit: boolean) {
    setActionPending(true)
    setActionError('')
    try {
      const result = await applyTestPlan(plan.orderPlan, submit, selectedAccountSource, selectedAccountId)
      const count = result.execution.results.length
      setNotice(submit ? `已将 ${count} 笔计划应用到本地测试账户` : `风险检查完成：${count} 笔计划可加入测试账户`)
      const snapshot = await refreshTerminal()
      if (accountDialogOpen) await refreshAccountsOverview()
      const effectiveSettings = withAvailableBudget(settings, snapshot.account || account)
      if (submit) await buildPlan(effectiveSettings, snapshot.assets.length ? snapshot.assets : assets, selectedAccountSource, selectedAccountId, snapshot.account || account)
      await refreshFocused(selectedAsset, effectiveSettings, selectedAccountSource, selectedAccountId, snapshot.account || account)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '测试账户操作失败')
    } finally {
      setActionPending(false)
    }
  }

  async function customizePosition(instId: string, action: 'add' | 'reduce' | 'close') {
    const asset = assets.find((item) => item.instId === instId)
    if (!asset) return
    setActionPending(true)
    setActionError('')
    try {
      const effectiveSettings = withAvailableBudget(settings, account)
      const recommendation = focusedRecommendation?.instId === instId
        ? focusedRecommendation
        : plan.recommendations.find((item) => item.instId === instId) || await fetchFocusedRecommendation(effectiveSettings, asset, selectedAccountSource, selectedAccountId, directionAssetFor(asset, assets))
      const suggestedPct = Math.max(recommendation.suggestedPosition || 0, 5)
      const intendedCapital = Math.max(effectiveSettings.minOrderUsdt, effectiveSettings.budgetUsdt * suggestedPct / 100)
      const notionalUsd = asset.instType === 'SWAP' && action === 'add'
        ? scaleContractNotional(recommendation, intendedCapital)
        : intendedCapital
      const nextAccount = await adjustTestPosition(asset, recommendation, action, notionalUsd, selectedAccountId)
      setAccount(nextAccount)
      if (accountDialogOpen) void refreshAccountsOverview()
      const label = action === 'add' ? '加仓/加入' : action === 'reduce' ? '减仓 25%' : '平仓/移除'
      setNotice(`${asset.instId} 已${label}，组合风险与当前建议正在重新计算`)
      const nextSettings = withAvailableBudget(settings, nextAccount)
      void Promise.all([buildPlan(nextSettings, assets, selectedAccountSource, selectedAccountId, nextAccount), refreshFocused(selectedAsset, nextSettings, selectedAccountSource, selectedAccountId, nextAccount)]).catch((requestError) => {
        setActionError(requestError instanceof Error ? requestError.message : '风险建议重算失败')
      })
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '调整测试持仓失败')
    } finally {
      setActionPending(false)
    }
  }

  async function resetAccount(initialEquityUsdt: number) {
    setActionPending(true)
    setActionError('')
    try {
      const nextAccount = await resetTestAccount(initialEquityUsdt, selectedAccountId)
      setAccount(nextAccount)
      if (accountDialogOpen) void refreshAccountsOverview()
      setNotice(`本地测试账户已重置为 ${initialEquityUsdt.toLocaleString()} USDT，风险建议正在刷新`)
      const nextSettings = withAvailableBudget(settings, nextAccount)
      void Promise.all([buildPlan(nextSettings, assets, selectedAccountSource, selectedAccountId, nextAccount), refreshFocused(selectedAsset, nextSettings, selectedAccountSource, selectedAccountId, nextAccount)]).catch((requestError) => {
        setActionError(requestError instanceof Error ? requestError.message : '风险建议重算失败')
      })
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '重置测试账户失败')
    } finally {
      setActionPending(false)
    }
  }

  async function selectAccount(entry: AccountOverviewEntry) {
    setActionPending(true)
    setActionError('')
    try {
      const nextAccount = await fetchAccount(entry.source, entry.id)
      setSelectedAccountSource(entry.source)
      setSelectedAccountId(entry.id)
      setAccount(nextAccount)
      setAutomationState(entry.source === 'test' ? (entry.automation || await fetchAutomation(entry.id)) : null)
      setNotice(`当前风险预算与持仓视图已切换至${nextAccount.accountLabel}`)
      const nextSettings = withAvailableBudget(settings, nextAccount)
      setSettings(nextSettings)
      void Promise.all([buildPlan(nextSettings, assets, entry.source, entry.id, nextAccount), refreshFocused(selectedAsset, nextSettings, entry.source, entry.id, nextAccount)])
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '账户切换失败')
    } finally {
      setActionPending(false)
    }
  }

  async function addTestAccount(label: string, initialEquityUsdt: number) {
    setActionPending(true)
    setActionError('')
    try {
      const created = await createTestAccount(label, initialEquityUsdt)
      const accountId = created.account.accountId || 'default'
      setAccountsOverview(created.overview)
      setSelectedAccountSource('test')
      setSelectedAccountId(accountId)
      setAccount(created.account)
      setNotice(`已新增并切换至 ${created.account.accountLabel}，可在该账户验证自动化策略`)
      const nextSettings = withAvailableBudget(settings, created.account)
      setSettings(nextSettings)
      void Promise.all([buildPlan(nextSettings, assets, 'test', accountId, created.account), refreshFocused(selectedAsset, nextSettings, 'test', accountId, created.account)])
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '新增测试账户失败')
    } finally {
      setActionPending(false)
    }
  }

  async function removeTestAccount(accountId: string) {
    setActionPending(true)
    setActionError('')
    try {
      setAccountsOverview(await deleteTestAccount(accountId))
      setNotice('测试账户已删除')
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '删除测试账户失败')
    } finally {
      setActionPending(false)
    }
  }

  async function runAutomation(target?: AccountOverviewEntry) {
    const targetSource = target?.source || selectedAccountSource
    const targetId = target?.id || selectedAccountId
    const targetAutomation = target?.automation || (targetId === selectedAccountId ? automation : null)
    if (targetSource !== 'test' || !targetAutomation?.enabled) return
    setActionPending(true)
    setActionError('')
    try {
      const nextState = await runAutomationNow(targetId)
      if (targetId === selectedAccountId) {
        setAutomationState(nextState)
        setAccount(await fetchAccount('test', targetId))
      }
      await refreshAccountsOverview()
      setNotice(`${target?.label || account?.accountLabel || '测试账户'}自动化已完成一次实时评估，持仓与风险状态已刷新`)
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : '自动化实时操作失败')
    } finally {
      setActionPending(false)
    }
  }

  function toggleFavorite(instId: string) {
    setFavoriteIds((current) => {
      const next = new Set(current)
      if (next.has(instId)) next.delete(instId)
      else next.add(instId)
      window.localStorage.setItem('okx-ai-favorites', JSON.stringify([...next]))
      return next
    })
  }

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <TradingHeader
        symbol={selectedAsset.symbol}
        instType={selectedAsset.instType}
        accountSource={account?.accountSource || health?.accountSource || 'test'}
        accountLabel={account?.accountLabel || health?.accountLabel || '本地测试账户'}
        isConnected={Boolean(health?.connected)}
        aiSkillsActive={Boolean(skills?.active)}
        equity={account?.totalEqUsd || 0}
        available={account?.availableUsdt || 0}
        pnl={account?.totalUpl || 0}
        realMarketValuation={Boolean(account?.valuationSource?.startsWith('live-public-market'))}
        onOpenAccounts={() => setAccountDialogOpen(true)}
      />

      <AccountOverviewDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        overview={accountsOverview}
        selectedSource={selectedAccountSource}
        selectedAccountId={selectedAccountId}
        automation={automation}
        loading={loadingAccounts}
        actionPending={actionPending}
        onRefresh={() => void refreshAccountsOverview()}
        onSelectAccount={(entry) => void selectAccount(entry)}
        onCreateTestAccount={(label, equity) => void addTestAccount(label, equity)}
        onDeleteTestAccount={(accountId) => void removeTestAccount(accountId)}
        onToggleAutomation={(enabled) => void toggleAutomation(enabled)}
        onRunAutomation={() => void runAutomation()}
        onToggleAccountAutomation={(entry, enabled) => void toggleAutomation(enabled, entry)}
        onRunAccountAutomation={(entry) => void runAutomation(entry)}
      />

      <div className="flex flex-1 items-start max-xl:flex-col max-xl:items-stretch">
        <aside className="w-[320px] shrink-0 self-start flex flex-col overflow-hidden xl:sticky xl:top-0 xl:h-[calc(100vh-3.5rem)] max-xl:w-full max-xl:h-[420px]">
          <MarketSidebar
            assets={assets}
            selectedAsset={selectedAsset}
            onSelectAsset={(asset) => setSelectedInstId(asset.instId)}
            detailHeight={detailHeight}
            onDetailHeightChange={setDetailHeight}
            chartStats={chart.stats}
            favorites={favoriteIds}
            onToggleFavorite={toggleFavorite}
          />
        </aside>

        <main className="flex-1 flex flex-col min-w-0 p-2 gap-2 max-xl:w-full">
          <div className={isChartCollapsed ? 'h-auto' : 'h-[clamp(360px,54vh,680px)]'}>
            <CandlestickChart
              symbol={selectedAsset.symbol}
              instType={selectedAsset.instType}
              candles={chart.candles}
              loading={loadingChart}
              activeTimeframe={bar}
              onTimeframeChange={setBar}
              isCollapsed={isChartCollapsed}
              onToggleCollapse={() => setIsChartCollapsed(!isChartCollapsed)}
              marketSource={chart.marketSource}
            />
          </div>

          <TechnicalIndicators
            symbol={selectedAsset.symbol}
            instType={selectedAsset.instType}
            indicators={chart.indicators}
            loading={loadingChart}
          />

          <PositionsTable
            positions={account?.positions || []}
            hedge={account?.hedge}
            accountSource={account?.accountSource || 'test'}
            automationEnabled={Boolean(automation?.enabled)}
            actionPending={actionPending}
            onAdjustPosition={(instId, action) => void customizePosition(instId, action)}
          />
        </main>

        <aside className="w-[380px] shrink-0 self-start max-xl:w-full">
          <AIDecisionPanel
            currentInstId={selectedAsset.instId}
            currentRecommendation={focusedRecommendation}
            alerts={marketAlerts}
            monitoredCount={monitoredSwapAssets.length}
            onDismissAlert={(id) => setMarketAlerts((current) => current.filter((item) => item.id !== id))}
            loadingFocused={loadingFocused}
            recommendations={plan.recommendations}
            plan={plan}
            settings={settings}
            onSettingsChange={setSettings}
            availableFunds={account?.availableUsdt || 0}
            assets={assets}
            favorites={favoriteIds}
            onToggleFavorite={toggleFavorite}
            favoriteCount={favoriteIds.size}
            onGeneratePlan={() => void buildPlan()}
            loadingPlan={loadingPlan}
            autoTrading={Boolean(automation?.enabled)}
            onToggleAutomation={(enabled) => void toggleAutomation(enabled)}
            onDryRun={() => void runExecution(false)}
            onExecute={() => void runExecution(true)}
            accountSource={account?.accountSource || 'test'}
            initialEquity={account?.initialEquityUsdt || 100000}
            onResetAccount={(initialEquity) => void resetAccount(initialEquity)}
            actionPending={actionPending}
            notice={notice}
            error={actionError || focusedError || syncError || chartError}
          />
        </aside>
      </div>
    </div>
  )
}

function requestMessage(value: unknown) {
  return value instanceof Error ? value.message : '请求失败'
}

function withAvailableBudget(settings: PlanSettings, account: AccountSummary | null) {
  if (!account) return settings
  const available = Math.max(Number(account.availableUsdt || 0), 0)
  return settings.budgetUsdt !== available ? { ...settings, budgetUsdt: available } : settings
}

function scaleContractNotional(recommendation: AIRecommendation, intendedCapital: number) {
  const modelNotional = Number(recommendation.notionalUsd || 0)
  const modelCapital = Number(recommendation.capitalRequired || 0)
  if (modelNotional > 0 && modelCapital > 0) {
    return modelNotional * intendedCapital / modelCapital
  }
  const leverage = Math.max(Number(recommendation.leverage || 1), 1)
  return intendedCapital * leverage
}

function directionAssetFor(asset: CryptoAsset, assets: CryptoAsset[]) {
  return asset.instType === 'SWAP'
    ? asset
    : assets.find((candidate) => candidate.instType === 'SWAP' && candidate.symbol === asset.symbol)
}

function buildMarketAlert(asset: CryptoAsset, flow: MarketFlowReference): MarketAlert | null {
  const significant = flow.aiLevel === 'high' || (flow.aiLevel === 'medium' && flow.aiConfidence >= 72)
  if (!significant || flow.aiJudgment === '暂无明显主力布局') return null
  const side = flow.aiBias
  const title = `${flow.aiJudgment} · ${asset.symbol}`
  return {
    id: `${asset.instId}-${Date.now()}`,
    instId: asset.instId,
    symbol: asset.symbol,
    side,
    severity: flow.aiLevel === 'high' ? 'high' : 'medium',
    title,
    detail: flow.summary,
    classification: flow.aiJudgment,
    confidence: flow.aiConfidence,
    verdict: flow.aiVerdict,
    flow,
    score: flow.score,
    createdAt: Date.now(),
  }
}

function automationSymbols(settings: PlanSettings, assets: CryptoAsset[], favoriteIds: Set<string>) {
  const scoped = settings.favoritePoolOnly
    ? assets.filter((asset) => favoriteIds.has(asset.id))
    : assets
  return scoped
    .filter((asset) => settings.productPreference === 'spot' ? asset.instType === 'SPOT' : settings.productPreference === 'swap' ? asset.instType === 'SWAP' : true)
    .filter((asset) => !settings.excludeNewCoins || !asset.isNew)
    .slice(0, 8)
    .map((asset) => asset.instId)
}
