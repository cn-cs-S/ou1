'use client'

import { useState, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import { Search, Star, TrendingUp, Droplets, Sparkles, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
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
}: MarketSidebarProps) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [marketType, setMarketType] = useState<MarketType>('all')
  const [isDragging, setIsDragging] = useState(false)

  const filteredAssets = useMemo(() => {
    let filtered = assets.filter(a =>
      (marketType === 'all' || a.instType === marketType) &&
      (
      a.symbol.toLowerCase().includes(search.toLowerCase()) ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.instId.toLowerCase().includes(search.toLowerCase())
      )
    )

    switch (activeTab) {
      case 'ai':
        filtered = filtered.filter(a => a.aiScore >= 80).sort((a, b) => b.aiScore - a.aiScore)
        break
      case 'gainers':
        filtered = filtered.filter(a => a.change24h > 0).sort((a, b) => b.change24h - a.change24h)
        break
      case 'volume':
        filtered = filtered.sort((a, b) => b.volume24h - a.volume24h)
        break
      case 'favorites':
        filtered = filtered.filter(a => favorites.has(a.id))
        break
    }

    return filtered
  }, [assets, search, activeTab, marketType, favorites])

  const toggleFavorite = (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    onToggleFavorite(id)
  }

  const formatVolume = (volume: number) => {
    if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`
    if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`
    return `${(volume / 1e3).toFixed(1)}K`
  }

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    const startY = e.clientY
    const startHeight = detailHeight

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientY - startY
      const newHeight = Math.max(120, Math.min(300, startHeight + delta))
      onDetailHeightChange(newHeight)
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
      {/* Asset Detail Section */}
      {selectedAsset && (
        <>
          <div className="p-3 border-b border-border" style={{ height: detailHeight }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{selectedAsset.symbol}</span>
                <span className="text-xs text-muted-foreground">/USDT</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded',
                  selectedAsset.instType === 'SWAP' ? 'bg-warning/15 text-warning' : 'bg-primary/20 text-primary',
                )}>
                  {selectedAsset.instType === 'SWAP' ? '永续' : '现货'}
                </span>
                {selectedAsset.isNew && <span className="text-[10px] px-1.5 py-0.5 rounded bg-loss/10 text-loss">新币</span>}
              </div>
              <button
                type="button"
                aria-label={`${favorites.has(selectedAsset.id) ? 'Remove favorite' : 'Favorite'} ${selectedAsset.instId}`}
                onClick={(e) => toggleFavorite(selectedAsset.id, e)}
                className="p-1 hover:bg-accent rounded"
              >
                <Star
                  className={cn(
                    'h-4 w-4',
                    favorites.has(selectedAsset.id) ? 'fill-primary text-primary' : 'text-muted-foreground'
                  )}
                />
              </button>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  'text-2xl font-bold font-mono',
                  selectedAsset.change24h >= 0 ? 'text-gain' : 'text-loss'
                )}>
                  ${formatPrice(selectedAsset.price)}
                </span>
                <span className={cn(
                  'text-sm font-mono',
                  selectedAsset.change24h >= 0 ? 'text-gain' : 'text-loss'
                )}>
                  {selectedAsset.change24h >= 0 ? '+' : ''}{selectedAsset.change24h.toFixed(2)}%
                </span>
              </div>

              <div className={cn(
                'grid gap-2 text-xs',
                selectedAsset.instType === 'SWAP' ? 'grid-cols-3' : 'grid-cols-2',
              )}>
                <div>
                  <span className="text-muted-foreground">24H 成交量</span>
                  <p className="font-mono">${formatVolume(selectedAsset.volume24h)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">AI 评分</span>
                  <p className={cn(
                    'font-mono font-medium',
                    selectedAsset.aiScore >= 80 ? 'text-gain' : selectedAsset.aiScore >= 60 ? 'text-warning' : 'text-loss'
                  )}>
                    {selectedAsset.aiScore}/100
                  </p>
                </div>
                {selectedAsset.instType === 'SWAP' && (
                  <div>
                    <span className="text-muted-foreground">最大杠杆</span>
                    <p className="font-mono text-warning">{selectedAsset.maxLeverage || 1}x</p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">区间最高</span>
                  <p className="font-mono">${formatPrice(chartStats?.high || selectedAsset.high24h || selectedAsset.price)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">区间最低</span>
                  <p className="font-mono">${formatPrice(chartStats?.low || selectedAsset.low24h || selectedAsset.price)}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground truncate" title={selectedAsset.reason}>
                {selectedAsset.reason || '等待 AI 评分说明'}
              </p>
            </div>
          </div>

          {/* Drag Handle */}
          <div
            className={cn(
              'h-1.5 cursor-row-resize bg-border hover:bg-primary/50 transition-colors flex items-center justify-center',
              isDragging && 'bg-primary/50'
            )}
            onMouseDown={handleDragStart}
          >
            <div className="w-8 h-0.5 rounded bg-muted-foreground/30" />
          </div>
        </>
      )}

      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="搜索币种..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-7 pr-7 text-xs bg-input border-0"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 mt-2 rounded bg-muted/30 p-0.5">
          {([
            ['all', '全部市场'],
            ['SPOT', '现货'],
            ['SWAP', '永续'],
          ] as Array<[MarketType, string]>).map(([value, label]) => (
            <button
              key={value}
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

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)} className="border-b border-border">
        <TabsList className="w-full h-8 p-0 bg-transparent rounded-none justify-start gap-0">
          <TabsTrigger value="all" className="h-8 px-2 text-[10px] rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            全部
          </TabsTrigger>
          <TabsTrigger value="ai" className="h-8 px-2 text-[10px] rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Sparkles className="h-3 w-3 mr-1" />
            AI
          </TabsTrigger>
          <TabsTrigger value="gainers" className="h-8 px-2 text-[10px] rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <TrendingUp className="h-3 w-3 mr-1" />
            涨
          </TabsTrigger>
          <TabsTrigger value="volume" className="h-8 px-2 text-[10px] rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Droplets className="h-3 w-3 mr-1" />
            量
          </TabsTrigger>
          <TabsTrigger value="favorites" className="h-8 px-2 text-[10px] rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">
            <Star className="h-3 w-3 mr-1" />
            选
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_80px_60px_45px] px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border">
        <span>币种</span>
        <span className="text-right">最新价</span>
        <span className="text-right">24H</span>
        <span className="text-right">AI</span>
      </div>

      {/* Asset List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="divide-y divide-border/50">
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              role="button"
              tabIndex={0}
              aria-label={`View ${asset.instId}`}
              onClick={() => onSelectAsset(asset)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectAsset(asset)
                }
              }}
              className={cn(
                'grid grid-cols-[1fr_80px_60px_45px] items-center px-2 py-2 text-xs cursor-pointer transition-colors',
                selectedAsset?.id === asset.id
                  ? 'bg-accent/50 border-l-2 border-l-primary'
                  : 'hover:bg-accent/30'
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  aria-label={`${favorites.has(asset.id) ? 'Remove favorite' : 'Favorite'} ${asset.instId}`}
                  onClick={(e) => toggleFavorite(asset.id, e)}
                  className="shrink-0"
                >
                  <Star
                    className={cn(
                      'h-3 w-3',
                      favorites.has(asset.id) ? 'fill-primary text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground'
                    )}
                  />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="font-medium block truncate">{asset.symbol}</span>
                    <span className={cn(
                      'text-[9px] shrink-0',
                      asset.instType === 'SWAP' ? 'text-warning' : 'text-muted-foreground',
                    )}>
                      {asset.instType === 'SWAP' ? `永 ${asset.maxLeverage || 1}x` : '现'}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-right font-mono">${formatPrice(asset.price)}</span>
              <span className={cn(
                'text-right font-mono',
                asset.change24h >= 0 ? 'text-gain' : 'text-loss'
              )}>
                {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
              </span>
              <span className={cn(
                'text-right font-mono font-medium',
                asset.aiScore >= 80 ? 'text-gain' : asset.aiScore >= 60 ? 'text-warning' : 'text-muted-foreground'
              )}>
                {asset.aiScore}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
