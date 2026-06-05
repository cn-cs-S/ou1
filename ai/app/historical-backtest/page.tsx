'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, Clock3, Database, FileText, PauseCircle, Play, RefreshCcw, Trophy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  fetchHistoricalBacktests,
  fetchModelLogs,
  startHistoricalBacktest,
  stopHistoricalBacktest,
  type HistoricalBacktestRun,
  type HistoricalBacktestRow,
  type ModelRunLog,
} from '@/lib/trading-api'
import { cn } from '@/lib/utils'
import { formatMoney, formatSignedMoney } from '@/lib/format'

const REFRESH_MS = 8_000
const DEFAULT_SYMBOLS = 'BTC-USDT-SWAP,ETH-USDT-SWAP,SOL-USDT-SWAP,DOGE-USDT-SWAP,LAB-USDT-SWAP'
type HistoricalBar = '1D' | '4H' | '2H' | '1H' | '30m' | '15m' | '5m' | '3m' | '1m'

export default function HistoricalBacktestPage() {
  const [runs, setRuns] = useState<HistoricalBacktestRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState('')
  const [logs, setLogs] = useState<ModelRunLog[]>([])
  const [startDate, setStartDate] = useState('2022-01-01')
  const [endDate, setEndDate] = useState('2026-06-01')
  const [bar, setBar] = useState<HistoricalBar>('1D')
  const [lookbackDays, setLookbackDays] = useState(60)
  const [lookbackBars, setLookbackBars] = useState(240)
  const [stepBars, setStepBars] = useState(1)
  const [accountCount, setAccountCount] = useState(6)
  const [initialEquityUsdt, setInitialEquityUsdt] = useState(1000000)
  const [symbolMode, setSymbolMode] = useState<'all-swap' | 'custom'>('all-swap')
  const [symbolLimit, setSymbolLimit] = useState(120)
  const [analysisSymbolLimit, setAnalysisSymbolLimit] = useState(24)
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS)
  const [decisionEngine, setDecisionEngine] = useState<'skills' | 'hybrid' | 'tradingagents'>('skills')
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState('')

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) || runs[0] || null, [runs, selectedRunId])
  const sortedRows = useMemo(() => (selectedRun?.rows || []).slice().sort((a, b) => Number(b.stats?.totalReturnPct || 0) - Number(a.stats?.totalReturnPct || 0)), [selectedRun])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const next = await fetchHistoricalBacktests()
      setRuns(next)
      setSelectedRunId((current) => current || next[0]?.id || '')
      const target = next.find((run) => run.id === (selectedRunId || next[0]?.id)) || next[0]
      if (target) setLogs(await fetchModelLogs({ scope: 'backtest', runId: target.id, limit: 24 }))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '历史回测数据读取失败')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [selectedRunId])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  async function startRun(cacheOnly = false) {
    setActionPending(true)
    setError('')
    try {
      const run = await startHistoricalBacktest({
        startDate,
        endDate,
        bar,
        lookbackDays,
        lookbackBars,
        stepBars,
        accountCount,
        initialEquityUsdt,
        symbolMode,
        symbolLimit,
        analysisSymbolLimit,
        symbols: symbolMode === 'custom' ? symbols : '',
        decisionEngine,
        cacheOnly,
      })
      setSelectedRunId(run.id)
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动历史回测失败')
    } finally {
      setActionPending(false)
    }
  }

  async function stopRun(run: HistoricalBacktestRun) {
    setActionPending(true)
    setError('')
    try {
      await stopHistoricalBacktest(run.id)
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '停止历史回测失败')
    } finally {
      setActionPending(false)
    }
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
                <Database className="h-4 w-4 text-primary" />
                历史K线回测
              </h1>
              <p className="truncate text-sm text-foreground/75">逐根K线回放，模型只能看到当前时点以前的数据，日志与实时挂机分开存储。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="任务数" value={`${runs.length}`} />
            <SummaryPill label="平均收益" value={signedPct(selectedRun?.aggregate?.avgReturnPct || 0)} tone={toneByNumber(selectedRun?.aggregate?.avgReturnPct || 0)} />
            <SummaryPill label="最佳模型" value={selectedRun?.aggregate?.best ? `${selectedRun.aggregate.best.modelName} ${signedPct(selectedRun.aggregate.best.totalReturnPct)}` : '--'} tone={toneByNumber(selectedRun?.aggregate?.best?.totalReturnPct || 0)} />
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
        {error && <div className="mt-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}
      </header>

      <section className="grid gap-3 border-b border-border p-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <Field label="开始日期"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></Field>
          <Field label="结束日期"><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
          <Field label="K线周期">
            <Select value={bar} onValueChange={(value) => setBar(value as HistoricalBar)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1m">1m</SelectItem>
                <SelectItem value="3m">3m</SelectItem>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="15m">15m</SelectItem>
                <SelectItem value="30m">30m</SelectItem>
                <SelectItem value="1H">1H</SelectItem>
                <SelectItem value="2H">2H</SelectItem>
                <SelectItem value="4H">4H</SelectItem>
                <SelectItem value="1D">1D</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="预热天数"><Input type="number" min={0} max={365} value={lookbackDays} onChange={(event) => setLookbackDays(Math.max(0, Math.min(365, Number(event.target.value) || 60)))} /></Field>
          <Field label="模型可见K线"><Input type="number" min={20} max={100000} value={lookbackBars} onChange={(event) => setLookbackBars(Math.max(20, Math.min(100000, Number(event.target.value) || 240)))} /></Field>
          <Field label="步进K线"><Input type="number" min={1} max={30} value={stepBars} onChange={(event) => setStepBars(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></Field>
          <Field label="模型数量"><Input type="number" min={1} max={12} value={accountCount} onChange={(event) => setAccountCount(Math.max(1, Math.min(12, Number(event.target.value) || 6)))} /></Field>
          <Field label="初始资金"><Input type="number" min={1000} value={initialEquityUsdt} onChange={(event) => setInitialEquityUsdt(Math.max(1000, Number(event.target.value) || 1000000))} /></Field>
          <Field label="决策引擎">
            <Select value={decisionEngine} onValueChange={(value) => setDecisionEngine(value as 'skills' | 'hybrid' | 'tradingagents')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="skills">Skills</SelectItem>
                <SelectItem value="hybrid">Skills + TradingAgents</SelectItem>
                <SelectItem value="tradingagents">TradingAgents</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="标的范围">
            <Select value={symbolMode} onValueChange={(value) => setSymbolMode(value as 'all-swap' | 'custom')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all-swap">全部USDT合约</SelectItem>
                <SelectItem value="custom">自定义标的</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="全市场上限"><Input type="number" min={4} max={500} value={symbolLimit} disabled={symbolMode !== 'all-swap'} onChange={(event) => setSymbolLimit(Math.max(4, Math.min(500, Number(event.target.value) || 120)))} /></Field>
          <Field label="深度分析数"><Input type="number" min={4} max={500} value={analysisSymbolLimit} onChange={(event) => setAnalysisSymbolLimit(Math.max(4, Math.min(500, Number(event.target.value) || 24)))} /></Field>
          {symbolMode === 'custom' && (
            <label className="block text-sm font-semibold text-foreground/75 sm:col-span-2 lg:col-span-4 2xl:col-span-8">
              自定义标的
              <Input value={symbols} className="mt-2 font-mono text-xs" onChange={(event) => setSymbols(event.target.value)} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2">
          <Button variant="outline" className="h-10" disabled={actionPending} onClick={() => void startRun(true)}>
            <Database className="h-4 w-4" />
            仅下载K线缓存
          </Button>
          <Button className="h-10" disabled={actionPending} onClick={() => void startRun(false)}>
            <Play className="h-4 w-4" />
            启动历史回测
          </Button>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {runs.map((run) => (
          <button
            key={run.id}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-0.5 hover:border-primary/50', selectedRun?.id === run.id ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border bg-card text-foreground/75')}
            onClick={() => setSelectedRunId(run.id)}
          >
            {run.name}
            <span className="ml-2 text-foreground/55">{run.status}</span>
          </button>
        ))}
      </section>

      {selectedRun ? (
        <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <RunBanner run={selectedRun} actionPending={actionPending} onStop={() => void stopRun(selectedRun)} />
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {sortedRows.map((row) => <ModelCard key={row.id} row={row} />)}
            </div>
          </section>
          <aside className="space-y-3">
            <Panel title="模型日志文件" icon={<FileText className="h-4 w-4 text-primary" />}>
              <div className="space-y-3">
                {logs.length ? logs.map((log) => (
                  <div key={`${log.runId}-${log.modelId}`} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold">{log.modelName}</div>
                      <Badge variant="outline">{log.summary.samples} samples</Badge>
                    </div>
                    <div className={cn('mt-2 text-xl font-bold', toneByNumber(log.summary.totalReturnPct))}>{signedPct(log.summary.totalReturnPct)}</div>
                    <div className="mt-1 text-xs text-foreground/70">总收益 {formatSignedMoney(log.summary.totalProfit)}，最近操作 {log.operations.length} 条</div>
                    {log.tradeStats && (
                      <div className="mt-2 grid grid-cols-3 gap-1 text-xs text-foreground/75">
                        <span>开 {log.tradeStats.opens}</span>
                        <span>加 {log.tradeStats.adds}</span>
                        <span>平 {log.tradeStats.closes}</span>
                        <span>胜率 {signedPct(log.tradeStats.winRatePct)}</span>
                        <span>手续费 {formatMoney(log.tradeStats.totalFees || 0)}</span>
                        <span>跳过 {log.tradeStats.skipped}</span>
                      </div>
                    )}
                    {log.paths?.readableLog && <div className="mt-2 break-all rounded-md bg-background/60 p-2 font-mono text-[10px] text-foreground/60">{log.paths.readableLog}</div>}
                  </div>
                )) : <EmptyText text="暂无日志。回测完成或运行一段时间后会写入。" />}
              </div>
            </Panel>
            <Panel title="最近操作" icon={<Clock3 className="h-4 w-4 text-amber-300" />}>
              <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                {selectedRun.rows.flatMap((row) => (row.operations || []).slice(-8).map((op) => ({ ...op, modelName: row.modelName }))).slice(-60).reverse().map((op, index) => (
                  <div key={`${op.ts}-${op.instId}-${index}`} className="rounded-md border border-border bg-card/80 p-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold">{op.modelName}</span>
                      <span className="text-foreground/60">{op.ts?.slice(0, 10)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      <Badge variant="outline">{op.action}</Badge>
                      <span className="font-mono">{op.instId || '--'}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-foreground/75">{op.reason || op.operation || '--'}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </aside>
        </div>
      ) : (
        <div className="p-6"><EmptyText text="暂无历史回测，先设置参数并启动一轮。" /></div>
      )}
    </main>
  )
}

function RunBanner({ run, actionPending, onStop }: { run: HistoricalBacktestRun; actionPending: boolean; onStop: () => void }) {
  const percent = Math.max(0, Math.min(100, Number(run.progress?.percent || 0)))
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant={run.status === 'running' ? 'default' : 'outline'}>{run.status}</Badge>
            <h2 className="text-lg font-semibold">{run.name}</h2>
          </div>
          <p className="mt-1 text-sm text-foreground/70">
            {run.startDate} 至 {run.endDate}，{run.bar}，预热 {run.lookbackDays} 天，可见 {run.lookbackBars || '--'} 根，深度标的 {run.analysisSymbols.length}/{run.symbols.length}
          </p>
        </div>
        {run.status === 'running' && (
          <Button variant="outline" size="sm" disabled={actionPending} onClick={onStop}>
            <PauseCircle className="h-4 w-4" />
            停止
          </Button>
        )}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/70">
        <span>{run.progress?.message || '--'}</span>
        <span>{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MiniMetric label="预估请求" value={`${run.estimate?.estimatedOkxRequests || 0}`} />
        <MiniMetric label="预估拉取" value={`${run.estimate?.estimatedFetchMinutes || 0} 分钟`} />
        <MiniMetric label="预估缓存" value={`${run.estimate?.estimatedCacheMb || 0} MB`} />
        <MiniMetric label="回放步数" value={`${run.estimate?.estimatedReplaySteps || 0}`} />
        <MiniMetric label="平均收益" value={signedPct(run.aggregate?.avgReturnPct || 0)} tone={toneByNumber(run.aggregate?.avgReturnPct || 0)} />
        <MiniMetric label="最佳收益" value={run.aggregate?.best ? signedPct(run.aggregate.best.totalReturnPct) : '--'} tone={toneByNumber(run.aggregate?.best?.totalReturnPct || 0)} />
      </div>
    </div>
  )
}

function ModelCard({ row }: { row: HistoricalBacktestRow }) {
  const stats = row.stats
  const latestOperation = row.operations?.at(-1)
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">{row.modelName}</h3>
          </div>
          <p className="mt-1 text-xs text-foreground/65">{row.slug} / {row.status}</p>
        </div>
        <Badge variant="outline">{stats?.samples || 0}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="总收益" value={formatSignedMoney(stats?.totalProfit || 0)} tone={toneByNumber(stats?.totalProfit || 0)} />
        <Metric label="总收益率" value={signedPct(stats?.totalReturnPct || 0)} tone={toneByNumber(stats?.totalReturnPct || 0)} />
        <Metric label="日收益率" value={signedPct(stats?.dailyReturnPct || 0)} tone={toneByNumber(stats?.dailyReturnPct || 0)} />
        <Metric label="月收益率" value={signedPct(stats?.monthlyReturnPct || 0)} tone={toneByNumber(stats?.monthlyReturnPct || 0)} />
        <Metric label="年收益率" value={signedPct(stats?.yearlyReturnPct || 0)} tone={toneByNumber(stats?.yearlyReturnPct || 0)} />
        <Metric label="操作数" value={`${row.operations?.length || 0}`} />
      </div>
      <div className="mt-3 rounded-lg border border-border bg-background/50 p-2 text-xs leading-5 text-foreground/75">
        {latestOperation ? `${latestOperation.action} ${latestOperation.instId || ''}: ${latestOperation.reason || latestOperation.operation || '--'}` : '暂无操作记录'}
      </div>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-semibold text-foreground/75">{label}<div className="mt-2">{children}</div></label>
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-full border border-border bg-card px-3 py-1.5 text-xs"><span className="text-foreground/55">{label}</span><span className={cn('ml-2 font-semibold', tone)}>{value}</span></div>
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-border bg-background/40 p-3"><div className="text-xs text-foreground/55">{label}</div><div className={cn('mt-1 font-semibold', tone)}>{value}</div></div>
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div><div className="text-xs text-foreground/55">{label}</div><div className={cn('mt-1 font-semibold', tone)}>{value}</div></div>
}

function EmptyText({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground/65">{text}</div>
}

function signedPct(value: number) {
  const next = Number(value || 0)
  return `${next >= 0 ? '+' : ''}${next.toFixed(2)}%`
}

function toneByNumber(value: number) {
  const next = Number(value || 0)
  if (next > 0) return 'text-gain'
  if (next < 0) return 'text-loss'
  return ''
}
