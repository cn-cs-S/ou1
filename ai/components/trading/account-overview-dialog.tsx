'use client'

import { useState } from 'react'
import { AlertCircle, ArrowRightLeft, Bot, BriefcaseBusiness, ExternalLink, Play, Plus, RefreshCcw, ShieldCheck, Trash2, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice, formatSignedMoney } from '@/lib/format'
import type { AccountsOverview, AccountOverviewEntry, AccountSource, AutomationState } from '@/lib/mock-data'

interface AccountOverviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  overview: AccountsOverview | null
  selectedSource: AccountSource
  selectedAccountId: string
  automation: AutomationState | null
  loading: boolean
  actionPending: boolean
  onRefresh: () => void
  onSelectAccount: (entry: AccountOverviewEntry) => void
  onCreateTestAccount: (label: string, initialEquityUsdt: number) => void
  onDeleteTestAccount: (accountId: string) => void
  onToggleAutomation: (enabled: boolean) => void
  onRunAutomation: () => void
  onToggleAccountAutomation: (entry: AccountOverviewEntry, enabled: boolean) => void
  onRunAccountAutomation: (entry: AccountOverviewEntry) => void
}

export function AccountOverviewDialog({
  open,
  onOpenChange,
  overview,
  selectedSource,
  selectedAccountId,
  automation,
  loading,
  actionPending,
  onRefresh,
  onSelectAccount,
  onCreateTestAccount,
  onDeleteTestAccount,
  onToggleAutomation,
  onRunAutomation,
  onToggleAccountAutomation,
  onRunAccountAutomation,
}: AccountOverviewDialogProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [newLabel, setNewLabel] = useState('策略测试账户')
  const [newEquity, setNewEquity] = useState(100000)
  const accounts = overview?.accounts || []
  const selected = accounts.find((entry) => entry.id === selectedAccountId && entry.source === selectedSource) || accounts[0]
  const selectedAutomation = automation?.accountId === selected?.id ? automation : selected?.automation || null
  const canUseAutomation = selected?.source === 'test'
  const selectedDetailHref = `/accounts?accountId=${encodeURIComponent(selected?.id || selectedAccountId || 'default')}`

  function submitAccount() {
    if (!newLabel.trim() || newEquity <= 0) return
    onCreateTestAccount(newLabel.trim(), newEquity)
    setShowCreate(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-[min(1040px,calc(100vw-2rem))] gap-0 overflow-hidden border-border bg-card p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-primary" />
                所有账户总览
              </DialogTitle>
              <DialogDescription className="text-xs">
                真实行情统一估值；每个测试账户可独立自动接管，真实账户保持只读。
              </DialogDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                <a href={selectedDetailHref} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  详情页面
                </a>
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={actionPending} onClick={() => setShowCreate((current) => !current)}>
                <Plus className="h-3.5 w-3.5" />
                新增测试账户
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={onRefresh}>
                <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                刷新
              </Button>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(88vh-82px)]">
          <div className="space-y-4 p-5">
            {showCreate && (
              <section className="grid gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">测试账户名称</span>
                  <Input value={newLabel} maxLength={24} className="h-8 text-xs" onChange={(event) => setNewLabel(event.target.value)} />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">初始资金 USDT</span>
                  <Input type="number" min={1} value={newEquity} className="h-8 font-mono text-xs" onChange={(event) => setNewEquity(Number(event.target.value) || 0)} />
                </label>
                <Button size="sm" className="h-8 text-xs" disabled={actionPending || !newLabel.trim() || newEquity <= 0} onClick={submitAccount}>
                  创建账户
                </Button>
              </section>
            )}

            <section className="space-y-3 border-b border-border pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">自动化操作</p>
                    <p className="text-[11px] text-muted-foreground">每 30 秒依据真实市场与 AI 策略评估，包含已有人工测试持仓的买卖、做多做空、加减仓和平仓。</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn('text-[10px]', selectedAutomation?.enabled ? 'border-gain text-gain' : 'border-muted-foreground text-muted-foreground')}>
                    {selectedAutomation?.enabled ? '已接管' : '未接管'}
                  </Badge>
                  <Switch
                    checked={Boolean(selectedAutomation?.enabled)}
                    disabled={actionPending || (!selectedAutomation?.enabled && !canUseAutomation)}
                    onCheckedChange={onToggleAutomation}
                    aria-label="开启或关闭自动化操作"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/35 px-3 py-2 text-xs">
                <div className="text-muted-foreground">
                  当前账户 <span className="ml-1 font-medium text-foreground">{selected?.label || '未选择'}</span>
                  {selectedAutomation?.enabled && <span className="ml-2 text-gain">策略接管中</span>}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={actionPending || !selectedAutomation?.enabled || !canUseAutomation}
                  onClick={onRunAutomation}
                >
                  <Play className="h-3.5 w-3.5" />
                  立即运行
                </Button>
              </div>
              {selectedAutomation?.lastResult?.actions?.length ? (
                <div className="grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                  {selectedAutomation.lastResult.actions.map((action, index) => (
                    <p key={`${action.instId}-${index}`} className="rounded bg-background/40 px-2 py-1">
                      <span className="font-mono text-foreground">{action.instId}</span>
                      <span className={cn('mx-2', action.action === 'add' ? 'text-gain' : action.action === 'close' ? 'text-loss' : 'text-warning')}>{action.operation || automationActionText(action.action)}</span>
                      {action.reason || action.status}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            {loading && !overview ? (
              <div className="rounded-md border border-border px-3 py-8 text-center text-xs text-muted-foreground">正在读取账户概览...</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {accounts.map((entry) => (
                  <AccountCard
                    key={entry.id}
                    entry={entry}
                    active={entry.id === selectedAccountId && entry.source === selectedSource}
                    onSelect={() => onSelectAccount(entry)}
                    onDelete={entry.source === 'test' && entry.id !== 'default' ? () => onDeleteTestAccount(entry.id) : undefined}
                    automation={entry.id === selected?.id && automation?.accountId === entry.id ? automation : entry.automation || null}
                    onToggleAutomation={(enabled) => onToggleAccountAutomation(entry, enabled)}
                    onRunAutomation={() => onRunAccountAutomation(entry)}
                    disabled={entry.status !== 'connected' || actionPending}
                  />
                ))}
              </div>
            )}

            {!overview ? null : selected?.account ? (
              <AccountDetails entry={selected} />
            ) : (
              <section className="border-t border-border pt-4">
                <div className="flex items-start gap-2 rounded-md border border-loss/30 bg-loss/5 px-3 py-3 text-xs text-loss">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{selected?.message || '该账户当前无法读取。'}</p>
                </div>
              </section>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function AccountCard({
  entry,
  active,
  disabled,
  onSelect,
  onDelete,
  automation,
  onToggleAutomation,
  onRunAutomation,
}: {
  entry: AccountOverviewEntry
  active: boolean
  disabled: boolean
  onSelect: () => void
  onDelete?: () => void
  automation: AutomationState | null
  onToggleAutomation: (enabled: boolean) => void
  onRunAutomation: () => void
}) {
  const live = entry.source === 'live-readonly'
  const connected = entry.status === 'connected'
  const tone = live
    ? connected ? 'border-gain/50 bg-gain/5' : 'border-loss/40 bg-loss/5'
    : 'border-warning/50 bg-warning/5'
  return (
    <div className={cn('rounded-lg border p-3', tone, active && 'ring-1 ring-primary')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {live ? <ShieldCheck className="h-4 w-4 shrink-0 text-gain" /> : <BriefcaseBusiness className="h-4 w-4 shrink-0 text-warning" />}
          <span className="truncate text-sm font-medium">{entry.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className={cn('text-[10px]', statusColor(entry))}>{statusText(entry)}</Badge>
          {onDelete && (
            <Button size="icon-sm" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-loss" disabled={disabled || active || Boolean(automation?.enabled)} title={automation?.enabled ? '请先关闭该账户的自动化操作' : '删除测试账户'} onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {entry.account ? (
        <div className="mb-3 grid grid-cols-3 gap-2 text-[11px]">
          <AccountMetric label="权益" value={`$${formatMoney(entry.account.totalEqUsd)}`} />
          <AccountMetric label="浮盈" value={formatSignedMoney(entry.account.totalUpl)} tone={entry.account.totalUpl >= 0 ? 'text-gain' : 'text-loss'} />
          <AccountMetric label="收益率" value={`${entry.account.uplRatio >= 0 ? '+' : ''}${entry.account.uplRatio.toFixed(2)}%`} tone={entry.account.uplRatio >= 0 ? 'text-gain' : 'text-loss'} />
        </div>
      ) : (
        <p className="mb-3 min-h-10 text-[11px] leading-relaxed text-muted-foreground">{entry.message}</p>
      )}
      <div className="mb-2 flex items-center justify-between rounded border border-border/70 bg-background/35 px-2 py-1.5 text-[11px]">
        <span className={automation?.enabled ? 'text-gain' : 'text-muted-foreground'}>
          {live ? '真实账户只读' : automation?.enabled ? 'AI 自动接管中' : 'AI 自动接管'}
        </span>
        <div className="flex items-center gap-1.5">
          {!live && automation?.enabled && (
            <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" disabled={disabled} onClick={onRunAutomation}>
              <Play className="h-3 w-3" />
              运行
            </Button>
          )}
          <Switch
            className="scale-75"
            checked={Boolean(automation?.enabled)}
            disabled={disabled || live}
            onCheckedChange={onToggleAutomation}
            aria-label={`${entry.label}自动化操作`}
          />
        </div>
      </div>
      <Button size="sm" variant={active ? 'secondary' : 'outline'} className="h-7 w-full text-xs" disabled={disabled || active} onClick={onSelect}>
        <ArrowRightLeft className="h-3.5 w-3.5" />
        {active ? '当前使用账户' : connected ? '切换为当前账户' : '暂不可切换'}
      </Button>
    </div>
  )
}

function AccountDetails({ entry }: { entry: AccountOverviewEntry }) {
  const account = entry.account!
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{entry.label}持仓与资金</h3>
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>可用 <strong className="font-mono text-foreground">${formatMoney(account.availableUsdt)}</strong></span>
          <span>占用保证金 <strong className="font-mono text-foreground">${formatMoney(account.usedMargin)}</strong></span>
          <span>保证金占比 <strong className="font-mono text-foreground">{account.marginUsagePct.toFixed(2)}%</strong></span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{account.valuationNotice}</p>
      {account.positions.length ? (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">持仓</th>
                <th className="px-3 py-2 text-right font-medium">开仓 / 标记</th>
                <th className="px-3 py-2 text-right font-medium">强平参考</th>
                <th className="px-3 py-2 text-right font-medium">盈亏</th>
              </tr>
            </thead>
            <tbody>
              {account.positions.map((position) => (
                <tr key={position.id} className="border-t border-border/60">
                  <td className="px-3 py-2">
                    <span className="font-medium">{position.symbol}</span>
                    <span className={cn('ml-2', position.side === 'long' ? 'text-gain' : 'text-loss')}>
                      {position.side === 'long' ? '多' : '空'} {position.leverage}x
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">${formatPrice(position.entryPrice)} / ${formatPrice(position.markPrice)}</td>
                  <td className="px-3 py-2 text-right font-mono text-loss">
                    {position.liquidationPrice > 0 ? `$${formatPrice(position.liquidationPrice)}` : '-'}
                  </td>
                  <td className={cn('px-3 py-2 text-right font-mono', position.pnl >= 0 ? 'text-gain' : 'text-loss')}>
                    {formatSignedMoney(position.pnl)} ({position.pnlPercent >= 0 ? '+' : ''}{position.pnlPercent.toFixed(2)}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-border px-3 py-6 text-center text-xs text-muted-foreground">暂无持仓</div>
      )}
    </section>
  )
}

function AccountMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 font-mono', tone)}>{value}</p>
    </div>
  )
}

function automationActionText(action: string) {
  if (action === 'add') return '加仓'
  if (action === 'reduce') return '减仓'
  if (action === 'close') return '平仓'
  return '观察'
}

function statusText(entry: AccountOverviewEntry) {
  if (entry.status === 'connected') return entry.source === 'test' ? '测试可写' : '只读已连接'
  if (entry.status === 'not-configured') return '待配置'
  return '连接失败'
}

function statusColor(entry: AccountOverviewEntry) {
  if (entry.status === 'connected') return entry.source === 'test' ? 'border-warning text-warning' : 'border-gain text-gain'
  return 'border-loss text-loss'
}
