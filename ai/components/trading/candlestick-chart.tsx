'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
} from 'lightweight-charts'
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import { timeframes, type CandleData } from '@/lib/mock-data'

interface CandlestickChartProps {
  symbol: string
  instType: 'SPOT' | 'SWAP'
  candles: CandleData[]
  loading: boolean
  activeTimeframe: string
  onTimeframeChange: (value: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  marketSource?: string
}

interface OHLCInfo {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  change: number
  changePercent: number
}

const OKX_CHART_COLORS = {
  rise: '#16c784',
  fall: '#f04461',
  maFast: '#f3b33d',
  maMedium: '#ef5da8',
  maSlow: '#4a96e8',
  boll: '#f0ab32',
}

export function CandlestickChart({
  symbol,
  instType,
  candles,
  loading,
  activeTimeframe,
  onTimeframeChange,
  isCollapsed,
  onToggleCollapse,
  marketSource,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const overlaySeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const candlesRef = useRef<CandleData[]>(candles)
  const visibleRangeKeyRef = useRef('')
  const [ohlcInfo, setOhlcInfo] = useState<OHLCInfo | null>(null)
  const [showMA, setShowMA] = useState(true)
  const [showBoll, setShowBoll] = useState(false)

  candlesRef.current = candles

  useEffect(() => {
    if (!chartContainerRef.current || isCollapsed) return
    const container = chartContainerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: 'rgba(255, 255, 255, 0.5)',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(255,255,255,.3)', width: 1, style: 2, labelBackgroundColor: 'rgba(30,30,40,.9)' },
        horzLine: { color: 'rgba(255,255,255,.3)', width: 1, style: 2, labelBackgroundColor: 'rgba(30,30,40,.9)' },
      },
      timeScale: { borderColor: 'rgba(255,255,255,.1)', timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.1)', scaleMargins: { top: 0.1, bottom: 0.25 } },
      handleScroll: true,
      handleScale: true,
    })
    chartRef.current = chart

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: OKX_CHART_COLORS.rise,
      downColor: OKX_CHART_COLORS.fall,
      borderUpColor: OKX_CHART_COLORS.rise,
      borderDownColor: OKX_CHART_COLORS.fall,
      wickUpColor: OKX_CHART_COLORS.rise,
      wickDownColor: OKX_CHART_COLORS.fall,
    })
    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: '#3b82f6',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

    if (showMA) {
      overlaySeriesRef.current.push(
        chart.addSeries(LineSeries, { color: OKX_CHART_COLORS.maFast, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
        chart.addSeries(LineSeries, { color: OKX_CHART_COLORS.maMedium, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
        chart.addSeries(LineSeries, { color: OKX_CHART_COLORS.maSlow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      )
    }
    if (showBoll) {
      overlaySeriesRef.current.push(
        chart.addSeries(LineSeries, { color: OKX_CHART_COLORS.boll, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
        chart.addSeries(LineSeries, { color: OKX_CHART_COLORS.boll, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
        chart.addSeries(LineSeries, { color: OKX_CHART_COLORS.boll, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }),
      )
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return
      const liveCandles = candlesRef.current
      const index = liveCandles.findIndex((candle) => candle.time === Number(param.time))
      if (index >= 0) setOhlcInfo(toOhlc(liveCandles[index], liveCandles[Math.max(0, index - 1)]))
    })

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      overlaySeriesRef.current = []
    }
  }, [isCollapsed, showMA, showBoll])

  useEffect(() => {
    if (!candles.length || !candleSeriesRef.current || !volumeSeriesRef.current) return
    const candleData: CandlestickData<Time>[] = candles.map((candle) => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))
    const volumeData: HistogramData<Time>[] = candles.map((candle) => ({
      time: candle.time as Time,
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(22,199,132,.34)' : 'rgba(240,68,97,.34)',
    }))
    candleSeriesRef.current.setData(candleData)
    volumeSeriesRef.current.setData(volumeData)
    const overlays = overlaySeriesRef.current
    let index = 0
    if (showMA) {
      overlays[index++].setData(movingAverage(candles, 7))
      overlays[index++].setData(movingAverage(candles, 25))
      overlays[index++].setData(movingAverage(candles, 99))
    }
    if (showBoll) {
      const boll = bollinger(candles)
      overlays[index++].setData(boll.middle)
      overlays[index++].setData(boll.upper)
      overlays[index++].setData(boll.lower)
    }
    const last = candles.at(-1)
    if (last) setOhlcInfo(toOhlc(last, candles.at(-2) || last))
    const rangeKey = `${symbol}:${activeTimeframe}`
    if (visibleRangeKeyRef.current !== rangeKey) {
      chartRef.current?.timeScale().fitContent()
      visibleRangeKeyRef.current = rangeKey
    }
  }, [activeTimeframe, candles, showBoll, showMA, symbol])

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <span className="font-semibold">{symbol}/USDT</span>
          <Badge variant="outline" className={cn('h-5 text-[10px]', instType === 'SWAP' ? 'border-warning text-warning' : 'border-primary text-primary')}>
            {instType === 'SWAP' ? '永续 K 线' : '现货 K 线'}
          </Badge>
          {marketSource === 'live-public' && (
            <Badge variant="outline" className="h-5 border-gain text-gain text-[10px]">真实行情</Badge>
          )}
          <div className="flex flex-wrap items-center gap-0.5 bg-muted rounded p-0.5">
            {timeframes.map((timeframe) => (
              <button
                key={timeframe.value}
                onClick={() => onTimeframeChange(timeframe.value)}
                className={cn(
                  'px-2 py-1 text-[10px] rounded transition-colors',
                  activeTimeframe === timeframe.value
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {timeframe.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMA(!showMA)}
              className={cn('px-2 py-1 text-[10px] rounded', showMA ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground')}
            >
              MA
            </button>
            <button
              onClick={() => setShowBoll(!showBoll)}
              className={cn('px-2 py-1 text-[10px] rounded', showBoll ? 'bg-amber-500/20 text-amber-400' : 'text-muted-foreground')}
            >
              BOLL
            </button>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" title="指标设置">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggleCollapse} title="收起或展开 K 线">
            {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {!isCollapsed && ohlcInfo && (
        <div className="flex items-center gap-4 overflow-x-auto whitespace-nowrap px-3 py-1.5 text-[10px] border-b border-border bg-muted/30">
          <span className="text-muted-foreground">{ohlcInfo.time}</span>
          <span><span className="text-muted-foreground">开:</span> <span className="font-mono">{formatPrice(ohlcInfo.open)}</span></span>
          <span><span className="text-muted-foreground">高:</span> <span className="font-mono text-gain">{formatPrice(ohlcInfo.high)}</span></span>
          <span><span className="text-muted-foreground">低:</span> <span className="font-mono text-loss">{formatPrice(ohlcInfo.low)}</span></span>
          <span><span className="text-muted-foreground">收:</span> <span className={cn('font-mono', ohlcInfo.change >= 0 ? 'text-gain' : 'text-loss')}>{formatPrice(ohlcInfo.close)}</span></span>
          <span className={cn('font-mono', ohlcInfo.change >= 0 ? 'text-gain' : 'text-loss')}>
            {ohlcInfo.change >= 0 ? '+' : ''}{formatPrice(ohlcInfo.change)} ({ohlcInfo.changePercent >= 0 ? '+' : ''}{ohlcInfo.changePercent.toFixed(2)}%)
          </span>
          <span><span className="text-muted-foreground">量:</span> <span className="font-mono">{formatVolume(ohlcInfo.volume)}</span></span>
          {loading && <span className="text-primary">刷新中</span>}
        </div>
      )}

      {!isCollapsed && (
        <div className="relative flex-1 min-h-0">
          <div ref={chartContainerRef} className="absolute inset-0" />
          {!candles.length && <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">正在加载 K 线...</div>}
        </div>
      )}
      {isCollapsed && <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">点击展开图表</div>}
    </div>
  )
}

function toOhlc(candle: CandleData, previous: CandleData): OHLCInfo {
  const change = candle.close - previous.close
  return {
    time: new Date(candle.time * 1000).toLocaleString('zh-CN'),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    change,
    changePercent: previous.close ? (change / previous.close) * 100 : 0,
  }
}

function movingAverage(data: CandleData[], period: number) {
  return data.slice(period - 1).map((candle, offset) => ({
    time: candle.time as Time,
    value: data.slice(offset, offset + period).reduce((sum, item) => sum + item.close, 0) / period,
  }))
}

function bollinger(data: CandleData[], period = 20, multiplier = 2) {
  const middle: Array<{ time: Time; value: number }> = []
  const upper: Array<{ time: Time; value: number }> = []
  const lower: Array<{ time: Time; value: number }> = []
  data.slice(period - 1).forEach((candle, offset) => {
    const values = data.slice(offset, offset + period).map((item) => item.close)
    const average = values.reduce((sum, value) => sum + value, 0) / period
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / period)
    const time = candle.time as Time
    middle.push({ time, value: average })
    upper.push({ time, value: average + deviation * multiplier })
    lower.push({ time, value: average - deviation * multiplier })
  })
  return { middle, upper, lower }
}

function formatVolume(volume: number) {
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`
  return volume.toFixed(2)
}
