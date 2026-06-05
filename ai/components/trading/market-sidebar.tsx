'use client'

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Droplets, Search, Sparkles, Star, TrendingUp, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import type { CryptoAsset } from '@/lib/mock-data'

interface MarketSidebarProps {
  assets: CryptoAsset[]
  selectedAsset: CryptoAsset | null
  onSelectAsset: (asset: CryptoAsset) => void
  detailHeight: number
  onDetailHeightChange: (height: number) => void
  favorites: Set<string>
  onToggleFavorite: (instId: string) => void
  showAiFields?: boolean
  chartStats?: {
    high?: number
    low?: number
  }
}

type FilterTab = 'all' | 'ai' | 'gainers' | 'volume' | 'favorites'
type MarketType = 'all' | 'SPOT' | 'SWAP'

export function MarketSidebar({
  assets,
  selectedAsset,
  onSelectAsset,
  detailHeight,
  onDetailHeightChange,
  chartStats,
  favorites,
  onToggleFavorite,
  showAiFields = true,
}: MarketSidebarProps) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [marketType, setMarketType] = useState<MarketType>('all')
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!showAiFields && activeTab === 'ai') setActiveTab('all')
  }, [activeTab, showAiFields])

  const filteredAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    let filtered = assets.filter((asset) => {
      const matchesType = marketType === 'all' || asset.instType === marketType
      const matchesSearch = !keyword
        || asset.symbol.toLowerCase().includes(keyword)
        || asset.name.toLowerCase().includes(keyword)
        || asset.instId.toLowerCase().includes(keyword)
      return matchesType && matchesSearch
    })

    if (activeTab === 'ai' && showAiFields) filtered = filtered.filter((asset) => asset.aiScore >= 80).sort((a, b) => b.aiScore - a.aiScore)
    if (activeTab === 'gainers') filtered = filtered.filter((asset) => asset.change24h > 0).sort((a, b) => b.change24h - a.change24h)
    if (activeTab === 'volume') filtered = filtered.sort((a, b) => b.volume24h - a.volume24h)
    if (activeTab === 'favorites') filtered = filtered.filter((asset) => isFavorite(asset, favorites))

    return filtered
  }, [activeTab, assets, favorites, marketType, search, showAiFields])

  function toggleFavorite(asset: CryptoAsset, event: ReactMouseEvent) {
    event.stopPropagation()
    onToggleFavorite(asset.id)
  }

  function handleDragStart(event: ReactMouseEvent) {
    event.preventDefault()
    setIsDragging(true)
    const startY = event.clientY
    const startHeight = detailHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      onDetailHeightChange(Math.max(120, Math.min(320, startHeight + delta)))
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-r border-border bg-sidebar">
      {selectedAsset && (
        <>
          <div className="border-b border-border p-3" style={{ height: detailHeight }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-lg font-bold">{selectedAsset.symbol}</span>
                <span className="text-xs text-muted-foreground">/USDT</span>
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  selectedAsset.instType === 'SWAP' ? 'bg-warning/15 text-warning' : 'bg-primary/20 text-primary',
                )}>
                  {selectedAsset.instType === 'SWAP' ? '永续' : '现货'}
                </span>
                {selectedAsset.isNew && <span className="rounded bg-loss/10 px-1.5 py-0.5 text-[10px] text-loss">新币</span>}
              </div>
              <button
                type="button"
                aria-label={`${isFavorite(selectedAsset, favorites) ? '取消收藏' : '收藏'} ${selectedAsset.instId}`}
                onClick={(event) => toggleFavorite(selectedAsset, event)}
                className="rounded p-1 hover:bg-accent"
              >
                <Star className={cn('h-4 w-4', isFavorite(selectedAsset, favorites) ? 'fill-primary text-primary' : 'text-muted-foreground')} />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className={cn('font-mono text-2xl font-bold', selectedAsset.change24h >= 0 ? 'text-gain' : 'text-loss')}>
                  ${formatPrice(selectedAsset.price)}
                </span>
                <span className={cn('font-mono text-sm', selectedAsset.change24h >= 0 ? 'text-gain' : 'text-loss')}>
                  {selectedAsset.change24h >= 0 ? '+' : ''}{selectedAsset.change24h.toFixed(2)}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <DetailMetric label="24H 成交量" value={`$${formatVolume(selectedAsset.volume24h)}`} />
                {selectedAsset.instType === 'SWAP' && <DetailMetric label="最大杠杆" value={`${selectedAsset.maxLeverage || 1}x`} tone="text-warning" />}
                <DetailMetric label="区间最高" value={`$${formatPrice(chartStats?.high || selectedAsset.high24h || selectedAsset.price)}`} tone="text-gain" />
                <DetailMetric label="区间最低" value={`$${formatPrice(chartStats?.low || selectedAsset.low24h || selectedAsset.price)}`} tone="text-loss" />
                {showAiFields && <DetailMetric label="AI 评分" value={`${selectedAsset.aiScore}/100`} tone={selectedAsset.aiScore >= 80 ? 'text-gain' : selectedAsset.aiScore >= 60 ? 'text-warning' : 'text-loss'} />}
              </div>
              {showAiFields && (
                <p className="truncate text-[10px] text-muted-foreground" title={selectedAsset.reason}>
                  {selectedAsset.reason || '等待 AI 评分说明'}
                </p>
              )}
            </div>
          </div>

          <div
            className={cn(
              'flex h-1.5 cursor-row-resize items-center justify-center bg-border transition-colors hover:bg-primary/50',
              isDragging && 'bg-primary/50',
            )}
            onMouseDown={handleDragStart}
          >
            <div className="h-0.5 w-8 rounded bg-muted-foreground/30" />
          </div>
        </>
      )}

      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索币种..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 border-0 bg-input pl-7 pr-7 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded bg-muted/30 p-0.5">
          {([
            ['all', '全部市场'],
            ['SPOT', '现货'],
            ['SWAP', '永续'],
          ] as Array<[MarketType, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMarketType(value)}
              className={cn(
                'h-6 rounded text-[10px] transition-colors',
                marketType === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FilterTab)} className="border-b border-border">
        <TabsList className="h-8 w-full justify-start gap-0 rounded-none bg-transparent p-0">
          <TabsTrigger value="all" className="h-8 rounded-none px-2 text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent">
            全部
          </TabsTrigger>
          {showAiFields && (
            <TabsTrigger value="ai" className="h-8 rounded-none px-2 text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent">
              <Sparkles className="mr-1 h-3 w-3" />
              AI
            </TabsTrigger>
          )}
          <TabsTrigger value="gainers" className="h-8 rounded-none px-2 text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent">
            <TrendingUp className="mr-1 h-3 w-3" />
            涨幅
          </TabsTrigger>
          <TabsTrigger value="volume" className="h-8 rounded-none px-2 text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent">
            <Droplets className="mr-1 h-3 w-3" />
            成交
          </TabsTrigger>
          <TabsTrigger value="favorites" className="h-8 rounded-none px-2 text-[10px] data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:bg-transparent">
            <Star className="mr-1 h-3 w-3" />
            自选
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className={cn('grid border-b border-border px-2 py-1.5 text-[10px] text-muted-foreground', showAiFields ? 'grid-cols-[1fr_80px_60px_45px]' : 'grid-cols-[1fr_84px_64px]')}>
        <span>币种</span>
        <span className="text-right">最新价</span>
        <span className="text-right">24H</span>
        {showAiFields && <span className="text-right">AI</span>}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y divide-border/50">
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              role="button"
              tabIndex={0}
              aria-label={`查看 ${asset.instId}`}
              onClick={() => onSelectAsset(asset)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectAsset(asset)
                }
              }}
              className={cn(
                'grid cursor-pointer items-center px-2 py-2 text-xs transition-colors',
                showAiFields ? 'grid-cols-[1fr_80px_60px_45px]' : 'grid-cols-[1fr_84px_64px]',
                selectedAsset?.id === asset.id ? 'border-l-2 border-l-primary bg-accent/50' : 'hover:bg-accent/30',
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label={`${isFavorite(asset, favorites) ? '取消收藏' : '收藏'} ${asset.instId}`}
                  onClick={(event) => toggleFavorite(asset, event)}
                  className="shrink-0"
                >
                  <Star className={cn('h-3 w-3', isFavorite(asset, favorites) ? 'fill-primary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground')} />
                </button>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1">
                    <span className="block truncate font-medium">{asset.symbol}</span>
                    <span className={cn('shrink-0 text-[9px]', asset.instType === 'SWAP' ? 'text-warning' : 'text-muted-foreground')}>
                      {asset.instType === 'SWAP' ? `永 ${asset.maxLeverage || 1}x` : '现'}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-right font-mono">${formatPrice(asset.price)}</span>
              <span className={cn('text-right font-mono', asset.change24h >= 0 ? 'text-gain' : 'text-loss')}>
                {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
              </span>
              {showAiFields && (
                <span className={cn('text-right font-mono font-medium', asset.aiScore >= 80 ? 'text-gain' : asset.aiScore >= 60 ? 'text-warning' : 'text-muted-foreground')}>
                  {asset.aiScore}
                </span>
              )}
            </div>
          ))}
          {!filteredAssets.length && (
            <div className="px-3 py-10 text-center text-xs text-muted-foreground">
              没有匹配的币种
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function DetailMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className={cn('font-mono', tone)}>{value}</p>
    </div>
  )
}

function isFavorite(asset: CryptoAsset, favorites: Set<string>) {
  return favorites.has(asset.id) || favorites.has(asset.instId)
}

function formatVolume(volume: number) {
  if (Math.abs(volume) >= 1e9) return `${(volume / 1e9).toFixed(1)}B`
  if (Math.abs(volume) >= 1e6) return `${(volume / 1e6).toFixed(1)}M`
  if (Math.abs(volume) >= 1e3) return `${(volume / 1e3).toFixed(1)}K`
  return volume.toFixed(2)
}
