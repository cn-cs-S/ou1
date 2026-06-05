'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, ArrowLeft, Bot, CheckCircle2, Database, Gauge, Play, RefreshCcw, ShieldCheck, Sparkles, Wrench, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { AssetSearchSelect } from '@/components/trading/asset-search-select'
import {
  compareDecisionEngines,
  defaultPlanSettings,
  fetchAssets,
  fetchHealth,
  fetchSkillStatus,
  type SkillRegistryEntry,
  type SkillStatus,
  type TerminalHealth,
} from '@/lib/trading-api'
import type { CryptoAsset, DecisionComparison, EngineDecision } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice } from '@/lib/format'

const REVIEW_REFRESH_MS = 60_000

const SKILL_LABELS: Record<string, string> = {
  'kline-indicator': 'K 线与技术指标',
  'trading-plan-generator': '交易计划生成',
  'position-sizer': '仓位与强平估算',
  'market-intel': '市场叙事与异动',
  'okx-execution-vortex': '测试账户执行器',
  'okx-strategy-oracle': '策略复核',
  'recurring-dca': '周期定投',
  'okx-maker-entry': 'Maker 挂单入场',
  'okx-review': '交易复盘',
}

export default function SkillsLivePage() {
  const [skills, setSkills] = useState<SkillStatus | null>(null)
  const [health, setHealth] = useState<TerminalHealth | null>(null)
  const [assets, setAssets] = useState<CryptoAsset[]>([])
  const [selectedInstId, setSelectedInstId] = useState('BTC-USDT')
  const [comparison, setComparison] = useState<DecisionComparison | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState(false)
  const [error, setError] = useState('')
  const [reviewError, setReviewError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSkills, nextHealth, nextAssets] = await Promise.all([fetchSkillStatus(), fetchHealth(), fetchAssets()])
      setSkills(nextSkills)
      setHealth(nextHealth)
      setAssets(nextAssets)
      setSelectedInstId((current) => (
        nextAssets.some((asset) => asset.instId === current)
          ? current
          : nextAssets.find((asset) => asset.instId === 'BTC-USDT')?.instId || nextAssets[0]?.instId || 'BTC-USDT'
      ))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Skills 状态加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const runReview = useCallback(async () => {
    const instId = normalizeInstId(selectedInstId)
    setReviewing(true)
    setReviewError('')
    try {
      const result = await compareDecisionEngines({
        instId,
        accountSource: 'test',
        accountId: 'default',
        settings: {
          ...defaultPlanSettings,
          budgetUsdt: 1000,
          minConfidence: 55,
          decisionEngine: 'skills',
          forceTradingAgents: false,
          productPreference: instId.endsWith('-SWAP') ? 'swap' : 'both',
          symbols: [
            instId,
            'BTC-USDT',
            'ETH-USDT',
            'SOL-USDT',
            'BTC-USDT-SWAP',
            'ETH-USDT-SWAP',
          ].join(','),
        },
      })
      setComparison(result)
    } catch (runError) {
      setReviewError(runError instanceof Error ? runError.message : 'Skills 实时判断失败')
    } finally {
      setReviewing(false)
    }
  }, [selectedInstId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void runReview()
    const timer = window.setInterval(() => {
      if (!document.hidden) void runReview()
    }, REVIEW_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [runReview])

  const healthScore = useMemo(() => {
    if (!skills) return 0
    if (!skills.installed) return 0
    return Math.round(Math.min(skills.executable / Math.max(skills.installed, 1), 1) * 100)
  }, [skills])

  const decision = comparison?.selected || null
  const skillRows = skills?.skills || []

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回主页" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <Bot className="h-4 w-4 text-primary" />
                Skills 实时建议
              </h1>
              <p className="text-xs text-muted-foreground">只使用本地 Skills 规则层，不调用 TradingAgents LLM</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-60">
              <AssetSearchSelect
                assets={assets}
                value={selectedInstId}
                onChange={setSelectedInstId}
                disabled={loading}
                placeholder="搜索标的"
              />
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loading || reviewing} onClick={() => { void load(); void runReview() }}>
              <RefreshCcw className={cn('h-3.5 w-3.5', (loading || reviewing) && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
        {(error || reviewError) && (
          <div className="mt-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-xs text-loss">
            {error || reviewError}
          </div>
        )}
      </header>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-3">
          <Card className="border-primary/25 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Skills-only 总结推荐
                </span>
                {comparison && <Badge variant="outline" className="font-mono text-[10px]">{comparison.instId}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DecisionSummary decision={decision} reviewing={reviewing} />
              <div className="grid gap-2 md:grid-cols-4">
                <MiniState icon={<CheckCircle2 className="h-4 w-4 text-gain" />} label="可执行 Skills" value={`${skills?.executable ?? 0}`} />
                <MiniState icon={<Wrench className="h-4 w-4 text-primary" />} label="已安装 Skills" value={`${skills?.installed ?? 0}`} />
                <MiniState icon={<ShieldCheck className="h-4 w-4 text-warning" />} label="可写 Skills" value={`${skills?.writeEnabled ?? 0}`} />
                <MiniState icon={<Activity className="h-4 w-4 text-primary" />} label="自动化轮询" value={health?.automation?.enabled ? `${health.automation.intervalSeconds}s` : '未开启'} />
              </div>
            </CardContent>
          </Card>

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {skillRows.map((skill) => (
              <SkillCard key={skill.name} skill={skill} />
            ))}
            {!skillRows.length && (
              <Card className="md:col-span-2 xl:col-span-3">
                <CardContent className="p-10 text-center text-xs text-muted-foreground">
                  {loading ? '正在读取 Skills registry...' : '未发现 Skills registry 数据'}
                </CardContent>
              </Card>
            )}
          </section>
        </section>

        <aside className="space-y-3 xl:sticky xl:top-[76px] xl:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gauge className="h-4 w-4 text-primary" />
                运行健康度
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between">
                <span className="text-3xl font-semibold">{healthScore}%</span>
                <Badge variant="outline" className={healthScore >= 80 ? 'border-gain text-gain' : 'border-warning text-warning'}>
                  {healthScore >= 80 ? '可用' : '待检查'}
                </Badge>
              </div>
              <Progress value={healthScore} />
              <p className="text-xs leading-6 text-muted-foreground">
                健康度表示 Skills 是否安装并满足依赖；交易建议仍以行情、账户风险和执行边界共同判断。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4 text-primary" />
                当前运行链路
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <FlowRow icon={<Play className="h-3.5 w-3.5" />} title="行情读取" text="OKX live-public K 线、ticker、合约数据" />
              <FlowRow icon={<Gauge className="h-3.5 w-3.5" />} title="指标评分" text="RSI / MACD / BOLL / 均线 / 资金异动" />
              <FlowRow icon={<ShieldCheck className="h-3.5 w-3.5" />} title="风控约束" text="预算、最小下单、杠杆档位、手续费和强平风险" />
              <FlowRow icon={<Bot className="h-3.5 w-3.5" />} title="输出范围" text="仅建议，不在此页执行下单" />
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  )
}

function DecisionSummary({ decision, reviewing }: { decision: EngineDecision | null; reviewing: boolean }) {
  if (!decision) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
        {reviewing ? 'Skills 正在读取行情并生成判断...' : '等待 Skills 实时判断'}
      </div>
    )
  }
  return (
    <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="rounded-md border border-border bg-background/55 p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge className={actionClass(decision.action)}>{actionText(decision.action)}</Badge>
          <Badge variant="outline" className={sideClass(decision.side)}>{sideText(decision.side)}</Badge>
          <Badge variant="outline">{productText(decision.product)}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <MiniStat label="置信度" value={`${decision.confidence}%`} />
          <MiniStat label="评分" value={`${decision.score}`} />
          <MiniStat label="目标仓位" value={`${decision.targetPct.toFixed(2)}%`} />
          <MiniStat label="投入金额" value={`$${formatMoney(decision.allocationUsdt)}`} />
          <MiniStat label="止盈" value={decision.takeProfit ? `$${formatPrice(decision.takeProfit)}` : '--'} tone="text-gain" />
          <MiniStat label="止损" value={decision.stopLoss ? `$${formatPrice(decision.stopLoss)}` : '--'} tone="text-loss" />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm leading-7">{decision.summary}</p>
        <div className="grid gap-2 md:grid-cols-2">
          {decision.reasons.slice(0, 4).map((item, index) => (
            <p key={`${item}-${index}`} className="rounded-md border border-border bg-background/45 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              {item}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

function SkillCard({ skill }: { skill: SkillRegistryEntry }) {
  const ready = skill.installed && skill.dependencyStatus.every((item) => item.ready)
  return (
    <Card className={cn(ready ? 'border-gain/20' : 'border-warning/25')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{SKILL_LABELS[skill.name] || skill.name}</p>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{skill.name}</p>
          </div>
          <Badge variant="outline" className={ready ? 'border-gain text-gain' : 'border-warning text-warning'}>
            {ready ? '可运行' : '待配置'}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">{skill.category}</Badge>
          <Badge variant="outline" className="text-[10px]">{skill.automationLevel}</Badge>
          <Badge variant="outline" className={cn('text-[10px]', skill.writeAccess ? 'border-warning text-warning' : 'border-primary text-primary')}>
            {skill.writeAccess ? '可写测试账户' : '只读分析'}
          </Badge>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">{skill.logic}</p>
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase text-muted-foreground">依赖状态</p>
          <div className="flex flex-wrap gap-1.5">
            {skill.dependencyStatus.map((dependency) => (
              <Badge key={dependency.name} variant="outline" className={cn('text-[10px]', dependency.ready ? 'border-gain text-gain' : 'border-loss text-loss')}>
                {dependency.ready ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {dependency.name}
              </Badge>
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          触发：{skill.trigger}
        </p>
      </CardContent>
    </Card>
  )
}

function MiniState({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className="font-mono text-lg font-semibold">{value}</p>
    </div>
  )
}

function FlowRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-foreground">{icon}{title}</div>
      <p className="leading-5">{text}</p>
    </div>
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

function normalizeInstId(value: string) {
  const raw = String(value || 'BTC-USDT').trim().toUpperCase()
  if (!raw.includes('-') && /^[A-Z0-9]+$/.test(raw)) return `${raw}-USDT`
  return raw || 'BTC-USDT'
}

function actionText(value: string) {
  return value === 'buy' ? '买入/做多' : value === 'sell' ? '卖出/做空' : value === 'hold' ? '持有' : '观察'
}

function sideText(value: string) {
  return value === 'long' ? '做多' : value === 'short' ? '做空' : '中性'
}

function productText(value: string) {
  return value === 'spot' ? '现货' : value === 'swap' ? '合约' : '现货 + 合约'
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
