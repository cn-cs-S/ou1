'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bot, BrainCircuit, Loader2, MessageSquare, RefreshCcw, Send, Settings2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AssetSearchSelect } from '@/components/trading/asset-search-select'
import { cn } from '@/lib/utils'
import {
  chatWithTradingAgents,
  fetchAssets,
  fetchLlmConfig,
  type TradingAgentsChatMessage,
} from '@/lib/trading-api'
import type { CryptoAsset, LlmConfig } from '@/lib/mock-data'

const DEFAULT_MESSAGES: TradingAgentsChatMessage[] = [
  {
    role: 'assistant',
    content: '我是独立 TradingAgents 工作台。选择标的后，可以直接问我多空逻辑、入场条件、止盈止损、仓位和风险；此页面不会执行下单，也不会强制调用 Skills。',
  },
]

export default function TradingAgentsPage() {
  const [config, setConfig] = useState<LlmConfig | null>(null)
  const [assets, setAssets] = useState<CryptoAsset[]>([])
  const [selectedInstId, setSelectedInstId] = useState('BTC-USDT')
  const [bar, setBar] = useState('15m')
  const [includeMarket, setIncludeMarket] = useState(true)
  const [messages, setMessages] = useState<TradingAgentsChatMessage[]>(DEFAULT_MESSAGES)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const selectedAsset = useMemo(() => assets.find((asset) => asset.instId === selectedInstId) || null, [assets, selectedInstId])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextAssets] = await Promise.all([fetchLlmConfig(), fetchAssets()])
      setConfig(nextConfig)
      setAssets(nextAssets)
      setSelectedInstId((current) => (
        nextAssets.some((asset) => asset.instId === current)
          ? current
          : nextAssets.find((asset) => asset.instId === 'BTC-USDT')?.instId || nextAssets[0]?.instId || 'BTC-USDT'
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'TradingAgents 页面加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  async function sendMessage() {
    const content = input.trim()
    if (!content || sending) return
    const userMessage: TradingAgentsChatMessage = {
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    const outbound = [...messages.filter((item) => item.role !== 'system'), userMessage].slice(-16)
    setMessages((current) => [...current, userMessage])
    setInput('')
    setSending(true)
    setError('')
    try {
      const result = await chatWithTradingAgents({
        messages: outbound.map((item) => ({ role: item.role, content: item.content })),
        instId: selectedInstId,
        includeMarket,
        bar,
      })
      setConfig(result.config)
      setMessages((current) => [...current, result.reply])
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'TradingAgents 对话失败')
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: '这次对话请求失败了。可以先检查 LLM 配置、网络或稍后重试。',
          createdAt: new Date().toISOString(),
        },
      ])
    } finally {
      setSending(false)
    }
  }

  function quickAsk(content: string) {
    setInput(content)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回主页" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <BrainCircuit className="h-4 w-4 text-primary" />
                TradingAgents 独立工作台
              </h1>
              <p className="text-xs text-muted-foreground">LLM 对话 / 实时市场上下文 / 不耦合 Skills 执行链路</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('text-xs', config?.configured ? 'border-gain text-gain' : 'border-warning text-warning')}>
              {config?.configured ? `${config.provider === 'zhipu' ? 'Zhipu GLM' : 'OpenRouter'} / ${config.model}` : 'LLM 未配置'}
            </Badge>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { window.location.href = '/ai-lab' }}>
              <Settings2 className="h-3.5 w-3.5" />
              LLM 设置
            </Button>
          </div>
        </div>
        {error && <div className="mt-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-xs text-loss">{error}</div>}
      </header>

      <div className="grid min-h-[calc(100vh-65px)] gap-3 p-3 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-3 xl:sticky xl:top-[76px] xl:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-primary" />
                对话上下文
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="block text-xs text-muted-foreground">
                标的
                <AssetSearchSelect
                  assets={assets}
                  value={selectedInstId}
                  onChange={setSelectedInstId}
                  disabled={loading}
                  className="mt-1"
                  placeholder="搜索 BTC / ETH / 合约"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                K 线周期
                <Select value={bar} onValueChange={setBar}>
                  <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['1m', '5m', '15m', '30m', '1H', '4H', '1D'].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-xs font-medium">附带实时市场上下文</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">ticker、K 线、MACD、资金异动摘要</p>
                </div>
                <Switch checked={includeMarket} onCheckedChange={setIncludeMarket} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Mini label="产品" value={selectedAsset?.instType === 'SWAP' ? '永续合约' : '现货'} />
                <Mini label="最大杠杆" value={selectedAsset?.instType === 'SWAP' ? `${selectedAsset.maxLeverage || 1}x` : '无'} />
                <Mini label="24H" value={`${Number(selectedAsset?.change24h || 0).toFixed(2)}%`} tone={Number(selectedAsset?.change24h || 0) >= 0 ? 'text-gain' : 'text-loss'} />
                <Mini label="标的数" value={`${assets.length || 0}`} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-4 w-4 text-primary" />
                快速提问
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {[
                '请比较当前做多和做空方案，并给出更推荐的一边。',
                '如果我现在已经有仓位，应该加仓、减仓、平仓还是等待？',
                '请给出入场触发条件、止盈、止损、失效条件和最大风险。',
                '请用 TradingAgents 委员会视角：多头、空头、风险经理分别怎么看？',
              ].map((item) => (
                <Button key={item} variant="outline" className="h-auto justify-start whitespace-normal px-3 py-2 text-left text-xs leading-5" onClick={() => quickAsk(item)}>
                  {item}
                </Button>
              ))}
            </CardContent>
          </Card>
        </aside>

        <section className="flex min-w-0 flex-col rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">TA 对话</p>
                <p className="text-xs text-muted-foreground">{selectedInstId} / {bar} / {includeMarket ? '实时行情上下文' : '纯 LLM 对话'}</p>
              </div>
              <Badge variant="outline" className="text-[10px]">不会执行下单</Badge>
            </div>
          </div>

          <ScrollArea className="min-h-[420px] flex-1">
            <div className="space-y-3 p-4">
              {messages.map((message, index) => (
                <ChatBubble key={`${message.createdAt || index}-${index}`} message={message} />
              ))}
              {sending && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  TradingAgents 正在阅读上下文并回复...
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="border-t border-border p-3">
            <div className="grid gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void sendMessage()
                }}
                className="min-h-24 resize-none text-sm leading-6"
                placeholder="请根据当前行情，分别给出做多和做空的理由、触发条件、止盈止损，以及更推荐的一边。"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">Ctrl + Enter 发送。回复只用于研究和测试，不代表自动执行。</p>
                <Button className="h-9 text-xs" disabled={sending || !input.trim() || !config?.configured} onClick={() => void sendMessage()}>
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  发送
                </Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function ChatBubble({ message }: { message: TradingAgentsChatMessage }) {
  const mine = message.role === 'user'
  return (
    <div className={cn('flex gap-2', mine ? 'justify-end' : 'justify-start')}>
      {!mine && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div className={cn('max-w-[min(780px,90%)] rounded-lg border px-3 py-2 text-sm leading-7', mine ? 'border-primary/40 bg-primary/15' : 'border-border bg-background/60')}>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span>{mine ? '你' : 'TradingAgents'}</span>
          {message.model && <Badge variant="outline" className="h-5 font-mono text-[10px]">{message.model}</Badge>}
          {message.latencyMs && <span>{(message.latencyMs / 1000).toFixed(1)}s</span>}
          {message.createdAt && <span>{formatTime(message.createdAt)}</span>}
        </div>
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}

function Mini({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-background/45 px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 truncate font-mono text-xs', tone)}>{value}</p>
    </div>
  )
}

function formatTime(value: string) {
  const ts = Date.parse(value)
  if (!Number.isFinite(ts)) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}
