'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import type { CryptoAsset } from '@/lib/mock-data'

interface AssetSearchSelectProps {
  assets: CryptoAsset[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  limit?: number
}

type MarketFilter = 'all' | 'SPOT' | 'SWAP'

export function AssetSearchSelect({
  assets,
  value,
  onChange,
  disabled,
  placeholder = '搜索标的',
  className,
  limit = 80,
}: AssetSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<MarketFilter>('all')
  const selected = useMemo(() => assets.find((asset) => asset.instId === value), [assets, value])
  const shownAssets = useMemo(() => {
    const scoped = filter === 'all' ? assets : assets.filter((asset) => asset.instType === filter)
    return scoped.slice(0, limit)
  }, [assets, filter, limit])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('h-8 w-full justify-between px-2 font-mono text-xs', className)}
        >
          <span className="min-w-0 truncate">{selected?.instId || value || placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0">
        <Command shouldFilter>
          <div className="grid grid-cols-3 gap-1 border-b border-border p-2">
            {([
              ['all', '全部'],
              ['SPOT', '现货'],
              ['SWAP', '合约'],
            ] as Array<[MarketFilter, string]>).map(([nextFilter, label]) => (
              <button
                key={nextFilter}
                type="button"
                className={cn(
                  'h-7 rounded text-xs transition-colors',
                  filter === nextFilter ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-accent',
                )}
                onClick={() => setFilter(nextFilter)}
              >
                {label}
              </button>
            ))}
          </div>
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>
              <div className="flex flex-col items-center gap-2 py-4 text-sm text-foreground/70">
                <Search className="h-4 w-4" />
                没有找到标的
              </div>
            </CommandEmpty>
            <CommandGroup>
              {shownAssets.map((asset) => (
                <CommandItem
                  key={asset.instId}
                  value={`${asset.instId} ${asset.symbol} ${asset.instType}`}
                  onSelect={() => {
                    onChange(asset.instId)
                    setOpen(false)
                  }}
                  className="grid grid-cols-[1fr_auto] gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Check className={cn('h-3.5 w-3.5', value === asset.instId ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate font-mono text-sm font-semibold">{asset.instId}</span>
                      <Badge variant="outline" className={cn('h-5 text-[10px]', asset.instType === 'SWAP' ? 'border-warning text-warning' : 'border-primary text-primary')}>
                        {asset.instType === 'SWAP' ? `${asset.maxLeverage || 1}x` : '现货'}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate pl-5 text-[11px] text-foreground/65">{asset.symbol}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs">${formatPrice(asset.price)}</p>
                    <p className={cn('font-mono text-[11px]', asset.change24h >= 0 ? 'text-gain' : 'text-loss')}>
                      {asset.change24h >= 0 ? '+' : ''}{asset.change24h.toFixed(2)}%
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
