'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { IndicatorItem, IndicatorPack } from '@/lib/mock-data'

interface TechnicalIndicatorsProps {
  symbol: string
  instType: 'SPOT' | 'SWAP'
  indicators: IndicatorPack | null
  loading: boolean
}

type Signal = 'bullish' | 'bearish' | 'neutral'

export function TechnicalIndicators({ symbol, instType, indicators, loading }: TechnicalIndicatorsProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const rows = indicators ? [...indicators.oscillators, ...indicators.movingAverages].slice(0, 10) : []
  const bullishCount = indicators?.summary.buy || 0
  const bearishCount = indicators?.summary.sell || 0
  const overallSignal = toSignal(indicators?.summary.action || '中立')

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border hover:bg-accent/30 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-sm">{symbol} 技术指标</span>
              <Badge variant="outline" className={cn('text-[10px]', instType === 'SWAP' ? 'border-warning text-warning' : 'border-primary text-primary')}>
                {instType === 'SWAP' ? '永续' : '现货'}
              </Badge>
              <div className="flex items-center gap-1">
                {signalIcon(overallSignal)}
                <span className={cn('text-xs', signalColor(overallSignal))}>
                  {indicators?.summary.action || (loading ? '刷新中' : '等待数据')}
                </span>
              </div>
              <Badge variant="outline" className="text-[10px] gap-1">
                <span className="text-gain">{bullishCount} 买入</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-loss">{bearishCount} 卖出</span>
              </Badge>
            </div>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {rows.length ? (
            <div className="grid grid-cols-5 gap-1 p-2">
              {rows.map((indicator) => {
                const signal = toSignal(indicator.action)
                return (
                  <div
                    key={indicator.name}
                    className="p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                    title={`${indicator.name}: ${indicator.action}`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      {signalIcon(signal)}
                      <span className="text-[10px] text-muted-foreground truncate">{indicator.name}</span>
                    </div>
                    <p className={cn('text-xs font-mono font-medium truncate', signalColor(signal))}>
                      {formatIndicator(indicator)}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-muted-foreground">正在同步实时指标...</div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function toSignal(action: string): Signal {
  if (action.includes('买入') || action === '趋势') return 'bullish'
  if (action.includes('卖出')) return 'bearish'
  return 'neutral'
}

function signalIcon(signal: Signal) {
  if (signal === 'bullish') return <TrendingUp className="h-3 w-3 text-gain" />
  if (signal === 'bearish') return <TrendingDown className="h-3 w-3 text-loss" />
  return <Minus className="h-3 w-3 text-muted-foreground" />
}

function signalColor(signal: Signal) {
  if (signal === 'bullish') return 'text-gain'
  if (signal === 'bearish') return 'text-loss'
  return 'text-muted-foreground'
}

function formatIndicator(indicator: IndicatorItem) {
  if (indicator.value === null) return '--'
  return Number(indicator.value).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
}
