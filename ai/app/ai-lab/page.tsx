'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, BrainCircuit, CheckCircle2, FlaskConical, Gauge, GitCompare, KeyRound, Loader2, RefreshCcw, Save, ShieldAlert, Sparkles, Split, WalletCards } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { AssetSearchSelect } from '@/components/trading/asset-search-select'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice } from '@/lib/format'
import {
  compareDecisionEngines,
  defaultPlanSettings,
  fetchAccountsOverview,
  fetchAssets,
  fetchLlmConfig,
  saveLlmConfig,
  testLlmConnection,
} from '@/lib/trading-api'
import type { AccountOverviewEntry, AccountsOverview, CryptoAsset, DecisionComparison, EngineDecision, LlmConfig, PlanSettings } from '@/lib/mock-data'

const DECISION_MODES = [
  { value: 'skills', label: '只用 Skills' },
  { value: 'tradingagents', label: '只用 TradingAgents' },
  { value: 'hybrid', label: '混合参考' },
] as const

export default function AiLabPage() {
  const [config, setConfig] = useState<LlmConfig | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [accounts, setAccounts] = useState<AccountsOverview | null>(null)
  const [assets, setAssets] = useState<CryptoAsset[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('default')
  const [selectedInstId, setSelectedInstId] = useState('BTC-USDT')
  const [settings, setSettings] = useState<PlanSettings>({ ...defaultPlanSettings, decisionEngine: 'hybrid', tradingAgentsWeight: 50 })
  const [comparison, setComparison] = useState<DecisionComparison | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [running, setRunning] = useState(false)

  const selectedAccount = useMemo(() => {
    const list = accounts?.accounts || []
    return list.find((entry) => entry.id === selectedAccountId) || list[0] || null
  }, [accounts, selectedAccountId])

  const shownAssets = useMemo(() => {
    const preferred = assets.filter((asset) => (
      settings.productPreference === 'spot' ? asset.instType === 'SPOT'
        : settings.productPreference === 'swap' ? asset.instType === 'SWAP'
          : true
    ))
    return preferred.slice(0, 180)
  }, [assets, settings.productPreference])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextAccounts, nextAssets] = await Promise.all([
        fetchLlmConfig(),
        fetchAccountsOverview(),
        fetchAssets(),
      ])
      setConfig(nextConfig)
      setAccounts(nextAccounts)
      setAssets(nextAssets)
      const firstAccount = nextAccounts.accounts[0]
      if (firstAccount) setSelectedAccountId(firstAccount.id)
      const firstAsset = nextAssets.find((asset) => asset.instId === selectedInstId) || nextAssets[0]
      if (firstAsset) setSelectedInstId(firstAsset.instId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 对比实验室加载失败')
    } finally {
      setLoading(false)
    }
  }, [selectedInstId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedAccount?.account) return
    const available = Math.max(Number(selectedAccount.account.availableUsdt || 0), 0)
    setSettings((current) => ({ ...current, budgetUsdt: available || current.budgetUsdt }))
  }, [selectedAccount?.id, selectedAccount?.account?.availableUsdt])

  async function saveConfig() {
    if (!config) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const next = await saveLlmConfig({
        provider: config.provider,
        enabled: config.enabled,
        model: config.model || (config.provider === 'zhipu' ? 'glm-4.7-flash' : 'openrouter/free'),
        baseUrl: config.baseUrl || (config.provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' : 'https://openrouter.ai/api/v1'),
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        fallbackModels: config.fallbackModels,
        thinkingType: config.thinkingType,
        apiKey: apiKey.trim() || undefined,
      })
      setConfig(next)
      setApiKey('')
      setNotice('LLM 配置已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存 LLM 配置失败')
    } finally {
      setSaving(false)
    }
  }

  async function runConnectionTest() {
    setTesting(true)
    setError('')
    setNotice('')
    try {
      const result = await testLlmConnection()
      setConfig(result.config)
      setNotice(`连接成功：${result.test.model}，${result.test.latencyMs}ms`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LLM 连接测试失败')
    } finally {
      setTesting(false)
    }
  }

  async function runComparison() {
    setRunning(true)
    setError('')
    setNotice('')
    try {
      const nextSettings = {
        ...settings,
        forceTradingAgents: Boolean(config?.enabled),
      }
      const result = await compareDecisionEngines({
        instId: selectedInstId,
        settings: nextSettings,
        accountSource: selectedAccount?.source || 'test',
        accountId: selectedAccount?.id || 'default',
      })
      setComparison(result)
      setNotice(`对比完成：当前采用 ${modeLabel(result.mode)}，结论为 ${actionText(result.selected.action)} / ${sideText(result.selected.side)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 对比测试失败')
    } finally {
      setRunning(false)
    }
  }

  function updateSetting<K extends keyof PlanSettings>(key: K, value: PlanSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回交易终端" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <FlaskConical className="h-4 w-4 text-primary" />
                AI 对比实验室
              </h1>
              <p className="text-xs text-muted-foreground">Skills / TradingAgents / 混合权重</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { window.location.href = '/accounts' }}>
              <WalletCards className="h-3.5 w-3.5" />
              账户管理
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
        {(notice || error) && (
          <div className={cn('mt-3 rounded-md border px-3 py-2 text-xs', error ? 'border-loss/50 bg-loss/10 text-loss' : 'border-gain/50 bg-gain/10 text-gain')}>
            {error || notice}
          </div>
        )}
      </header>

      <div className="grid gap-3 p-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-primary" />
                免费 LLM / GLM
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={cn(config?.configured ? 'border-gain text-gain' : 'border-warning text-warning')}>
                  {config?.configured ? `Key ${config.keySource}` : '未配置 Key'}
                </Badge>
                <Badge variant="outline" className={cn(config?.enabled ? 'border-primary text-primary' : 'border-muted-foreground text-muted-foreground')}>
                  {config?.enabled ? '复核开启' : '复核关闭'}
                </Badge>
                <Badge variant="outline">{config?.provider === 'zhipu' ? 'Zhipu GLM' : 'OpenRouter'}</Badge>
              </div>

              <label className="block text-xs text-muted-foreground">
                提供商
                <Select
                  value={config?.provider || 'zhipu'}
                  onValueChange={(value) => setConfig((current) => current ? {
                    ...current,
                    provider: value as LlmConfig['provider'],
                    model: value === 'zhipu' ? 'glm-4.7-flash' : 'openrouter/free',
                    baseUrl: value === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4' : 'https://openrouter.ai/api/v1',
                  } : current)}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zhipu">Zhipu GLM</SelectItem>
                    <SelectItem value="openrouter">OpenRouter</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <label className="block text-xs text-muted-foreground">
                API Key
                <Input
                  type="password"
                  value={apiKey}
                  placeholder={config?.maskedKey || (config?.provider === 'zhipu' ? '粘贴 ZHIPU API key' : '粘贴 OpenRouter API key')}
                  className="mt-1 h-8 text-xs"
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                模型
                <Input
                  value={config?.model || (config?.provider === 'zhipu' ? 'glm-4.7-flash' : 'openrouter/free')}
                  className="mt-1 h-8 font-mono text-xs"
                  onChange={(event) => setConfig((current) => current ? { ...current, model: event.target.value } : current)}
                />
              </label>

              <label className="block text-xs text-muted-foreground">
                Base URL
                <Input
                  value={config?.baseUrl || ''}
                  className="mt-1 h-8 font-mono text-xs"
                  onChange={(event) => setConfig((current) => current ? { ...current, baseUrl: event.target.value } : current)}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-muted-foreground">
                  温度
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={config?.temperature ?? 0.2}
                    className="mt-1 h-8 text-xs"
                    onChange={(event) => setConfig((current) => current ? { ...current, temperature: Number(event.target.value) } : current)}
                  />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Max tokens
                  <Input
                    type="number"
                    min={100}
                    max={4000}
                    value={config?.maxTokens ?? 900}
                    className="mt-1 h-8 text-xs"
                    onChange={(event) => setConfig((current) => current ? { ...current, maxTokens: Number(event.target.value) } : current)}
                  />
                </label>
              </div>

              {config?.provider === 'zhipu' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-muted-foreground">
                    备用模型
                    <Input
                      value={config?.fallbackModels || ''}
                      placeholder="glm-4.5-flash"
                      className="mt-1 h-8 font-mono text-xs"
                      onChange={(event) => setConfig((current) => current ? { ...current, fallbackModels: event.target.value } : current)}
                    />
                  </label>
                  <label className="block text-xs text-muted-foreground">
                    Thinking
                    <Select
                      value={config?.thinkingType || 'disabled'}
                      onValueChange={(value) => setConfig((current) => current ? { ...current, thinkingType: value as LlmConfig['thinkingType'] } : current)}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">disabled</SelectItem>
                        <SelectItem value="enabled">enabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              )}

              <label className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                <span>启用 TradingAgents 复核</span>
                <Switch
                  checked={Boolean(config?.enabled)}
                  onCheckedChange={(checked) => setConfig((current) => current ? { ...current, enabled: Boolean(checked) } : current)}
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!config || saving} onClick={() => void saveConfig()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存
                </Button>
                <Button size="sm" className="h-8 text-xs" disabled={testing || !config?.configured} onClick={() => void runConnectionTest()}>
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  测试
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                {config?.provider === 'zhipu'
                  ? 'GLM 会用于 TradingAgents 复核测试；生产自动化仍建议保留 Skills 风控和混合否决。'
                  : '免费路由适合低频测试；未充值账号通常限制较低，不建议用于高频自动化。'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="h-4 w-4 text-primary" />
                对比参数
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="block text-xs text-muted-foreground">
                账户
                <Select value={selectedAccount?.id || selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(accounts?.accounts || []).map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <label className="block text-xs text-muted-foreground">
                标的
                <AssetSearchSelect
                  assets={shownAssets}
                  value={selectedInstId}
                  onChange={setSelectedInstId}
                  disabled={loading}
                  className="mt-1"
                  placeholder="搜索标的"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <SettingSelect
                  label="决策模式"
                  value={settings.decisionEngine || 'hybrid'}
                  onChange={(value) => updateSetting('decisionEngine', value as PlanSettings['decisionEngine'])}
                  options={DECISION_MODES.map((item) => [item.value, item.label])}
                />
                <SettingSelect
                  label="产品倾向"
                  value={settings.productPreference}
                  onChange={(value) => updateSetting('productPreference', value as PlanSettings['productPreference'])}
                  options={[['both', '现货+合约'], ['spot', '只看现货'], ['swap', '只看合约']]}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <NumberInput label="风险" value={settings.riskLevel} min={1} max={10} onChange={(value) => updateSetting('riskLevel', value)} />
                <NumberInput label="最大杠杆" value={settings.maxLeverage || 5} min={1} max={50} onChange={(value) => updateSetting('maxLeverage', value)} />
                <NumberInput label="目标收益 %" value={settings.targetReturn} min={0.1} max={1000} onChange={(value) => updateSetting('targetReturn', value)} />
                <NumberInput label="最大回撤 %" value={settings.maxDrawdown} min={0.1} max={100} onChange={(value) => updateSetting('maxDrawdown', value)} />
              </div>

              <div className="rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span>TradingAgents 权重</span>
                  <span className="font-mono text-primary">{settings.tradingAgentsWeight ?? 50}%</span>
                </div>
                <Slider
                  value={[settings.tradingAgentsWeight ?? 50]}
                  min={0}
                  max={100}
                  step={5}
                  onValueChange={([value]) => updateSetting('tradingAgentsWeight', value)}
                />
                <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
                  <span>Skills 更高</span>
                  <span>TradingAgents 更高</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <MiniStat label="可用资金" value={`$${formatMoney(selectedAccount?.account?.availableUsdt || 0)}`} />
                <MiniStat label="持仓" value={`${selectedAccount?.account?.positions.length || 0}`} />
              </div>

              <Button className="h-9 w-full text-xs" disabled={running || loading} onClick={() => void runComparison()}>
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />}
                运行对比测试
              </Button>
            </CardContent>
          </Card>
        </aside>

        <section className="min-w-0 space-y-3">
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-semibold">当前结论</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {comparison ? `${comparison.instId} · ${modeLabel(comparison.mode)} · ${comparison.generatedAt}` : '尚未运行对比'}
                </p>
              </div>
              {comparison ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={actionClass(comparison.selected.action)}>{actionText(comparison.selected.action)}</Badge>
                  <Badge variant="outline" className={sideClass(comparison.selected.side)}>{sideText(comparison.selected.side)}</Badge>
                  <Badge variant="outline">置信度 {comparison.selected.confidence}%</Badge>
                  <Badge variant="outline">评分 {comparison.selected.score}</Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-3 xl:grid-cols-3">
            <DecisionCard icon={<Sparkles className="h-4 w-4 text-primary" />} title="只用 Skills" decision={comparison?.engines.skills || null} active={comparison?.mode === 'skills'} />
            <DecisionCard icon={<BrainCircuit className="h-4 w-4 text-primary" />} title="只用 TradingAgents" decision={comparison?.engines.tradingAgents || null} active={comparison?.mode === 'tradingagents'} />
            <DecisionCard icon={<Split className="h-4 w-4 text-primary" />} title="混合权重" decision={comparison?.engines.hybrid || null} active={comparison?.mode === 'hybrid'} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldAlert className="h-4 w-4 text-warning" />
                风险与记录
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {(comparison?.notes || ['运行对比后这里会展示冲突、否决和回退信息。']).map((item, index) => (
                <div key={`${item}-${index}`} className="rounded-md border border-border bg-muted/20 px-3 py-2 text-muted-foreground">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  )
}

function DecisionCard({ icon, title, decision, active }: { icon: ReactNode; title: string; decision: EngineDecision | null; active: boolean }) {
  return (
    <Card className={cn(active && 'border-primary/60 bg-primary/5')}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">{icon}{title}</span>
          {active && <Badge className="bg-primary/20 text-primary">采用</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {decision ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={actionClass(decision.action)}>{actionText(decision.action)}</Badge>
              <Badge variant="outline" className={sideClass(decision.side)}>{sideText(decision.side)}</Badge>
              <Badge variant="outline">{productText(decision.product)}</Badge>
              {!decision.available && <Badge variant="outline" className="border-warning text-warning">不可用</Badge>}
              {decision.veto && <Badge variant="outline" className="border-loss text-loss">否决</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <MiniStat label="评分" value={`${decision.score}`} />
              <MiniStat label="置信度" value={`${decision.confidence}%`} />
              <MiniStat label="目标仓位" value={`${decision.targetPct.toFixed(2)}%`} />
              <MiniStat label="投入" value={`$${formatMoney(decision.allocationUsdt)}`} />
              <MiniStat label="止盈" value={decision.takeProfit ? `$${formatPrice(decision.takeProfit)}` : '--'} tone="text-gain" />
              <MiniStat label="止损" value={decision.stopLoss ? `$${formatPrice(decision.stopLoss)}` : '--'} tone="text-loss" />
            </div>
            {decision.weight && (
              <p className="rounded-md bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                Skills {decision.weight.skills}% / TradingAgents {decision.weight.tradingAgents}%
              </p>
            )}
            {decision.model && (
              <p className="rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                {decision.model} · {decision.latencyMs || 0}ms
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">{decision.summary}</p>
            <Separator />
            <div className="space-y-1.5">
              {decision.reasons.slice(0, 4).map((item, index) => (
                <p key={`${item}-${index}`} className="text-[11px] text-muted-foreground">• {item}</p>
              ))}
            </div>
            <div className="space-y-1.5 rounded-md border border-border bg-background/40 p-2">
              {decision.riskNotes.slice(0, 3).map((item, index) => (
                <p key={`${item}-${index}`} className="text-[11px] text-warning">• {item}</p>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-dashed border-border px-3 py-10 text-center text-xs text-muted-foreground">
            等待对比结果
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SettingSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        className="mt-1 h-8 text-xs"
        onChange={(event) => onChange(Number(event.target.value) || min)}
      />
    </label>
  )
}

function MiniStat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-background/45 px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 truncate font-mono text-xs', tone)}>{value}</p>
    </div>
  )
}

function modeLabel(value: string) {
  if (value === 'skills') return '只用 Skills'
  if (value === 'tradingagents') return '只用 TradingAgents'
  return '混合权重'
}

function actionText(value: string) {
  return value === 'buy' ? '买入/做多'
    : value === 'sell' ? '卖出/做空'
      : value === 'hold' ? '持有'
        : '观察'
}

function sideText(value: string) {
  return value === 'long' ? '做多'
    : value === 'short' ? '做空'
      : '中性'
}

function productText(value: string) {
  return value === 'spot' ? '现货'
    : value === 'swap' ? '合约'
      : '现货+合约'
}

function actionClass(value: string) {
  return value === 'buy' ? 'bg-gain/20 text-gain'
    : value === 'sell' ? 'bg-loss/20 text-loss'
      : value === 'hold' ? 'bg-primary/20 text-primary'
        : 'bg-muted text-muted-foreground'
}

function sideClass(value: string) {
  return value === 'long' ? 'border-gain text-gain'
    : value === 'short' ? 'border-loss text-loss'
      : 'border-muted-foreground text-muted-foreground'
}
