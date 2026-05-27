'use client'

import { useState, useEffect } from 'react'
import { Activity, Wifi, WifiOff, Sparkles, Clock, WalletCards } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatMoney, formatSignedMoney } from '@/lib/format'

interface TradingHeaderProps {
  symbol: string
  instType: 'SPOT' | 'SWAP'
  accountSource: 'test' | 'live-readonly'
  accountLabel: string
  isConnected: boolean
  aiSkillsActive: boolean
  equity: number
  available: number
  pnl: number
  realMarketValuation?: boolean
  onOpenAccounts: () => void
}

export function TradingHeader({ symbol, instType, accountSource, accountLabel, isConnected, aiSkillsActive, equity, available, pnl, realMarketValuation, onOpenAccounts }: TradingHeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>('')

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleString('zh-CN'))
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-card border-b border-border">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-bold text-lg">AI 交易终端</span>
          <span className="px-2 py-1 rounded bg-muted text-xs font-mono">{symbol}/USDT</span>
          <Badge variant="outline" className={cn('text-[10px]', instType === 'SWAP' ? 'border-warning text-warning' : 'border-primary text-primary')}>
            {instType === 'SWAP' ? '永续' : '现货'}
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge 
            variant="outline" 
            className={cn(
              'text-[10px] gap-1',
              accountSource === 'test' ? 'border-warning text-warning' : 'border-gain text-gain'
            )}
          >
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              accountSource === 'test' ? 'bg-warning' : 'bg-gain'
            )} />
            {accountLabel}
          </Badge>

          <Badge 
            variant="outline" 
            className={cn(
              'text-[10px] gap-1',
              isConnected ? 'border-gain text-gain' : 'border-loss text-loss'
            )}
          >
            {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isConnected ? '已连接' : '断开'}
          </Badge>

          <Badge 
            variant="outline" 
            className={cn(
              'text-[10px] gap-1',
              aiSkillsActive ? 'border-primary text-primary' : 'border-muted-foreground text-muted-foreground'
            )}
          >
            <Sparkles className="h-3 w-3" />
            AI Skills {aiSkillsActive ? '开启' : '关闭'}
          </Badge>
          {realMarketValuation && (
            <Badge variant="outline" className="text-[10px] gap-1 border-gain text-gain">
              <span className="w-1.5 h-1.5 rounded-full bg-gain" />
              真实行情估值
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono">{currentTime || '--'}</span>
        </div>
        
        <div className="flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">权益 <strong className="ml-1 text-foreground font-mono">${formatMoney(equity)}</strong></span>
          <span className="text-muted-foreground">可用 <strong className="ml-1 text-foreground font-mono">${formatMoney(available)}</strong></span>
          <span className="text-muted-foreground">
            浮盈
            <strong className={cn('ml-1 font-mono', pnl >= 0 ? 'text-gain' : 'text-loss')}>
              {formatSignedMoney(pnl)}
            </strong>
          </span>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onOpenAccounts}>
            <WalletCards className="h-3.5 w-3.5" />
            账户总览
          </Button>
        </div>
      </div>
    </header>
  )
}
