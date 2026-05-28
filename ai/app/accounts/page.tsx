'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, ArrowLeft, BriefcaseBusiness, Clock3, History, Play, Plus, RefreshCcw, RotateCcw, Settings2, ShieldCheck, Trash2, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { createTestAccount, defaultPlanSettings, deleteTestAccount, fetchAccountDetails, resetTestAccount, runAutomationNow, setAutomation as setAccountAutomation } from '@/lib/trading-api'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice, formatSignedMoney } from '@/lib/format'
import type { AccountDetailSnapshot, AccountOperationRecord, AccountOverviewEntry, Position } from '@/lib/mock-data'

const REFRESH_MS = 30_000

export default function AccountsDetailPage() {
  const [snapshot, setSnapshot] = useState<AccountDetailSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const [newAccountLabel, setNewAccountLabel] = useState('策略测试账户')
  const [newAccountEquity, setNewAccountEquity] = useState(100000)
  const [resetEquity, setResetEquity] = useState(100000)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const next = await fetchAccountDetails()
      setSnapshot(next)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '账户详情读取失败')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(true)
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!snapshot?.accounts.length) return
    setSelectedId((current) => {
      if (current && snapshot.accounts.some((entry) => entry.id === current)) return current
      const fromUrl = new URLSearchParams(window.location.search).get('accountId')
      if (fromUrl && snapshot.accounts.some((entry) => entry.id === fromUrl)) return fromUrl
      return snapshot.accounts[0].id
    })
  }, [snapshot])

  const accounts = snapshot?.accounts || []
  const selected = accounts.find((entry) => entry.id === selectedId) || accounts[0] || null
  const operations = useMemo(() => {
    if (!snapshot || !selected) return []
    return snapshot.operations.filter((record) => record.accountId === selected.id)
  }, [snapshot, selected])

  const totals = useMemo(() => {
    const all = accounts.map((entry) => entry.account).filter(Boolean)
    return {
      equity: all.reduce((sum, account) => sum + Number(account?.totalEqUsd || 0), 0),
      upl: all.reduce((sum, account) => sum + Number(account?.totalUpl || 0), 0),
      margin: all.reduce((sum, account) => sum + Number(account?.usedMargin || 0), 0),
      positions: all.reduce((sum, account) => sum + Number(account?.positions.length || 0), 0),
    }
  }, [accounts])

  useEffect(() => {
    const initial = selected?.account?.initialEquityUsdt || selected?.account?.totalEqUsd || 100000
    setResetEquity(Math.max(1, Math.round(initial)))
  }, [selected?.id])

  async function runAccountAction(action: () => Promise<void>) {
    setActionPending(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : '账户操作失败')
    } finally {
      setActionPending(false)
    }
  }

  function automationSymbols(entry: AccountOverviewEntry) {
    const held = (entry.account?.positions || []).map((position) => position.instId)
    return [...new Set([...held, 'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BTC-USDT-SWAP', 'ETH-USDT-SWAP'])].slice(0, 12)
  }

  async function createAccount() {
    if (!newAccountLabel.trim() || newAccountEquity <= 0) return
    await runAccountAction(async () => {
      const created = await createTestAccount(newAccountLabel.trim(), newAccountEquity)
      setSelectedId(created.account.accountId || 'default')
      await load(true)
    })
  }

  async function toggleAutomation(entry: AccountOverviewEntry, enabled: boolean) {
    if (entry.source !== 'test') return
    await runAccountAction(async () => {
      await setAccountAutomation(enabled, defaultPlanSettings, entry.id, automationSymbols(entry))
      await load(true)
    })
  }

  async function runAutomation(entry: AccountOverviewEntry) {
    if (entry.source !== 'test') return
    await runAccountAction(async () => {
      await runAutomationNow(entry.id)
      await load(true)
    })
  }

  async function resetAccount(entry: AccountOverviewEntry) {
    if (entry.source !== 'test') return
    if (!window.confirm(`确认重置 ${entry.label}？当前测试持仓和盈亏会清空。`)) return
    await runAccountAction(async () => {
      await resetTestAccount(resetEquity, entry.id)
      await load(true)
    })
  }

  async function deleteAccount(entry: AccountOverviewEntry) {
    if (entry.source !== 'test' || entry.id === 'default') return
    if (!window.confirm(`确认删除 ${entry.label}？此操作会删除该测试账户文件。`)) return
    await runAccountAction(async () => {
      await deleteTestAccount(entry.id)
      setSelectedId('default')
      await load(true)
    })
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回交易终端" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-base font-semibold">
                <Wallet className="h-4 w-4 text-primary" />
                账户详情
              </h1>
              <p className="truncate text-xs text-muted-foreground">资金、持仓和操作记录每 30 秒自动刷新；真实账户保持只读展示。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="总权益" value={`$${formatMoney(totals.equity)}`} />
            <SummaryPill label="总浮盈" value={formatSignedMoney(totals.upl)} tone={totals.upl >= 0 ? 'text-gain' : 'text-loss'} />
            <SummaryPill label="持仓" value={`${totals.positions}`} />
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-xs text-loss">{error}</div>
        ) : null}
      </header>

      <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)_400px]">
        <aside className="border-b border-border bg-card/40 lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r">
          <PanelTitle icon={<BriefcaseBusiness className="h-4 w-4 text-primary" />} title="账号" meta={`${accounts.length} 个`} />
          <ScrollArea className="lg:h-[calc(100vh-118px)]">
            <div className="space-y-2 p-3">
              {accounts.map((entry) => (
                <AccountRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === selected?.id}
                  onSelect={() => setSelectedId(entry.id)}
                />
              ))}
              {!accounts.length && (
                <div className="rounded-md border border-border px-3 py-8 text-center text-xs text-muted-foreground">暂无账户</div>
              )}
              <CreateAccountBox
                label={newAccountLabel}
                equity={newAccountEquity}
                disabled={actionPending}
                onLabelChange={setNewAccountLabel}
                onEquityChange={setNewAccountEquity}
                onCreate={() => void createAccount()}
              />
            </div>
          </ScrollArea>
        </aside>

        <section className="min-w-0 border-b border-border bg-background lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r">
          <PanelTitle icon={<Activity className="h-4 w-4 text-primary" />} title="详细持仓" meta={selected?.label || '未选择'} />
          <ScrollArea className="lg:h-[calc(100vh-118px)]">
            <div className="space-y-4 p-4">
              {selected?.account ? (
                <>
                  <AccountMetrics entry={selected} />
                  {selected.account.hedge?.active ? (
                    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">{selected.account.hedge.text}</div>
                  ) : null}
                  <AccountSettings
                    entry={selected}
                    actionPending={actionPending}
                    resetEquity={resetEquity}
                    onResetEquityChange={setResetEquity}
                    onToggleAutomation={(enabled) => void toggleAutomation(selected, enabled)}
                    onRunAutomation={() => void runAutomation(selected)}
                    onResetAccount={() => void resetAccount(selected)}
                    onDeleteAccount={() => void deleteAccount(selected)}
                  />
                  <PositionsBlock positions={selected.account.positions} />
                </>
              ) : (
                <div className="rounded-md border border-border px-3 py-10 text-center text-xs text-muted-foreground">
                  {selected?.message || '该账户当前没有可展示的明细'}
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        <aside className="bg-card/30 lg:min-h-[calc(100vh-65px)]">
          <PanelTitle icon={<History className="h-4 w-4 text-primary" />} title="操作记录" meta={selected ? `${operations.length} 条` : '--'} />
          <div className="flex flex-wrap gap-2 border-b border-border px-4 pb-3 text-[11px]">
            <Badge className="border-primary/60 bg-primary/10 text-primary" variant="outline">AI 操作</Badge>
            <Badge className="border-sky-400/50 bg-sky-400/10 text-sky-300" variant="outline">手动</Badge>
            <Badge className="border-muted-foreground/40 bg-muted/30 text-muted-foreground" variant="outline">系统</Badge>
          </div>
          <ScrollArea className="lg:h-[calc(100vh-154px)]">
            <div className="space-y-2 p-3">
              {operations.map((record) => (
                <OperationRow key={record.id} record={record} />
              ))}
              {!operations.length && (
                <div className="rounded-md border border-border px-3 py-10 text-center text-xs text-muted-foreground">
                  当前账号暂无操作记录。执行计划、手动调仓或开启自动化后会显示在这里。
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </main>
  )
}

function AccountRow({ entry, active, onSelect }: { entry: AccountOverviewEntry; active: boolean; onSelect: () => void }) {
  const account = entry.account
  const isLive = entry.source === 'live-readonly'
  const automationEnabled = Boolean(entry.automation?.enabled)
  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-md border border-border bg-background/55 p-3 text-left transition hover:border-primary/50 hover:bg-accent/40',
        active && 'border-primary/70 bg-primary/10'
      )}
      onClick={onSelect}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isLive ? <ShieldCheck className="h-4 w-4 shrink-0 text-gain" /> : <BriefcaseBusiness className="h-4 w-4 shrink-0 text-warning" />}
          <span className="truncate text-sm font-medium">{entry.label}</span>
        </div>
        <Badge variant="outline" className={cn('shrink-0 text-[10px]', isLive ? 'border-gain/60 text-gain' : 'border-warning/60 text-warning')}>
          {isLive ? '真实只读' : '测试'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <MiniMetric label="权益" value={account ? `$${formatMoney(account.totalEqUsd)}` : '--'} />
        <MiniMetric label="浮盈" value={account ? formatSignedMoney(account.totalUpl) : '--'} tone={account && account.totalUpl >= 0 ? 'text-gain' : 'text-loss'} />
        <MiniMetric label="可用" value={account ? `$${formatMoney(account.availableUsdt)}` : '--'} />
        <MiniMetric label="持仓" value={account ? `${account.positions.length}` : '--'} />
      </div>
      <Separator className="my-2" />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{entry.status === 'connected' ? '已连接' : entry.status === 'not-configured' ? '待配置' : '不可用'}</span>
        <span className={automationEnabled ? 'text-gain' : ''}>{automationEnabled ? '自动化开启' : isLive ? '只读' : '自动化关闭'}</span>
      </div>
    </button>
  )
}

function CreateAccountBox({
  label,
  equity,
  disabled,
  onLabelChange,
  onEquityChange,
  onCreate,
}: {
  label: string
  equity: number
  disabled: boolean
  onLabelChange: (value: string) => void
  onEquityChange: (value: number) => void
  onCreate: () => void
}) {
  return (
    <section className="rounded-md border border-primary/25 bg-primary/5 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Plus className="h-4 w-4 text-primary" />
        新增测试账号
      </div>
      <div className="space-y-2">
        <label className="block text-[11px] text-muted-foreground">
          账号名称
          <Input value={label} maxLength={24} className="mt-1 h-8 text-xs" disabled={disabled} onChange={(event) => onLabelChange(event.target.value)} />
        </label>
        <label className="block text-[11px] text-muted-foreground">
          初始资金 USDT
          <Input
            type="number"
            min={1}
            value={equity}
            className="mt-1 h-8 font-mono text-xs"
            disabled={disabled}
            onChange={(event) => onEquityChange(Number(event.target.value) || 0)}
          />
        </label>
        <Button size="sm" className="h-8 w-full text-xs" disabled={disabled || !label.trim() || equity <= 0} onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" />
          创建测试账号
        </Button>
      </div>
    </section>
  )
}

function AccountMetrics({ entry }: { entry: AccountOverviewEntry }) {
  const account = entry.account!
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{entry.label}</h2>
          <p className="text-xs text-muted-foreground">{account.valuationNotice || '持仓使用真实市场价格在本地估值。'}</p>
        </div>
        <Badge variant="outline" className={cn(entry.source === 'test' ? 'border-warning text-warning' : 'border-gain text-gain')}>
          {entry.source === 'test' ? '测试账户' : '真实只读'}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="账户权益" value={`$${formatMoney(account.totalEqUsd)}`} />
        <MetricCard label="可用 USDT" value={`$${formatMoney(account.availableUsdt)}`} />
        <MetricCard label="浮动盈亏" value={formatSignedMoney(account.totalUpl)} tone={account.totalUpl >= 0 ? 'text-gain' : 'text-loss'} />
        <MetricCard label="收益率" value={`${account.uplRatio >= 0 ? '+' : ''}${account.uplRatio.toFixed(2)}%`} tone={account.uplRatio >= 0 ? 'text-gain' : 'text-loss'} />
        <MetricCard label="占用保证金" value={`$${formatMoney(account.usedMargin)}`} />
        <MetricCard label="保证金占比" value={`${account.marginUsagePct.toFixed(2)}%`} tone={account.marginUsagePct > 60 ? 'text-loss' : account.marginUsagePct > 35 ? 'text-warning' : ''} />
        <MetricCard label="初始资金" value={account.initialEquityUsdt ? `$${formatMoney(account.initialEquityUsdt)}` : '--'} />
        <MetricCard label="已实现盈亏" value={account.realizedPnl !== undefined ? formatSignedMoney(account.realizedPnl) : '--'} tone={(account.realizedPnl || 0) >= 0 ? 'text-gain' : 'text-loss'} />
      </div>
    </div>
  )
}

function AccountSettings({
  entry,
  actionPending,
  resetEquity,
  onResetEquityChange,
  onToggleAutomation,
  onRunAutomation,
  onResetAccount,
  onDeleteAccount,
}: {
  entry: AccountOverviewEntry
  actionPending: boolean
  resetEquity: number
  onResetEquityChange: (value: number) => void
  onToggleAutomation: (enabled: boolean) => void
  onRunAutomation: () => void
  onResetAccount: () => void
  onDeleteAccount: () => void
}) {
  const account = entry.account!
  const isTest = entry.source === 'test'
  const automation = entry.automation || null
  return (
    <section className="rounded-md border border-border bg-card/45 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-medium">账户设置</h3>
            <p className="text-[11px] text-muted-foreground">账户管理、自动化接管和测试账户维护集中在这里。</p>
          </div>
        </div>
        <Badge variant="outline" className={cn(isTest ? 'border-warning text-warning' : 'border-gain text-gain')}>
          {isTest ? '本地测试可写' : '真实账户只读'}
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <MiniMetric label="账户 ID" value={entry.id} />
        <MiniMetric label="估值来源" value={account.valuationSource || '--'} />
        <MiniMetric label="可用资金" value={`$${formatMoney(account.availableUsdt)}`} />
        <MiniMetric label="占用保证金" value={`$${formatMoney(account.usedMargin)}`} />
      </div>

      <Separator className="my-3" />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-md border border-border bg-background/45 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium">AI 自动化接管</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                开启后默认管理当前持仓并补充主流币种观察池，自动操作仍按 30 秒节流执行。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={cn('text-[10px]', automation?.enabled ? 'border-gain text-gain' : 'border-muted-foreground text-muted-foreground')}>
                {automation?.enabled ? '已开启' : '已关闭'}
              </Badge>
              <Switch checked={Boolean(automation?.enabled)} disabled={!isTest || actionPending} onCheckedChange={onToggleAutomation} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>上次运行：{automation?.lastRunAt ? formatTime(automation.lastRunAt) : '--'}</span>
            <span>下次运行：{automation?.nextRunAt ? formatTime(automation.nextRunAt) : '--'}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!isTest || actionPending || !automation?.enabled} onClick={onRunAutomation}>
              <Play className="h-3.5 w-3.5" />
              立即运行
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border bg-background/45 px-3 py-2">
          <p className="mb-2 text-xs font-medium">测试账户维护</p>
          {isTest ? (
            <div className="space-y-2">
              <label className="block text-[11px] text-muted-foreground">
                重置后初始资金 USDT
                <Input
                  type="number"
                  min={1}
                  value={resetEquity}
                  className="mt-1 h-8 font-mono text-xs"
                  disabled={actionPending}
                  onChange={(event) => onResetEquityChange(Number(event.target.value) || 0)}
                />
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" disabled={actionPending || resetEquity <= 0} onClick={onResetAccount}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置
                </Button>
                <Button size="sm" variant="outline" className="h-8 flex-1 text-xs text-loss" disabled={actionPending || entry.id === 'default' || Boolean(automation?.enabled)} onClick={onDeleteAccount}>
                  <Trash2 className="h-3.5 w-3.5" />
                  删除
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">真实账户目前只读展示。接入真实交易 API 后，可在这里扩展密钥状态、权限、风险限额和自动化授权。</p>
          )}
        </div>
      </div>
    </section>
  )
}

function PositionsBlock({ positions }: { positions: Position[] }) {
  if (!positions.length) {
    return <div className="rounded-md border border-border px-3 py-10 text-center text-xs text-muted-foreground">暂无持仓</div>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[1120px] text-xs">
        <thead className="bg-muted/35 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">品种</th>
            <th className="px-3 py-2 text-right font-medium">持仓量</th>
            <th className="px-3 py-2 text-right font-medium">标记价格</th>
            <th className="px-3 py-2 text-right font-medium">开仓均价</th>
            <th className="px-3 py-2 text-right font-medium">预估强平价</th>
            <th className="px-3 py-2 text-right font-medium">盈亏平衡价</th>
            <th className="px-3 py-2 text-right font-medium">浮动收益</th>
            <th className="px-3 py-2 text-right font-medium">维持保证金率</th>
            <th className="px-3 py-2 text-right font-medium">保证金</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.id} className="border-t border-border/70 align-top">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{position.instId}</span>
                  <Badge variant="outline" className={cn('text-[10px]', position.side === 'long' ? 'border-gain/60 text-gain' : 'border-loss/60 text-loss')}>
                    {position.side === 'long' ? '多' : '空'} {position.leverage}x
                  </Badge>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{position.type === 'spot' ? '现货' : '永续合约'} · {position.aiSuggestion || '暂无 AI 持仓建议'}</div>
              </td>
              <td className={cn('px-3 py-2 text-right font-mono', position.side === 'short' ? 'text-loss' : 'text-gain')}>
                {formatPositionHolding(position)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                ${formatPrice(position.markPrice)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                ${formatPrice(position.entryPrice)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-loss">
                {position.liquidationPrice > 0 ? `$${formatPrice(position.liquidationPrice)}` : '--'}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {position.breakEvenPrice > 0 ? `$${formatPrice(position.breakEvenPrice)}` : '--'}
              </td>
              <td className={cn('px-3 py-2 text-right font-mono', position.pnl >= 0 ? 'text-gain' : 'text-loss')}>
                <div>{formatSignedMoney(position.pnl)}</div>
                <div>{position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%</div>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                <div>{formatMarginRatio(position)}</div>
                {position.maintenanceMarginRatePct ? (
                  <div className="text-[11px] text-muted-foreground">MMR {position.maintenanceMarginRatePct.toFixed(2)}%</div>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                <div>{position.margin !== undefined ? `$${formatMoney(position.margin)}` : '--'}</div>
                <div className="text-[11px] text-muted-foreground">{formatMarginMode(position.marginMode, position.type)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OperationRow({ record }: { record: AccountOperationRecord }) {
  return (
    <div className="rounded-md border border-border bg-background/55 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('text-[10px]', sourceClass(record.source))}>
              {record.source === 'ai' ? 'AI 操作' : record.source === 'manual' ? '手动' : '系统'}
            </Badge>
            {record.dryRun ? <Badge variant="outline" className="border-warning/60 text-warning">演练</Badge> : null}
            <span className="truncate text-sm font-medium">{record.instId || eventLabel(record.event)}</span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3 className="h-3 w-3" />
            {formatTime(record.ts)}
          </p>
        </div>
        <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusClass(record.status || ''))}>{statusText(record.status || '')}</Badge>
      </div>
      <div className="text-xs">
        <span className={cn(record.action === 'add' || record.action === 'buy' ? 'text-gain' : record.action === 'close' || record.action === 'reduce' || record.action === 'sell' ? 'text-loss' : 'text-muted-foreground')}>
          {record.operation || eventLabel(record.event)}
        </span>
        {record.reason ? <span className="ml-2 text-muted-foreground">{record.reason}</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <MiniMetric label="名义价值" value={record.notionalUsd !== null && record.notionalUsd !== undefined ? `$${formatMoney(record.notionalUsd)}` : '--'} />
        <MiniMetric label="参考价格" value={record.referencePrice !== null && record.referencePrice !== undefined ? `$${formatPrice(record.referencePrice)}` : '--'} />
        <MiniMetric label="手续费" value={record.executionFee !== null && record.executionFee !== undefined ? `$${formatMoney(record.executionFee)}` : '--'} />
        <MiniMetric label="实现盈亏" value={record.realizedPnl !== null && record.realizedPnl !== undefined ? formatSignedMoney(record.realizedPnl) : '--'} tone={(record.realizedPnl || 0) >= 0 ? 'text-gain' : 'text-loss'} />
      </div>
    </div>
  )
}

function PanelTitle({ icon, title, meta }: { icon: ReactNode; title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">{icon}{title}</div>
      <span className="text-xs text-muted-foreground">{meta}</span>
    </div>
  )
}

function SummaryPill({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-1.5 text-xs">
      <span className="mr-2 text-muted-foreground">{label}</span>
      <span className={cn('font-mono', tone)}>{value}</span>
    </div>
  )
}

function MetricCard({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-card/65 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-mono text-sm font-medium', tone)}>{value}</p>
    </div>
  )
}

function MiniMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn('truncate font-mono', tone)}>{value}</p>
    </div>
  )
}

function sourceClass(source: AccountOperationRecord['source']) {
  if (source === 'ai') return 'border-primary/60 bg-primary/10 text-primary'
  if (source === 'manual') return 'border-sky-400/50 bg-sky-400/10 text-sky-300'
  return 'border-muted-foreground/40 bg-muted/30 text-muted-foreground'
}

function statusClass(status: string) {
  if (status.includes('applied') || status === 'completed') return 'border-gain/60 text-gain'
  if (status.includes('dry') || status.includes('held') || status.includes('skipped')) return 'border-warning/60 text-warning'
  if (status.includes('fail')) return 'border-loss/60 text-loss'
  return 'border-muted-foreground/40 text-muted-foreground'
}

function statusText(status: string) {
  if (status === 'applied-to-test-account') return '已执行'
  if (status === 'dry-run') return '演练'
  if (status === 'held') return '持有'
  if (status === 'skipped') return '跳过'
  if (status === 'failed') return '失败'
  if (status === 'completed') return '完成'
  return status || '记录'
}

function eventLabel(event: string) {
  const labels: Record<string, string> = {
    autopilot_enabled: '开启自动化',
    autopilot_disabled: '关闭自动化',
    autopilot_run: '自动化运行',
    autopilot_failed: '自动化失败',
    automation_existing_positions_only: '仅管理现有持仓',
    automation_portfolio_reconciled: 'AI 组合调仓',
    test_account_created: '创建测试账户',
    test_account_deleted: '删除测试账户',
    test_account_reset: '重置测试账户',
    test_position_adjusted: '手动调仓',
    test_positions_updated: '执行组合计划',
  }
  return labels[event] || event
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function formatPositionSize(value: number) {
  if (!Number.isFinite(value)) return '--'
  if (value >= 1000) return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  if (value >= 1) return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

function formatPositionHolding(position: Position) {
  const sign = position.side === 'short' ? '-' : '+'
  const base = position.type === 'spot'
    ? `${formatPositionSize(position.size)} ${position.symbol}`
    : `${formatMoney(Math.abs(position.notionalUsd || 0))} USDT`
  return `${sign}${base}`
}

function formatMarginRatio(position: Position) {
  if (position.type === 'spot') return '--'
  const ratio = Number(position.maintenanceMarginRatioPct || 0)
  if (!Number.isFinite(ratio) || ratio <= 0) return '--'
  return `${ratio.toFixed(2)}%`
}

function formatMarginMode(value?: string, type?: Position['type']) {
  if (type === 'spot') return '现货'
  const mode = String(value || '').toLowerCase()
  if (mode === 'cross') return '全仓'
  if (mode === 'isolated') return '逐仓'
  if (mode === 'cash') return '现货'
  return value || '--'
}
