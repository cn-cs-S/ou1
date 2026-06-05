'use client'

import { ArrowLeft, BarChart3, Boxes, Calculator, Layers3, Play, RefreshCw, Repeat2, ShieldAlert, Sparkles, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const strategies = [
  {
    name: '网格策略',
    icon: Boxes,
    status: 'UI 就绪',
    risk: 42,
    description: '根据波动率、支撑阻力和手续费生成上下网格，不使用 OKX 现成网格机器人。',
    skills: ['kline-indicator', 'position-sizer', 'okx-strategy-oracle'],
    parameters: ['价格区间', '网格数量', '单格资金', '止损阈值'],
  },
  {
    name: '马丁格尔',
    icon: Repeat2,
    status: '高风险',
    risk: 82,
    description: '只允许在测试账户与严格上限下运行，TradingAgents 必须复核是否适合当前行情。',
    skills: ['trading-plan-generator', 'position-sizer'],
    parameters: ['加仓倍数', '最大层数', '回撤停止', '反向信号退出'],
  },
  {
    name: '定投 / 条件定投',
    icon: RefreshCw,
    status: '稳健',
    risk: 24,
    description: '按时间或 RSI/BOLL 条件分批买入，适合低频测试和长期观察。',
    skills: ['recurring-dca', 'kline-indicator'],
    parameters: ['周期', '单次金额', '触发指标', '暂停条件'],
  },
  {
    name: '趋势突破',
    icon: TrendingUp,
    status: '待接入',
    risk: 58,
    description: '通过均线斜率、成交量放大和资金异动确认突破，避免假突破追高。',
    skills: ['kline-indicator', 'market-intel', 'trading-plan-generator'],
    parameters: ['突破周期', '成交量倍数', '回踩确认', '追踪止损'],
  },
  {
    name: '均值回归',
    icon: Layers3,
    status: '待接入',
    risk: 46,
    description: '利用 BOLL 偏离、RSI 超买超卖和资金异动判断回归概率。',
    skills: ['kline-indicator', 'position-sizer'],
    parameters: ['BOLL 偏离', 'RSI 阈值', '分批区间', '止损距离'],
  },
  {
    name: '盘口 Maker 入场',
    icon: Calculator,
    status: '半自动',
    risk: 36,
    description: '用被动挂单降低手续费，适合由 Skills 给出入场区间后分层挂单。',
    skills: ['okx-maker-entry', 'position-sizer'],
    parameters: ['挂单档位', '撤单时间', '最大滑点', '成交比例'],
  },
]

export default function StrategiesPage() {
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
                <BarChart3 className="h-5 w-5 text-primary" />
                常见运行策略
              </h1>
              <p className="text-xs text-muted-foreground">策略由本地 Skills 与 TradingAgents 生成和复核，不使用 OKX 自带策略机器人。</p>
            </div>
          </div>
          <Button size="sm" className="h-8 text-xs" onClick={() => { window.location.href = '/skills-live' }}>
            <Sparkles className="h-3.5 w-3.5" />
            查看 Skills
          </Button>
        </header>

        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 text-warning" />
                执行原则
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                当前先完成 UI。后续接入时，所有策略先在测试账户 dry-run，经过手续费、滑点、强平和最大回撤检查后再允许自动化。
              </p>
            </div>
            <Badge variant="outline" className="border-warning text-warning">仅 UI / 未下单</Badge>
          </CardContent>
        </Card>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {strategies.map((strategy) => {
            const Icon = strategy.icon
            return (
              <Card key={strategy.name}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      {strategy.name}
                    </span>
                    <Badge variant="outline" className={cn(strategy.risk >= 70 ? 'border-loss text-loss' : strategy.risk <= 30 ? 'border-gain text-gain' : 'border-warning text-warning')}>
                      {strategy.status}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs leading-6 text-muted-foreground">{strategy.description}</p>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">策略风险</span>
                      <span className={strategy.risk >= 70 ? 'text-loss' : strategy.risk <= 30 ? 'text-gain' : 'text-warning'}>{strategy.risk}%</span>
                    </div>
                    <Progress value={strategy.risk} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {strategy.skills.map((skill) => <Badge key={skill} variant="outline" className="text-[10px]">{skill}</Badge>)}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px] text-muted-foreground">
                    {strategy.parameters.map((parameter) => (
                      <span key={parameter} className="rounded bg-muted/30 px-2 py-1">{parameter}</span>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="h-8 w-full text-xs" disabled>
                    <Play className="h-3.5 w-3.5" />
                    接入后可运行
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </section>
      </div>
    </main>
  )
}
