'use client'

import { ArrowLeft, ArrowRightLeft, BadgeDollarSign, Banknote, Building2, CircleDollarSign, GitCompareArrows, Info, Radar, ShieldCheck, Waypoints } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const modes = [
  {
    name: '资金费率套利',
    icon: BadgeDollarSign,
    status: '优先接入',
    complexity: 46,
    description: '在资金费率极端时构造现货/合约或合约对冲，目标是赚取资金费并控制方向风险。',
    checks: ['资金费率', '下次结算时间', '手续费', '基差回归风险'],
  },
  {
    name: '现货 / 合约对冲保值',
    icon: ShieldCheck,
    status: '适合测试',
    complexity: 38,
    description: '持有现货同时开反向永续，降低方向波动，用于保护已有仓位或做中性策略。',
    checks: ['现货深度', '合约杠杆', '保证金率', '强平距离'],
  },
  {
    name: '跨平台价差',
    icon: Building2,
    status: '待数据源',
    complexity: 72,
    description: '比较 OKX 与其他交易所同一标的价格差，扣除提现、充值、手续费和滑点后判断是否可套利。',
    checks: ['多平台行情', '转账时间', '充值提现状态', '净价差'],
  },
  {
    name: '期现基差',
    icon: GitCompareArrows,
    status: '可扩展',
    complexity: 54,
    description: '比较现货与交割/永续价格差，判断基差收敛或扩大的交易机会。',
    checks: ['基差百分比', '年化收益', '交割时间', '流动性'],
  },
  {
    name: '三角套利',
    icon: Waypoints,
    status: '高频要求',
    complexity: 88,
    description: '在同一交易所内部比较三个交易对形成的闭环价差，要求极低延迟和高成交确定性。',
    checks: ['三腿深度', '撮合延迟', '最小下单额', '滑点'],
  },
  {
    name: '稳定币价差',
    icon: CircleDollarSign,
    status: '观察',
    complexity: 34,
    description: '监控稳定币偏离锚定价格时的价差，但默认不纳入 AI 买币推荐，避免无意义持仓。',
    checks: ['脱锚幅度', '赎回通道', '流动性', '事件风险'],
  },
]

export default function ArbitragePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 lg:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-xl font-semibold">
                <Waypoints className="h-5 w-5 text-primary" />
                套利
              </h1>
              <p className="text-xs text-muted-foreground">资金费率、对冲保值、跨平台价差和基差策略的 UI 入口。</p>
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={() => { window.location.href = '/tradingagents' }}>
            <Radar className="h-3.5 w-3.5" />
            TA 复核
          </Button>
        </header>

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="p-4">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Info className="h-4 w-4 text-primary" />
                套利模块原则
              </p>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                套利不会直接复用 OKX 自带机器人。后续由 Skills 拉取真实行情、资金费、深度和账户保证金，再交给 TradingAgents 复核是否执行。
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid grid-cols-3 gap-2 p-4 text-center text-xs">
              <Mini label="优先" value="资金费" />
              <Mini label="账户" value="测试" />
              <Mini label="执行" value="未接入" />
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modes.map((mode) => {
            const Icon = mode.icon
            return (
              <Card key={mode.name}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      {mode.name}
                    </span>
                    <Badge variant="outline" className={cn(mode.complexity >= 75 ? 'border-loss text-loss' : mode.complexity <= 40 ? 'border-gain text-gain' : 'border-warning text-warning')}>
                      {mode.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs leading-6 text-muted-foreground">{mode.description}</p>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">接入复杂度</span>
                      <span>{mode.complexity}%</span>
                    </div>
                    <Progress value={mode.complexity} />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                    {mode.checks.map((check) => (
                      <span key={check} className="rounded bg-muted/30 px-2 py-1">{check}</span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-xs text-muted-foreground">
            <Banknote className="h-4 w-4 text-warning" />
            后续接入跨平台套利时，需要额外配置其他交易所只读行情源；涉及真实资金转账的策略会保持手动确认。
            <ArrowRightLeft className="ml-auto h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 px-2 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
