'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, ArrowRight, BarChart3, Bot, BrainCircuit, CandlestickChart as CandleIcon, Database, Grid3X3, Layers3, RefreshCcw, ShieldCheck, Sparkles, WalletCards, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CandlestickChart } from '@/components/trading/candlestick-chart'
import { fetchChart, type ChartSnapshot } from '@/lib/trading-api'
import { latestBoll, latestMacd } from '@/lib/chart-indicators'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'

const HOME_REFRESH_MS = 10_000

const sections = [
  {
    href: '/accounts',
    title: '账户管理',
    description: '独立账户看板，展开查看所有账户持仓、盈亏、收益率、自动化状态和操作记录。',
    icon: WalletCards,
    tone: 'text-emerald-300',
  },
  {
    href: '/full-position-test',
    title: '全仓参数测试',
    description: '新开多个 1000000U 测试账户长期挂机，比较不同自动化参数的每小时收益、每日收益、胜率、回撤和总收益。',
    icon: Activity,
    tone: 'text-lime-300',
  },
  {
    href: '/historical-backtest',
    title: '历史K线回测',
    description: '自选时间范围，把历史K线逐根回放给模型；每个模型单独记录收益、收益率和开平仓原因。',
    icon: Database,
    tone: 'text-cyan-300',
  },
  {
    href: '/market-data',
    title: '币种数据',
    description: '查看现货与合约行情、K 线和技术指标，不加载账户与 AI 执行模块。',
    icon: BarChart3,
    tone: 'text-sky-300',
  },
  {
    href: '/skills-live',
    title: 'Skills 实时建议',
    description: '查看本地 Skills 运行状态、基础能力、总结推荐与风控说明。',
    icon: Bot,
    tone: 'text-emerald-300',
  },
  {
    href: '/tradingagents',
    title: 'TradingAgents 实时建议',
    description: '使用接入的 LLM 做多智能体复核，查看最终判断和运行状态。',
    icon: BrainCircuit,
    tone: 'text-violet-300',
  },
  {
    href: '/strategies',
    title: '常见运行策略',
    description: '马丁格尔、网格、定投、突破和均值回归等策略模板。',
    icon: Grid3X3,
    tone: 'text-amber-300',
  },
  {
    href: '/arbitrage',
    title: '套利',
    description: '资金费率套利、现货/合约对冲保值、跨平台价差等模式。',
    icon: Waypoints,
    tone: 'text-rose-300',
  },
] as const

export default function HomePage() {
  const [chart, setChart] = useState<ChartSnapshot>({ candles: [], indicators: null, stats: {} })
  const [bar, setBar] = useState('15m')
  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadChart = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchChart('BTC-USDT', bar)
      setChart(next)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'BTC K 线同步失败')
    } finally {
      setLoading(false)
    }
  }, [bar])

  useEffect(() => {
    let active = true
    async function run() {
      if (!active) return
      await loadChart()
    }
    void run()
    const timer = window.setInterval(() => {
      if (!document.hidden) void run()
    }, HOME_REFRESH_MS)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [loadChart])

  const last = chart.candles.at(-1)
  const previous = chart.candles.at(-2)
  const changePct = last && previous?.close ? (last.close / previous.close - 1) * 100 : 0
  const macd = useMemo(() => latestMacd(chart.candles), [chart.candles])
  const boll = useMemo(() => latestBoll(chart.candles), [chart.candles])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 shadow-[0_0_30px_rgba(255,184,0,0.12)]">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-normal md:text-5xl">
            量化交易与 AI 复核控制台
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            轻首页只保留 BTC 实时 K 线和分区入口，其他模块按需打开，降低负载并保持操作清爽。
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-xs text-loss">
            {error}
          </div>
        )}

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="h-[clamp(360px,52vh,560px)] min-w-0">
            <CandlestickChart
              symbol="BTC"
              instType="SPOT"
              candles={chart.candles}
              loading={loading}
              activeTimeframe={bar}
              onTimeframeChange={setBar}
              isCollapsed={collapsed}
              onToggleCollapse={() => setCollapsed((value) => !value)}
              marketSource={chart.marketSource}
              defaultShowBoll
              headerAction={(
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void loadChart()}>
                  <RefreshCcw className={cn('h-3 w-3', loading && 'animate-spin')} />
                  刷新
                </Button>
              )}
            />
          </div>

          <aside className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <MetricCard
              icon={<CandleIcon className="h-4 w-4 text-primary" />}
              label="BTC 最新价"
              value={last ? `$${formatPrice(last.close)}` : '--'}
              detail={previous ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% / ${bar}` : '等待行情'}
              tone={changePct >= 0 ? 'text-gain' : 'text-loss'}
            />
            <MetricCard
              icon={<Layers3 className="h-4 w-4 text-amber-300" />}
              label="BOLL(20,2)"
              value={boll ? `宽度 ${boll.widthPct}%` : '--'}
              detail={boll ? `上 ${formatPrice(boll.upper)} / 中 ${formatPrice(boll.middle)} / 下 ${formatPrice(boll.lower)}` : 'K 线不足'}
            />
            <MetricCard
              icon={<ShieldCheck className="h-4 w-4 text-emerald-300" />}
              label="MACD(12,26,9)"
              value={macd ? `${macd.hist >= 0 ? '+' : ''}${macd.hist}` : '--'}
              detail={macd ? `DIF ${macd.dif} / DEA ${macd.dea}` : 'K 线不足'}
              tone={macd?.bias === 'bullish' ? 'text-gain' : macd?.bias === 'bearish' ? 'text-loss' : ''}
            />
          </aside>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <button
                key={section.href}
                className="group relative min-h-40 overflow-hidden rounded-xl border border-border bg-card p-5 text-left transition duration-300 hover:-translate-y-1 hover:scale-[1.025] hover:border-primary/70 hover:bg-accent/30 hover:shadow-[0_20px_55px_rgba(0,0,0,0.32)]"
                onClick={() => { window.location.href = section.href }}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition group-hover:opacity-100" />
                <div className="mb-5 flex items-center justify-between">
                  <span className="rounded-lg border border-border bg-background/60 p-2.5 transition duration-300 group-hover:scale-110 group-hover:border-primary/50">
                    <Icon className={cn('h-4 w-4', section.tone)} />
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition duration-300 group-hover:translate-x-1 group-hover:text-primary" />
                </div>
                <h2 className="text-base font-semibold">{section.title}</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{section.description}</p>
              </button>
            )
          })}
          <button
            className="group relative min-h-40 overflow-hidden rounded-xl border border-border bg-card p-5 text-left transition duration-300 hover:-translate-y-1 hover:scale-[1.025] hover:border-primary/70 hover:bg-accent/30 hover:shadow-[0_20px_55px_rgba(0,0,0,0.32)]"
            onClick={() => { window.location.href = '/terminal' }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition group-hover:opacity-100" />
            <div className="mb-5 flex items-center justify-between">
              <span className="rounded-lg border border-border bg-background/60 p-2.5 transition duration-300 group-hover:scale-110 group-hover:border-primary/50">
                <Sparkles className="h-4 w-4 text-primary" />
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground transition duration-300 group-hover:translate-x-1 group-hover:text-primary" />
            </div>
            <h2 className="text-base font-semibold">完整终端</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">保留原来的账户、持仓、AI 计划和自动化操作入口。</p>
          </button>
        </section>
      </div>
    </main>
  )
}

function MetricCard({ icon, label, value, detail, tone = '' }: { icon: ReactNode; label: string; value: string; detail: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <p className={cn('font-mono text-lg font-semibold', tone)}>{value}</p>
        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}
