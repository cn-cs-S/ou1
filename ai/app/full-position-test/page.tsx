'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, ArrowLeft, ChevronDown, ChevronUp, Clock3, PauseCircle, Play, RefreshCcw, ShieldAlert, Trophy, WalletCards } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  fetchFullPositionTests,
  startFullPositionTest,
  stopFullPositionTest,
  type FullPositionTestRow,
  type FullPositionTestSuite,
} from '@/lib/trading-api'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice, formatSignedMoney } from '@/lib/format'
import type { PlanSettings, Position } from '@/lib/mock-data'

const REFRESH_MS = 10_000
const DEFAULT_CUSTOM_SYMBOLS = 'BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP,DOGE-USDT-SWAP,LAB-USDT-SWAP'

type SymbolMode = 'all-swap' | 'custom'
type DecisionScope = PlanSettings['decisionEngine'] | 'all'

export default function FullPositionTestPage() {
  const [suites, setSuites] = useState<FullPositionTestSuite[]>([])
  const [selectedSuiteId, setSelectedSuiteId] = useState('')
  const [accountCount, setAccountCount] = useState(25)
  const [initialEquityUsdt, setInitialEquityUsdt] = useState(1000000)
  const [intervalSeconds, setIntervalSeconds] = useState(30)
  const [symbolMode, setSymbolMode] = useState<SymbolMode>('all-swap')
  const [symbolLimit, setSymbolLimit] = useState(500)
  const [analysisSymbolLimit, setAnalysisSymbolLimit] = useState(60)
  const [symbols, setSymbols] = useState(DEFAULT_CUSTOM_SYMBOLS)
  const [excludeNewCoins, setExcludeNewCoins] = useState(false)
  const [decisionEngine, setDecisionEngine] = useState<DecisionScope>('all')
  const [runImmediately, setRunImmediately] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const next = await fetchFullPositionTests()
      setSuites(next)
      setSelectedSuiteId((current) => current || next[0]?.id || '')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '长期测试数据读取失败')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const selectedSuite = useMemo(() => suites.find((suite) => suite.id === selectedSuiteId) || suites[0] || null, [selectedSuiteId, suites])
  const runningSuites = suites.filter((suite) => suite.status === 'running').length

  async function startSuite() {
    setActionPending(true)
    setError('')
    try {
      const suite = await startFullPositionTest({
        accountCount,
        initialEquityUsdt,
        intervalSeconds,
        symbolMode,
        symbolLimit,
        analysisSymbolLimit,
        excludeNewCoins,
        symbols: symbolMode === 'custom' ? symbols : '',
        decisionEngine,
        runImmediately,
        resetExisting: true,
      })
      setExpanded(new Set())
      setSelectedSuiteId(suite.id)
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动长期测试失败')
    } finally {
      setActionPending(false)
    }
  }

  async function stopSuite(suite: FullPositionTestSuite) {
    setActionPending(true)
    setError('')
    try {
      await stopFullPositionTest(suite.id)
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '停止长期测试失败')
    } finally {
      setActionPending(false)
    }
  }

  function toggleRow(rowId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回首页" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <Activity className="h-4 w-4 text-primary" />
                全仓参数长期测试
              </h1>
              <p className="truncate text-sm text-foreground/75">全仓测试账户独立于普通账户管理；新开测试会先停用并删除旧全仓测试账户。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="运行套件" value={`${runningSuites}`} />
            <SummaryPill label="平均收益" value={signedPct(selectedSuite?.aggregate?.avgReturnPct || 0)} tone={toneByNumber(selectedSuite?.aggregate?.avgReturnPct || 0)} />
            <SummaryPill label="平均胜率" value={`${(selectedSuite?.aggregate?.avgWinRate || 0).toFixed(1)}%`} />
            <SummaryPill label="最佳" value={selectedSuite?.best ? `${selectedSuite.best.variant} ${signedPct(selectedSuite.best.totalReturnPct)}` : '--'} tone={toneByNumber(selectedSuite?.best?.totalReturnPct || 0)} />
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
        {error && <div className="mt-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}
      </header>

      <section className="grid gap-3 border-b border-border p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <Field label="测试账户数">
            <Input type="number" min={1} max={64} value={accountCount} className="font-mono" onChange={(event) => setAccountCount(Math.min(64, Math.max(1, Number(event.target.value) || 1)))} />
          </Field>
          <Field label="单账户资金">
            <Input type="number" min={1000} value={initialEquityUsdt} className="font-mono" onChange={(event) => setInitialEquityUsdt(Math.max(1000, Number(event.target.value) || 1000))} />
          </Field>
          <Field label="自动化间隔">
            <Select value={String(intervalSeconds)} onValueChange={(value) => setIntervalSeconds(Number(value))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 秒</SelectItem>
                <SelectItem value="60">1 分钟</SelectItem>
                <SelectItem value="300">5 分钟</SelectItem>
                <SelectItem value="600">10 分钟</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="决策引擎">
            <Select value={decisionEngine || 'all'} onValueChange={(value) => setDecisionEngine(value as DecisionScope)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全引擎覆盖</SelectItem>
                <SelectItem value="skills">Skills</SelectItem>
                <SelectItem value="hybrid">Skills + TradingAgents</SelectItem>
                <SelectItem value="tradingagents">TradingAgents</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="标的范围">
            <Select value={symbolMode} onValueChange={(value) => setSymbolMode(value as SymbolMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all-swap">全 USDT 永续合约</SelectItem>
                <SelectItem value="custom">只测自选标的</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="全市场上限">
            <Input type="number" min={20} max={500} value={symbolLimit} className="font-mono" disabled={symbolMode !== 'all-swap'} onChange={(event) => setSymbolLimit(Math.min(500, Math.max(20, Number(event.target.value) || 500)))} />
          </Field>
          <Field label="深度分析数量">
            <Input type="number" min={20} max={500} value={analysisSymbolLimit} className="font-mono" disabled={symbolMode !== 'all-swap'} onChange={(event) => setAnalysisSymbolLimit(Math.min(500, Math.max(20, Number(event.target.value) || 60)))} />
          </Field>
          {symbolMode === 'custom' && (
            <label className="block text-sm font-semibold text-foreground/75 sm:col-span-2 lg:col-span-3 2xl:col-span-6">
              自选标的池
              <Input value={symbols} className="mt-2 font-mono text-xs" placeholder="LAB-USDT-SWAP, BTC-USDT-SWAP" onChange={(event) => setSymbols(event.target.value)} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2 lg:justify-end">
          <div className="mb-1 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
            <span className="text-xs font-semibold text-foreground/75">排除新币</span>
            <Switch checked={excludeNewCoins} onCheckedChange={setExcludeNewCoins} />
          </div>
          <div className="mb-1 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
            <span className="text-xs font-semibold text-foreground/75">立即首轮</span>
            <Switch checked={runImmediately} onCheckedChange={setRunImmediately} />
          </div>
          <Button className="h-10" disabled={actionPending} onClick={() => void startSuite()}>
            <Play className="h-4 w-4" />
            清空旧测试并新开
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {suites.map((suite) => (
          <button
            key={suite.id}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary',
              selectedSuite?.id === suite.id ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border bg-card text-foreground/75',
            )}
            onClick={() => setSelectedSuiteId(suite.id)}
          >
            {suite.name}
            <span className={cn('ml-2', suite.status === 'running' ? 'text-gain' : 'text-foreground/60')}>{suite.status === 'running' ? '运行中' : '已停止'}</span>
          </button>
        ))}
        {!suites.length && <span className="text-sm text-foreground/70">暂无长期测试</span>}
      </section>

      {selectedSuite ? (
        <>
          <SuiteBanner suite={selectedSuite} actionPending={actionPending} onStop={() => void stopSuite(selectedSuite)} />
          <section className="grid gap-4 p-3 sm:grid-cols-2 2xl:grid-cols-3 min-[1900px]:grid-cols-4">
            {selectedSuite.rows.map((row) => (
              <TestAccountCard
                key={row.id}
                row={row}
                expanded={expanded.has(row.id)}
                onToggle={() => toggleRow(row.id)}
              />
            ))}
          </section>
        </>
      ) : (
        <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-border bg-card p-8 text-center text-sm text-foreground/75">
          点击“清空旧测试并新开”后，系统会创建独立全仓测试账户，按 30 秒或你选择的间隔长期运行，并统计每小时、每天、胜率、回撤和总收益率。
        </div>
      )}
    </main>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-foreground/75">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  )
}

function SuiteBanner({ suite, actionPending, onStop }: { suite: FullPositionTestSuite; actionPending: boolean; onStop: () => void }) {
  const aggregate = suite.aggregate
  return (
    <div className="border-b border-border bg-card/70 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={suite.status === 'running' ? 'border-gain/30 bg-gain/15 text-gain' : 'border-border text-foreground/70'} variant="outline">
              {suite.status === 'running' ? '长期运行中' : '已停止'}
            </Badge>
            <h2 className="truncate text-base font-semibold">{suite.name}</h2>
            {suite.best && <Badge variant="outline" className="border-primary/40 text-primary"><Trophy className="h-3 w-3" /> {suite.best.variant}</Badge>}
          </div>
          <p className="mt-1 max-w-5xl truncate font-mono text-xs text-foreground/70">
            全市场 {suite.symbols.length} 个，深度分析 {suite.analysisSymbols?.length || suite.rows[0]?.settings.symbolLimit || suite.symbols.length} 个 · {suite.symbols.slice(0, 14).join(', ')}{suite.symbols.length > 14 ? ' ...' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryPill label="账户" value={`${aggregate?.accountCount || suite.rows.length}`} />
          <SummaryPill label="间隔" value={`${suite.intervalSeconds} 秒`} />
          <SummaryPill label="均每小时" value={signedPct(aggregate?.avgHourlyReturnPct || 0)} tone={toneByNumber(aggregate?.avgHourlyReturnPct || 0)} />
          <SummaryPill label="均每日" value={signedPct(aggregate?.avgDailyReturnPct || 0)} tone={toneByNumber(aggregate?.avgDailyReturnPct || 0)} />
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={actionPending || suite.status !== 'running'} onClick={onStop}>
            <PauseCircle className="h-3.5 w-3.5" />
            停止套件
          </Button>
        </div>
      </div>
    </div>
  )
}

function TestAccountCard({ row, expanded, onToggle }: { row: FullPositionTestRow; expanded: boolean; onToggle: () => void }) {
  const stats = row.stats
  const account = row.account
  const positions = account?.positions || []
  const positive = Number(stats.totalReturnPct || 0) >= 0
  return (
    <article
      className={cn(
        'h-fit overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition duration-200 hover:-translate-y-1 hover:border-primary/50 hover:bg-card hover:shadow-[0_22px_55px_rgba(0,0,0,0.28)]',
        expanded && 'border-primary/45 shadow-[0_18px_42px_rgba(0,0,0,0.24)]',
      )}
    >
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" className="min-w-0 text-left" onClick={onToggle}>
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-base font-semibold">{row.variant}</h3>
              <Badge className={row.status === 'running' ? 'border-gain/30 bg-gain/15 text-gain' : 'border-border text-foreground/70'} variant="outline">
                {row.status === 'running' ? '运行' : '停止'}
              </Badge>
            </div>
            <p className="mt-1 truncate font-mono text-xs text-foreground/70">{row.accountLabel} · {row.accountId}</p>
          </button>
          <div className={cn('rounded-xl border px-3 py-2 text-right', positive ? 'border-gain/40 bg-gain/10' : 'border-loss/40 bg-loss/10')}>
            <p className="text-[11px] font-semibold text-foreground/75">总收益率</p>
            <p className={cn('font-mono text-xl font-semibold', positive ? 'text-gain' : 'text-loss')}>{signedPct(stats.totalReturnPct)}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Metric label="账户权益" value={`$${formatMoney(stats.currentEquity || 0)}`} icon={<WalletCards className="h-3.5 w-3.5 text-primary" />} />
          <Metric label="评分" value={`${stats.score.toFixed(1)}`} tone={stats.score >= 45 ? 'text-gain' : stats.score < 15 ? 'text-loss' : 'text-warning'} icon={<Trophy className="h-3.5 w-3.5 text-warning" />} />
          <Metric label="每小时" value={signedPct(stats.hourlyReturnPct)} tone={toneByNumber(stats.hourlyReturnPct)} />
          <Metric label="每日" value={signedPct(stats.dailyReturnPct)} tone={toneByNumber(stats.dailyReturnPct)} />
          <Metric label="胜率" value={`${stats.winRate.toFixed(1)}%`} tone={stats.winRate >= 50 ? 'text-gain' : 'text-loss'} />
          <Metric label="最大回撤" value={signedPct(stats.maxDrawdownPct)} tone={stats.maxDrawdownPct >= -3 ? 'text-foreground' : 'text-loss'} />
          <Metric label="保证金占用" value={`${stats.marginUsagePct.toFixed(1)}%`} icon={<ShieldAlert className="h-3.5 w-3.5 text-warning" />} />
          <Metric label="样本/执行" value={`${stats.samples}/${stats.executedActions}`} icon={<Clock3 className="h-3.5 w-3.5 text-sky-300" />} />
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-foreground/75">近 24 小时收益</p>
          <ReturnBars values={stats.recentHours.map((item) => item.returnPct)} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="text-xs text-foreground/70">
            {stats.lastSampleAt ? `最后采样 ${formatTime(stats.lastSampleAt)}` : '等待首轮采样'}
          </div>
          <Button size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs" onClick={onToggle}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? '收起' : '展开'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border bg-background/35 px-4 py-3">
          <div className="grid gap-2 rounded-xl border border-border bg-background/60 p-3 text-xs">
            <Param label="风险" value={`${row.settings.riskLevel || '--'}`} />
            <Param label="置信度" value={`${row.settings.minConfidence || 0}%`} />
            <Param label="单币上限" value={`${row.settings.maxAssetWeight || 0}%`} />
            <Param label="杠杆" value={`${row.settings.minLeverage || 1}x-${row.settings.maxLeverage || 1}x`} />
            <Param label="引擎" value={`${row.settings.decisionEngine || 'skills'}`} />
          </div>
          <PositionsList positions={positions} />
        </div>
      )}
    </article>
  )
}

function PositionsList({ positions }: { positions: Position[] }) {
  if (!positions.length) {
    return <div className="rounded-xl border border-border px-3 py-6 text-center text-sm text-foreground/75">暂无持仓</div>
  }
  return (
    <div className="space-y-2">
      {positions.slice(0, 10).map((position) => {
        const positive = position.pnl >= 0
        return (
          <div key={position.id} className="rounded-xl border border-border bg-background/70 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-sm font-semibold text-primary">{position.instId}</span>
                  <Badge className={cn('h-5 border-0 px-1.5 text-[11px]', position.side === 'long' ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss')}>
                    {position.side === 'long' ? '多' : '空'}
                  </Badge>
                  <Badge className="h-5 border-0 bg-warning/15 px-1.5 text-[11px] text-warning">{position.leverage.toFixed(1)}x</Badge>
                </div>
                <p className="mt-1 text-xs text-foreground/70">入场 ${formatPrice(position.entryPrice)} · 标记 ${formatPrice(position.markPrice)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn('font-mono text-sm font-semibold', positive ? 'text-gain' : 'text-loss')}>{formatSignedMoney(position.pnl)}</p>
                <p className={cn('font-mono text-xs', positive ? 'text-gain' : 'text-loss')}>{signedPct(position.pnlPercent)}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReturnBars({ values }: { values: number[] }) {
  const source = values.length ? values : [0]
  const max = Math.max(0.01, ...source.map((value) => Math.abs(value)))
  return (
    <div className="flex h-14 items-end gap-1 rounded-xl border border-border bg-background/60 px-2 py-2">
      {source.slice(-24).map((value, index) => (
        <div
          key={`${index}-${value}`}
          className={cn('w-full rounded-t transition', value >= 0 ? 'bg-gain/70' : 'bg-loss/75')}
          style={{ height: `${Math.max(8, Math.min(100, Math.abs(value) / max * 100))}%` }}
          title={signedPct(value)}
        />
      ))}
    </div>
  )
}

function Metric({ label, value, tone = '', icon }: { label: string; value: string; tone?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground/70">{label}</p>
        {icon}
      </div>
      <p className={cn('mt-1 truncate font-mono text-sm font-semibold', tone)}>{value}</p>
    </div>
  )
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground/65">{label}</span>
      <span className="font-mono font-semibold">{value}</span>
    </div>
  )
}

function SummaryPill({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-full border border-border bg-card px-3 py-1 text-xs shadow-[0_8px_18px_rgba(0,0,0,0.14)]">
      <span className="mr-2 text-foreground/70">{label}</span>
      <span className={cn('font-mono font-semibold', tone)}>{value}</span>
    </div>
  )
}

function signedPct(value: number) {
  const number = Number(value || 0)
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`
}

function toneByNumber(value: number) {
  return Number(value || 0) >= 0 ? 'text-gain' : 'text-loss'
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}
