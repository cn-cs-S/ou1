'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, AlertCircle, TrendingUp, TrendingDown, Minus, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { formatPrice, formatSignedMoney } from '@/lib/format'
import type { Position } from '@/lib/mock-data'

interface PositionsTableProps {
  positions: Position[]
  accountSource: 'test' | 'live-readonly'
  automationEnabled: boolean
  actionPending: boolean
  onAdjustPosition: (instId: string, action: 'add' | 'reduce' | 'close') => void
  hedge?: {
    active: boolean
    severity: string
    text: string
  }
}

export function PositionsTable({ positions, hedge, accountSource, automationEnabled, actionPending, onAdjustPosition }: PositionsTableProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0)
  const totalPnlPercent = positions.length > 0 
    ? positions.reduce((sum, p) => sum + p.pnlPercent, 0) / positions.length 
    : 0

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border hover:bg-accent/30 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-sm">当前持仓</span>
              <Badge variant="outline" className="text-[10px]">{positions.length} 个</Badge>
              <span className={cn(
                'text-xs font-mono',
                totalPnl >= 0 ? 'text-gain' : 'text-loss'
              )}>
                {formatSignedMoney(totalPnl)} ({totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%)
              </span>
            </div>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {positions.length > 0 && (
            <div className="px-3 py-2 border-b border-border bg-gain/5 text-[11px] text-muted-foreground">
              测试持仓的入场基准记录自操作当刻真实报价；盈亏与强平参考由真实行情在本地实时重算。
            </div>
          )}
          {accountSource === 'test' && automationEnabled && (
            <div className="px-3 py-2 border-b border-gain/30 bg-gain/10 text-[11px] text-gain">
              AI 已接管当前测试账户：已有持仓（包括手动建立的仓位）将按止盈止损、反向确认及仓位上限实时评估并自动处理。
            </div>
          )}
          {hedge?.active && (
            <div className={cn(
              'px-3 py-2 border-b border-border text-[11px]',
              hedge.severity === 'high' ? 'bg-loss text-loss' : 'bg-warning/10 text-warning',
            )}>
              <AlertCircle className="inline h-3.5 w-3.5 mr-1 align-text-bottom" />
              {hedge.text}
            </div>
          )}
          {positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">币种</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">方向</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">数量</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">杠杆</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">开仓价 / 基准</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">估值标记价</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">强平参考</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">盈亏平衡</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">浮动盈亏</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">AI 建议</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.id} className="border-b border-border/50 hover:bg-accent/20">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{position.symbol}</span>
                          <Badge variant="outline" className="text-[10px] h-4">
                            {position.type === 'spot' ? '现货' : '永续'}
                          </Badge>
                        </div>
                        {position.valuationLabel && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'mt-1 h-4 text-[9px]',
                              position.valuationLabel.includes('真实')
                                ? 'border-gain text-gain'
                                : 'border-warning text-warning',
                            )}
                          >
                            {position.valuationLabel}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className={cn(
                          'flex items-center gap-1',
                          position.side === 'long' ? 'text-gain' : 'text-loss'
                        )}>
                          {position.side === 'long' ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          <span>{position.side === 'long' ? '做多' : '做空'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{position.size}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={cn(
                          'font-mono',
                          position.leverage > 1 && 'text-warning'
                        )}>
                          {position.leverage}x
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <p className="font-mono">${formatPrice(position.entryPrice)}</p>
                        <p className="text-[9px] text-muted-foreground">{position.entryLabel}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">${formatPrice(position.markPrice)}</td>
                      <td className="px-3 py-2 text-right">
                        {position.liquidationPrice > 0 ? (
                          <p className="font-mono text-loss">${formatPrice(position.liquidationPrice)}</p>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        <p className="text-[9px] text-muted-foreground">{position.liquidationLabel}</p>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">${formatPrice(position.breakEvenPrice)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className={cn(
                          'font-mono',
                          position.pnl >= 0 ? 'text-gain' : 'text-loss'
                        )}>
                          <p>{formatSignedMoney(position.pnl)}</p>
                          <p className="text-[10px]">({position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%)</p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-[10px] text-muted-foreground max-w-[240px] truncate" title={position.aiSuggestion}>
                          {position.aiSuggestion}
                        </p>
                        {position.valuationWarning && (
                          <p className="mt-1 text-[9px] text-warning max-w-[240px] truncate" title={position.valuationWarning}>
                            {position.valuationWarning}
                          </p>
                        )}
                        {accountSource === 'test' && (
                          <div className="mt-1.5 flex gap-1">
                            <Button size="sm" variant="outline" className="h-6 px-1.5 text-gain" title="加仓" disabled={actionPending} onClick={() => onAdjustPosition(position.instId, 'add')}>
                              <Plus className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 px-1.5" title="减仓 25%" disabled={actionPending} onClick={() => onAdjustPosition(position.instId, 'reduce')}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 px-1.5 text-loss" title="平仓" disabled={actionPending} onClick={() => onAdjustPosition(position.instId, 'close')}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">暂无持仓</p>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
