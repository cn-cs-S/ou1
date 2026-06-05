'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BarChart3, RefreshCcw, RadioTower, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MarketSidebar } from '@/components/trading/market-sidebar'
import { CandlestickChart } from '@/components/trading/candlestick-chart'
import { TechnicalIndicators } from '@/components/trading/technical-indicators'
import {
  fetchAssets,
  fetchChart,
  fetchFavorites,
  saveFavorites,
  type ChartSnapshot,
} from '@/lib/trading-api'
import { latestMacd, type MacdSnapshot } from '@/lib/chart-indicators'
import type { CryptoAsset } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice } from '@/lib/format'

const CHART_REFRESH_MS = 10_000

export default function MarketDataPage() {
  const [assets, setAssets] = useState<CryptoAsset[]>([])
  const [selectedInstId, setSelectedInstId] = useState('BTC-USDT')
  const [detailHeight, setDetailHeight] = useState(180)
  const [bar, setBar] = useState('15m')
  const [chart, setChart] = useState<ChartSnapshot>({ candles: [], indicators: null, stats: {} })
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [isChartCollapsed, setIsChartCollapsed] = useState(false)
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [loadingChart, setLoadingChart] = useState(false)
  const [error, setError] = useState('')

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.instId === selectedInstId) || assets[0] || null,
    [assets, selectedInstId],
  )

  const macd = useMemo(() => latestMacd(chart.candles), [chart.candles])

  useEffect(() => {
    let active = true
    const localFavorites = readLocalFavorites()
    if (localFavorites.length) setFavoriteIds(new Set(localFavorites))

    async function restoreFavorites() {
      try {
        const remoteFavorites = await fetchFavorites()
        if (!active) return
        const merged = [...new Set([...localFavorites, ...remoteFavorites])]
        setFavoriteIds(new Set(merged))
        writeLocalFavorites(merged)
        if (merged.length !== remoteFavorites.length || merged.some((item) => !remoteFavorites.includes(item))) {
          void saveFavorites(merged)
        }
      } catch {
        if (!localFavorites.length) writeLocalFavorites([])
      }
    }

    void restoreFavorites()
    return () => {
      active = false
    }
  }, [])

  const loadAssets = useCallback(async () => {
    setLoadingAssets(true)
    try {
      const next = await fetchAssets()
      setAssets(next)
      setSelectedInstId((current) => (
        next.some((asset) => asset.instId === current)
          ? current
          : next.find((asset) => asset.instId === 'BTC-USDT')?.instId || next[0]?.instId || 'BTC-USDT'
      ))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '币种数据同步失败')
    } finally {
      setLoadingAssets(false)
    }
  }, [])

  const loadChart = useCallback(async () => {
    if (!selectedInstId) return
    setLoadingChart(true)
    try {
      const next = await fetchChart(selectedInstId, bar)
      setChart(next)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'K 线同步失败')
    } finally {
      setLoadingChart(false)
    }
  }, [bar, selectedInstId])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  useEffect(() => {
    void loadChart()
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadChart()
    }, CHART_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadChart])

  function toggleFavorite(instId: string) {
    setFavoriteIds((current) => {
      const next = new Set(current)
      if (next.has(instId)) next.delete(instId)
      else next.add(instId)
      const values = [...next]
      writeLocalFavorites(values)
      void saveFavorites(values).catch(() => {
        setError('收藏已保存到浏览器，但同步到本地服务失败')
      })
      return next
    })
  }

  const symbol = selectedAsset?.symbol || selectedInstId.replace(/-USDT.*/, '')
  const instType = selectedAsset?.instType || (selectedInstId.endsWith('-SWAP') ? 'SWAP' : 'SPOT')

  return (
    <main className="min-h-screen w-full bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回主页" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <BarChart3 className="h-4 w-4 text-primary" />
                币种数据
              </h1>
              <p className="text-xs text-muted-foreground">真实行情 / 现货合约 / 收藏池 / K 线指标</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-7 border-gain/60 text-gain">
              <RadioTower className="h-3.5 w-3.5" />
              live-public
            </Badge>
            <Badge variant="outline" className="h-7 text-xs">
              {assets.length || (loadingAssets ? '...' : 0)} 个标的
            </Badge>
            <Button variant="outline" size="sm" className="h-8 text-xs" disabled={loadingAssets || loadingChart} onClick={() => { void loadAssets(); void loadChart() }}>
              <RefreshCcw className={cn('h-3.5 w-3.5', (loadingAssets || loadingChart) && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
        {error && <div className="mt-2 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-xs text-loss">{error}</div>}
      </header>

      <div className="flex min-h-[calc(100vh-57px)] items-start max-xl:flex-col max-xl:items-stretch">
        <aside className="w-[320px] shrink-0 self-start overflow-hidden xl:sticky xl:top-[57px] xl:h-[calc(100vh-57px)] max-xl:h-[430px] max-xl:w-full">
          <MarketSidebar
            assets={assets}
            selectedAsset={selectedAsset}
            onSelectAsset={(asset) => setSelectedInstId(asset.instId)}
            detailHeight={detailHeight}
            onDetailHeightChange={setDetailHeight}
            chartStats={chart.stats}
            favorites={favoriteIds}
            onToggleFavorite={toggleFavorite}
            showAiFields={false}
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-2 p-2 max-xl:w-full">
          <Card className="border-border bg-card/80">
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-lg font-semibold">{selectedInstId}</span>
                <Badge variant="outline" className={instType === 'SWAP' ? 'border-warning text-warning' : 'border-primary text-primary'}>
                  {instType === 'SWAP' ? `永续 ${selectedAsset?.maxLeverage || 1}x` : '现货'}
                </Badge>
                <span className={cn('font-mono text-sm', Number(selectedAsset?.change24h || 0) >= 0 ? 'text-gain' : 'text-loss')}>
                  ${formatPrice(selectedAsset?.price || 0)} / {Number(selectedAsset?.change24h || 0) >= 0 ? '+' : ''}{formatMoney(selectedAsset?.change24h || 0)}%
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>区间高 <b className="font-mono text-gain">${formatPrice(chart.stats.high || selectedAsset?.high24h || selectedAsset?.price || 0)}</b></span>
                <span>区间低 <b className="font-mono text-loss">${formatPrice(chart.stats.low || selectedAsset?.low24h || selectedAsset?.price || 0)}</b></span>
              </div>
            </CardContent>
          </Card>

          <div className={isChartCollapsed ? 'h-auto' : 'h-[clamp(360px,55vh,680px)]'}>
            <CandlestickChart
              symbol={symbol}
              instType={instType}
              candles={chart.candles}
              loading={loadingChart}
              activeTimeframe={bar}
              onTimeframeChange={setBar}
              isCollapsed={isChartCollapsed}
              onToggleCollapse={() => setIsChartCollapsed((value) => !value)}
              marketSource={chart.marketSource}
              defaultShowBoll
              headerAction={(
                <Button variant="ghost" size="icon" className="h-6 w-6" title="刷新当前 K 线" onClick={() => void loadChart()}>
                  <RefreshCcw className={cn('h-3.5 w-3.5', loadingChart && 'animate-spin')} />
                </Button>
              )}
            />
          </div>

          <MacdSignalStrip macd={macd} />

          <TechnicalIndicators
            symbol={symbol}
            instType={instType}
            indicators={chart.indicators}
            loading={loadingChart}
          />
        </section>
      </div>
    </main>
  )
}

function MacdSignalStrip({ macd }: { macd: MacdSnapshot | null }) {
  const state = macdState(macd)
  return (
    <div className={cn('grid gap-2 rounded-lg border p-3 md:grid-cols-[220px_minmax(0,1fr)_220px]', state.border, state.bg)}>
      <div className="flex items-center gap-2">
        {state.bias === 'bearish' ? <TrendingDown className="h-4 w-4 text-loss" /> : <TrendingUp className="h-4 w-4 text-gain" />}
        <div>
          <p className={cn('text-sm font-semibold', state.text)}>{state.title}</p>
          <p className="text-[11px] text-muted-foreground">MACD(12, 26, 9)</p>
        </div>
      </div>
      <p className="text-xs leading-6 text-muted-foreground">{state.description}</p>
      <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
        {state.actions.map((item) => (
          <Badge key={item.label} variant="outline" className={cn('h-7 px-2 text-xs', item.className)}>
            {item.label}
          </Badge>
        ))}
        <Badge variant="outline" className="h-7 font-mono text-[11px]">DIF {macd ? macd.dif : '--'}</Badge>
        <Badge variant="outline" className="h-7 font-mono text-[11px]">DEA {macd ? macd.dea : '--'}</Badge>
        <Badge variant="outline" className={cn('h-7 font-mono text-[11px]', macd && macd.hist >= 0 ? 'border-gain text-gain' : 'border-loss text-loss')}>
          HIST {macd ? macd.hist : '--'}
        </Badge>
      </div>
    </div>
  )
}

function macdState(macd: MacdSnapshot | null) {
  if (!macd) {
    return {
      bias: 'neutral',
      title: 'MACD 同步中',
      description: '等待足够 K 线后展示 DIF、DEA、柱体和金叉/死叉。',
      border: 'border-border',
      bg: 'bg-card',
      text: 'text-muted-foreground',
      actions: [{ label: '观察', className: 'border-muted-foreground text-muted-foreground' }],
    } as const
  }
  if (macd.cross === 'golden') {
    return {
      bias: 'bullish',
      title: 'MACD 金叉',
      description: 'DIF 上穿 DEA，短线动能转多；若已有空单，应重点观察收空或减空条件，试多仍需等价格站稳。',
      border: 'border-gain/50',
      bg: 'bg-gain/10',
      text: 'text-gain',
      actions: [
        { label: '收空', className: 'border-gain text-gain bg-gain/10' },
        { label: '试多', className: 'border-gain/70 text-gain' },
      ],
    } as const
  }
  if (macd.cross === 'death') {
    return {
      bias: 'bearish',
      title: 'MACD 死叉',
      description: 'DIF 下穿 DEA，短线动能转空；若已有多单，应重点观察收多或减多条件，试空仍需等价格跌破关键位。',
      border: 'border-loss/50',
      bg: 'bg-loss/10',
      text: 'text-loss',
      actions: [
        { label: '收多', className: 'border-loss text-loss bg-loss/10' },
        { label: '试空', className: 'border-loss/70 text-loss' },
      ],
    } as const
  }
  if (macd.bias === 'bullish') {
    return {
      bias: 'bullish',
      title: '多头动能延续',
      description: '柱体仍在零轴上方，当前更偏向多头延续；未出现新的金叉，入场仍需结合 BOLL、成交量和支撑压力。',
      border: 'border-gain/30',
      bg: 'bg-gain/5',
      text: 'text-gain',
      actions: [
        { label: '偏多', className: 'border-gain text-gain' },
        { label: '空单谨慎', className: 'border-muted-foreground text-muted-foreground' },
      ],
    } as const
  }
  if (macd.bias === 'bearish') {
    return {
      bias: 'bearish',
      title: '空头动能延续',
      description: '柱体仍在零轴下方，当前更偏向空头延续；未出现新的死叉，追空仍需结合 BOLL、成交量和支撑压力。',
      border: 'border-loss/30',
      bg: 'bg-loss/5',
      text: 'text-loss',
      actions: [
        { label: '偏空', className: 'border-loss text-loss' },
        { label: '多单谨慎', className: 'border-muted-foreground text-muted-foreground' },
      ],
    } as const
  }
  return {
    bias: 'neutral',
    title: 'MACD 中性',
    description: 'DIF 与 DEA 接近，趋势信号不足，适合等待放量或关键价位突破。',
    border: 'border-border',
    bg: 'bg-card',
    text: 'text-muted-foreground',
    actions: [{ label: '等待', className: 'border-muted-foreground text-muted-foreground' }],
  } as const
}

function readLocalFavorites() {
  try {
    const saved = window.localStorage.getItem('okx-ai-favorites')
    const parsed = saved ? JSON.parse(saved) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    window.localStorage.removeItem('okx-ai-favorites')
    return []
  }
}

function writeLocalFavorites(favorites: string[]) {
  window.localStorage.setItem('okx-ai-favorites', JSON.stringify(favorites))
}
