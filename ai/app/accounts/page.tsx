'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Bot, BriefcaseBusiness, ChevronDown, ChevronUp, History, Plus, RefreshCcw, RotateCcw, Save, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  createTestAccount,
  defaultPlanSettings,
  deleteTestAccount,
  fetchAccountDetails,
  resetTestAccount,
  runAutomationNow,
  setAutomation as setAccountAutomation,
} from '@/lib/trading-api'
import { cn } from '@/lib/utils'
import { formatMoney, formatPrice, formatSignedMoney } from '@/lib/format'
import type { AccountDetailSnapshot, AccountOperationRecord, AccountOverviewEntry, PlanSettings, Position } from '@/lib/mock-data'

const REFRESH_MS = 1_000
const OKX_LEVERAGE_OPTIONS = [1, 2, 3, 5, 10, 20, 50]
const MIN_LEVERAGE_OPTIONS = [5, 10, 20, 50]
const LEGACY_DEFAULT_SYMBOL_POOL = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BTC-USDT-SWAP', 'ETH-USDT-SWAP']
type AccountTab = 'positions' | 'trades' | 'ai'

export default function AccountsDetailPage() {
  const [snapshot, setSnapshot] = useState<AccountDetailSnapshot | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [tabs, setTabs] = useState<Record<string, AccountTab>>({})
  const [settingsEntry, setSettingsEntry] = useState<AccountOverviewEntry | null>(null)
  const [aiEntry, setAiEntry] = useState<AccountOverviewEntry | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newAccountLabel, setNewAccountLabel] = useState('策略测试账户')
  const [newAccountEquity, setNewAccountEquity] = useState(1000000)
  const [resetEquity, setResetEquity] = useState(1000000)
  const [loading, setLoading] = useState(true)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState('')
  const loadingRef = useRef(false)

  const accounts = snapshot?.accounts || []
  const operations = snapshot?.operations || []
  const expandableAccountIds = accounts.filter((entry) => entry.account?.positions.length).map((entry) => entry.id)
  const allExpanded = expandableAccountIds.length > 0 && expandableAccountIds.every((id) => expanded.has(id))

  const totals = useMemo(() => {
    const realAccounts = accounts.map((entry) => entry.account).filter(Boolean)
    const equity = realAccounts.reduce((sum, account) => sum + Number(account?.totalEqUsd || 0), 0)
    const upl = realAccounts.reduce((sum, account) => sum + Number(account?.totalUpl || 0), 0)
    const positions = realAccounts.reduce((sum, account) => sum + Number(account?.positions.length || 0), 0)
    return { equity, upl, positions, ratio: equity ? upl / equity * 100 : 0 }
  }, [accounts])

  const load = useCallback(async (quiet = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!quiet) setLoading(true)
    try {
      const next = await fetchAccountDetails()
      setSnapshot(next)
      setError('')
      setExpanded((current) => {
        if (!current.size) return new Set()
        const activeWithPositions = new Set(next.accounts.filter((entry) => entry.account?.positions.length).map((entry) => entry.id))
        return new Set([...current].filter((id) => activeWithPositions.has(id)))
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '账户详情读取失败')
    } finally {
      loadingRef.current = false
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

  function toggleExpanded(accountId: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(expandableAccountIds))
  }

  function setAccountTab(accountId: string, tab: AccountTab) {
    setTabs((current) => ({ ...current, [accountId]: tab }))
  }

  function automationSymbols(entry: AccountOverviewEntry, settings = normalizeAiSettings(entry.automation?.settings, entry.account)) {
    const explicit = parseSymbolPool(settings.symbols)
    if (explicit.length) return explicit
    const held = (entry.account?.positions || []).map((position) => position.instId)
    return [...new Set(held)].slice(0, 12)
  }

  async function createAccount() {
    if (!newAccountLabel.trim() || newAccountEquity <= 0) return
    await runAccountAction(async () => {
      await createTestAccount(newAccountLabel.trim(), newAccountEquity)
      setCreateOpen(false)
      await load(true)
    })
  }

  async function saveAiSettings(entry: AccountOverviewEntry, settings: PlanSettings, enabled = Boolean(entry.automation?.enabled)) {
    if (entry.source !== 'test') return
    await runAccountAction(async () => {
      const normalized = normalizeAiSettings(settings, entry.account)
      await setAccountAutomation(enabled, normalized, entry.id, automationSymbols(entry, normalized))
      await load(true)
    })
  }

  async function toggleAutomation(entry: AccountOverviewEntry, enabled: boolean) {
    if (entry.source !== 'test') return
    await saveAiSettings(entry, normalizeAiSettings(entry.automation?.settings, entry.account), enabled)
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
      setSettingsEntry(null)
      await load(true)
    })
  }

  async function removeAccount(entry: AccountOverviewEntry) {
    if (entry.source !== 'test' || entry.id === 'default') return
    if (!window.confirm(`确认删除 ${entry.label}？`)) return
    await runAccountAction(async () => {
      await deleteTestAccount(entry.id)
      setSettingsEntry(null)
      await load(true)
    })
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button size="icon-sm" variant="outline" className="h-8 w-8" title="返回首页" onClick={() => { window.location.href = '/' }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <Wallet className="h-4 w-4 text-primary" />
                账户管理
              </h1>
              <p className="truncate text-sm text-foreground/70">独立账户看板，每秒刷新权益、浮盈、收益率和持仓。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryPill label="总权益" value={`$${formatMoney(totals.equity)}`} />
            <SummaryPill label="总浮盈" value={formatSignedMoney(totals.upl)} tone={totals.upl >= 0 ? 'text-gain' : 'text-loss'} />
            <SummaryPill label="收益率" value={`${totals.ratio >= 0 ? '+' : ''}${totals.ratio.toFixed(2)}%`} tone={totals.ratio >= 0 ? 'text-gain' : 'text-loss'} />
            <SummaryPill label="持仓" value={`${totals.positions}`} />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={toggleAll}>
              {allExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {allExpanded ? '收起全部' : '展开全部'}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={loading} onClick={() => void load()}>
              <RefreshCcw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              刷新
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              添加测试账户
            </Button>
          </div>
        </div>
        {error && <div className="mt-3 rounded-md border border-loss/50 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</div>}
      </header>

      <section className="grid min-h-[calc(100vh-92px)] gap-4 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 md:p-4">
        {accounts.map((entry) => (
          <AccountColumn
            key={entry.id}
            entry={entry}
            expanded={expanded.has(entry.id)}
            activeTab={tabs[entry.id] || 'positions'}
            operations={operations.filter((record) => record.accountId === entry.id)}
            actionPending={actionPending}
            onToggleExpanded={() => toggleExpanded(entry.id)}
            onTabChange={(tab) => setAccountTab(entry.id, tab)}
            onOpenSettings={() => {
              setResetEquity(Math.max(1, Math.round(entry.account?.initialEquityUsdt || entry.account?.totalEqUsd || 1000000)))
              setSettingsEntry(entry)
            }}
            onOpenAi={() => setAiEntry(entry)}
            onToggleAutomation={(enabled) => void toggleAutomation(entry, enabled)}
            onRunAutomation={() => void runAutomation(entry)}
          />
        ))}
        {!accounts.length && (
          <div className="rounded-xl border border-border px-4 py-12 text-center text-sm text-foreground/70">
            暂无账户
          </div>
        )}
      </section>

      <CreateAccountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        label={newAccountLabel}
        equity={newAccountEquity}
        disabled={actionPending}
        onLabelChange={setNewAccountLabel}
        onEquityChange={setNewAccountEquity}
        onCreate={() => void createAccount()}
      />

      <AccountSettingsDialog
        entry={settingsEntry}
        resetEquity={resetEquity}
        disabled={actionPending}
        onOpenChange={(open) => { if (!open) setSettingsEntry(null) }}
        onResetEquityChange={setResetEquity}
        onReset={() => settingsEntry && void resetAccount(settingsEntry)}
        onDelete={() => settingsEntry && void removeAccount(settingsEntry)}
      />

      <AiSettingsDialog
        entry={aiEntry}
        disabled={actionPending}
        onOpenChange={(open) => { if (!open) setAiEntry(null) }}
        onSave={(settings, enabled) => aiEntry && void saveAiSettings(aiEntry, settings, enabled)}
      />
    </main>
  )
}

function AccountColumn({
  entry,
  expanded,
  activeTab,
  operations,
  actionPending,
  onToggleExpanded,
  onTabChange,
  onOpenSettings,
  onOpenAi,
  onToggleAutomation,
  onRunAutomation,
}: {
  entry: AccountOverviewEntry
  expanded: boolean
  activeTab: AccountTab
  operations: AccountOperationRecord[]
  actionPending: boolean
  onToggleExpanded: () => void
  onTabChange: (tab: AccountTab) => void
  onOpenSettings: () => void
  onOpenAi: () => void
  onToggleAutomation: (enabled: boolean) => void
  onRunAutomation: () => void
}) {
  const account = entry.account
  const pnl = Number(account?.totalUpl || 0)
  const ratio = Number(account?.uplRatio || 0)
  const isTest = entry.source === 'test'
  const automationEnabled = Boolean(entry.automation?.enabled)
  const positions = account?.positions || []
  const hasPositions = positions.length > 0
  const pnlFlash = useValueFlash(pnl)
  const tradeOperations = operations.filter(isTradeOperation)
  const aiOperations = operations.filter((record) => !isTradeOperation(record))

  return (
    <article
      className={cn(
        'group h-fit overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_8px_24px_rgba(0,0,0,0.16)] transition duration-200 hover:-translate-y-1 hover:border-primary/50 hover:bg-card hover:shadow-[0_22px_55px_rgba(0,0,0,0.28)]',
        expanded && 'border-primary/45 shadow-[0_18px_42px_rgba(0,0,0,0.24)]',
      )}
    >
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" className="min-w-0 text-left" onClick={hasPositions ? onToggleExpanded : undefined}>
            <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-semibold">{entry.label}</h2>
            <Badge className={entry.status === 'connected' ? 'border-gain/30 bg-gain/15 text-gain' : 'border-warning/40 bg-warning/15 text-warning'} variant="outline">
              {entry.status === 'connected' ? '在线' : '离线'}
            </Badge>
            </div>
            <p className="mt-1 max-w-[210px] truncate font-mono text-xs text-foreground/65">{entry.id}</p>
          </button>
          <div className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-2 py-1">
            <span className="text-xs font-semibold text-foreground/70">AI</span>
            <Switch checked={automationEnabled} disabled={!isTest || actionPending} onCheckedChange={(value) => onToggleAutomation(Boolean(value))} />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <CompactMetric label="总权益" value={`$${formatMoney(account?.totalEqUsd || 0)}`} />
          <div className={cn(
            'rounded-xl border border-border bg-background/60 px-3 py-2 transition duration-300',
            pnlFlash === 'gain' && 'scale-[1.03] border-gain/60 bg-gain/10 shadow-[0_0_30px_rgba(0,190,120,0.28)]',
            pnlFlash === 'loss' && 'scale-[1.03] border-loss/60 bg-loss/10 shadow-[0_0_30px_rgba(240,70,90,0.28)]',
          )}>
            <p className="text-xs font-semibold text-foreground/70">每秒浮盈</p>
            <p className={cn('mt-1 font-mono text-2xl font-semibold transition', pnl >= 0 ? 'text-gain' : 'text-loss', pnlFlash !== 'none' && 'animate-pulse')}>
              {formatSignedMoney(pnl)}
            </p>
            <p className={cn('font-mono text-sm font-semibold', ratio >= 0 ? 'text-gain' : 'text-loss')}>
              {ratio >= 0 ? '+' : ''}{ratio.toFixed(2)}%
            </p>
          </div>
          <CompactMetric label="可用资金" value={`$${formatMoney(account?.availableUsdt || 0)}`} />
          <CompactMetric label="当前持仓" value={`${positions.length} 个`} tone={positions.length ? 'text-primary' : 'text-foreground/55'} />
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" className="h-8 w-8" title="账户设置" onClick={onOpenSettings}>
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" className="h-8 w-8" title="AI 设置" onClick={onOpenAi}>
            <Bot className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" className="h-8 w-8" title={hasPositions ? (expanded ? '收起' : '展开') : '暂无持仓'} disabled={!hasPositions} onClick={onToggleExpanded}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          </div>
          <Button size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs" disabled={!isTest || !automationEnabled || actionPending} onClick={onRunAutomation}>
            立即运行 AI
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border bg-background/35 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <TabButton active={activeTab === 'positions'} onClick={() => onTabChange('positions')}>仓位情况</TabButton>
            <TabButton active={activeTab === 'trades'} onClick={() => onTabChange('trades')}>操作记录</TabButton>
            <TabButton active={activeTab === 'ai'} onClick={() => onTabChange('ai')}>AI 判断</TabButton>
            <span className="ml-auto text-xs text-foreground/70">{positions.length} 个持仓</span>
          </div>

          {activeTab === 'positions' ? (
            <PositionsList positions={positions} />
          ) : activeTab === 'trades' ? (
            <OperationsList operations={tradeOperations} emptyText="暂无开仓/加仓/平仓记录" />
          ) : (
            <OperationsList operations={aiOperations} emptyText="暂无 AI 判断记录" />
          )}
        </div>
      )}
    </article>
  )
}

function PositionsList({ positions }: { positions: Position[] }) {
  if (!positions.length) {
    return <div className="rounded-xl border border-border px-3 py-6 text-center text-sm text-foreground/70">暂无持仓</div>
  }
  return (
    <div className="space-y-2">
      {positions.map((position) => (
        <PositionCard key={position.id} position={position} />
      ))}
    </div>
  )
}

function PositionCard({ position }: { position: Position }) {
  const positive = position.pnl >= 0
  return (
    <section className="rounded-xl border border-border bg-background/70 px-3 py-3 shadow-[0_8px_18px_rgba(0,0,0,0.12)] transition hover:border-primary/40 hover:bg-background">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-sm font-semibold text-primary">{position.instId}</span>
          <Badge className={cn('h-5 border-0 px-1.5 text-[11px]', position.side === 'long' ? 'bg-gain/15 text-gain' : 'bg-loss/15 text-loss')}>
            {position.side === 'long' ? '多' : '空'}
          </Badge>
          <Badge className="h-5 border-0 bg-warning/15 px-1.5 text-[11px] text-warning">{position.leverage.toFixed(1)}x</Badge>
        </div>
        <p className="mt-0.5 text-xs text-foreground/65">{position.type === 'spot' ? '现货' : '永续合约'}</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <CompactMetric label="入场价" value={`$${formatPrice(position.entryPrice)}`} />
        <CompactMetric label="标记价" value={`$${formatPrice(position.markPrice)}`} />
        <CompactMetric label="持仓量" value={formatPositionHolding(position)} tone={position.side === 'short' ? 'text-loss' : 'text-gain'} />
        <CompactMetric label="保证金" value={position.margin !== undefined ? `$${formatMoney(position.margin)}` : '--'} />
        <CompactMetric label="浮动收益" value={formatSignedMoney(position.pnl)} tone={positive ? 'text-gain' : 'text-loss'} />
        <CompactMetric label="收益率" value={`${position.pnlPercent >= 0 ? '+' : ''}${position.pnlPercent.toFixed(2)}%`} tone={positive ? 'text-gain' : 'text-loss'} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline" className={cn('h-7 rounded-full', position.liquidationPrice > 0 ? 'border-warning/50 text-warning' : 'border-border text-foreground/70')}>
          {position.liquidationPrice > 0 ? `强平 $${formatPrice(position.liquidationPrice)}` : '无强平价'}
        </Badge>
        <Button type="button" size="sm" className="h-7 rounded-full bg-destructive px-3 text-xs text-destructive-foreground hover:bg-destructive/90">平仓</Button>
        <Button type="button" size="sm" className="h-7 rounded-full bg-warning px-3 text-xs text-warning-foreground hover:bg-warning/90">止盈止损</Button>
      </div>
    </section>
  )
}

function OperationsList({ operations, emptyText }: { operations: AccountOperationRecord[]; emptyText: string }) {
  if (!operations.length) {
    return <div className="rounded-xl border border-border px-3 py-8 text-center text-sm text-foreground/70">{emptyText}</div>
  }
  return (
    <div className="space-y-2">
      {operations.slice(0, 10).map((record) => (
        <div key={record.id} className="rounded-xl border border-border bg-background/70 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant="outline" className={sourceClass(record.source)}>{record.source === 'ai' ? 'AI' : record.source === 'manual' ? '手动' : '系统'}</Badge>
                {record.dryRun && <Badge variant="outline" className="border-warning text-warning">演练</Badge>}
                <span className="truncate text-sm font-semibold">{record.instId || eventLabel(record.event)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-foreground/70">{record.operation || eventLabel(record.event)}{record.reason ? `：${record.reason}` : ''}</p>
            </div>
            <div className="shrink-0 text-right">
              <Badge variant="outline" className={statusClass(record.status || '')}>{statusText(record.status || '')}</Badge>
              <p className="mt-1 whitespace-nowrap text-[11px] text-foreground/55">{formatTime(record.ts)}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function AiSettingsDialog({
  entry,
  disabled,
  onOpenChange,
  onSave,
}: {
  entry: AccountOverviewEntry | null
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onSave: (settings: PlanSettings, enabled: boolean) => void
}) {
  const [draft, setDraft] = useState<PlanSettings>(defaultPlanSettings)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!entry) return
    setDraft(normalizeAiSettings(entry.automation?.settings, entry.account))
    setEnabled(Boolean(entry.automation?.enabled))
  }, [entry])

  if (!entry) return null
  const activeEntry = entry
  const canEdit = activeEntry.source === 'test' && !disabled

  function update<K extends keyof PlanSettings>(key: K, value: PlanSettings[K]) {
    setDraft((current) => normalizeAiSettings({ ...current, [key]: value }, activeEntry.account))
  }

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI 设置 · {activeEntry.label}</DialogTitle>
          <DialogDescription>这里只保留影响自动化和收益/风险的核心参数，其余细节由 Skills 与 TradingAgents 自行处理。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3">
            <div>
              <p className="font-semibold">开启账户 AI</p>
              <p className="text-sm text-foreground/65">{activeEntry.source === 'test' ? '开启后仅操作本地测试账户。' : '真实账户当前只读，不能开启自动操作。'}</p>
            </div>
            <Switch checked={enabled} disabled={!canEdit} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SettingSelect label="产品倾向" value={draft.productPreference} disabled={!canEdit} options={[['both', '现货 + 合约'], ['spot', '只做现货'], ['swap', '只做合约']]} onChange={(value) => update('productPreference', value as PlanSettings['productPreference'])} />
            <SettingSelect label="决策引擎" value={draft.decisionEngine || 'hybrid'} disabled={!canEdit} options={[['hybrid', 'Skills + TA'], ['skills', '只用 Skills'], ['tradingagents', 'TA 最终判断']]} onChange={(value) => update('decisionEngine', value as PlanSettings['decisionEngine'])} />
            <SettingSelect label="最低杠杆" value={String(draft.minLeverage || 5)} disabled={!canEdit || draft.productPreference === 'spot'} options={MIN_LEVERAGE_OPTIONS.map((tier) => [String(tier), `${tier}x`] as const)} onChange={(value) => update('minLeverage', Number(value))} />
            <SettingSelect label="最高杠杆" value={String(draft.maxLeverage || 5)} disabled={!canEdit || draft.productPreference === 'spot'} options={OKX_LEVERAGE_OPTIONS.map((tier) => [String(tier), `${tier}x`] as const)} onChange={(value) => update('maxLeverage', Number(value))} />
            <SettingInput label="风险等级" value={draft.riskLevel} disabled={!canEdit} onChange={(value) => update('riskLevel', Number(value))} />
            <SettingInput label="最低置信度 %" value={draft.minConfidence || 60} disabled={!canEdit} onChange={(value) => update('minConfidence', Number(value))} />
            <SettingInput label="单币上限 %" value={draft.maxAssetWeight} disabled={!canEdit} onChange={(value) => update('maxAssetWeight', Number(value))} />
            <SettingInput label="最小订单 USDT" value={draft.minOrderUsdt} disabled={!canEdit} onChange={(value) => update('minOrderUsdt', Number(value))} />
          </div>

          <div className="rounded-xl border border-border bg-background/55 p-3">
            <p className="mb-2 text-sm font-semibold">候选币池</p>
            <Input
              value={draft.symbols || ''}
              disabled={!canEdit}
              placeholder="BTC-USDT, ETH-USDT-SWAP, SOL-USDT"
              className="font-mono text-xs"
              onChange={(event) => update('symbols', event.target.value)}
            />
            <p className="mt-2 text-xs text-foreground/65">留空时使用当前持仓和默认主流观察池。为了追求收益率，合约最低杠杆默认 5x；若交易所最大杠杆低于 5x，会自动按交易所上限收敛。</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <SettingSwitch label="管理已有持仓" checked={draft.manageExistingPositions} disabled={!canEdit} onChange={(value) => update('manageExistingPositions', value)} />
            <SettingSwitch label="允许新开仓" checked={draft.allowNewPositions} disabled={!canEdit} onChange={(value) => update('allowNewPositions', value)} />
            <SettingSwitch label="允许加仓" checked={draft.allowPositionIncrease} disabled={!canEdit} onChange={(value) => update('allowPositionIncrease', value)} />
            <SettingSwitch label="排除新币" checked={draft.excludeNewCoins} disabled={!canEdit} onChange={(value) => update('excludeNewCoins', value)} />
            <SettingSwitch label="仅自选币池" checked={draft.favoritePoolOnly} disabled={!canEdit} onChange={(value) => update('favoritePoolOnly', value)} />
            <SettingSwitch label="强制 TA 复核" checked={Boolean(draft.forceTradingAgents)} disabled={!canEdit || draft.decisionEngine === 'skills'} onChange={(value) => update('forceTradingAgents', value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!canEdit} onClick={() => onSave(draft, enabled)}>
            <Save className="h-4 w-4" />
            保存设置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountSettingsDialog({
  entry,
  resetEquity,
  disabled,
  onOpenChange,
  onResetEquityChange,
  onReset,
  onDelete,
}: {
  entry: AccountOverviewEntry | null
  resetEquity: number
  disabled: boolean
  onOpenChange: (open: boolean) => void
  onResetEquityChange: (value: number) => void
  onReset: () => void
  onDelete: () => void
}) {
  if (!entry) return null
  const account = entry.account
  const isTest = entry.source === 'test'
  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>账户设置 · {entry.label}</DialogTitle>
          <DialogDescription>账户资料、测试账户维护和只读状态集中在这里。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <MiniMetric label="账户 ID" value={entry.id} />
          <MiniMetric label="账户类型" value={isTest ? '本地测试账户' : '真实账户只读'} />
          <MiniMetric label="账户权益" value={account ? `$${formatMoney(account.totalEqUsd)}` : '--'} />
          <MiniMetric label="可用资金" value={account ? `$${formatMoney(account.availableUsdt)}` : '--'} />
          {isTest ? (
            <label className="block text-sm font-medium text-foreground/75">
              重置后初始资金 USDT
              <Input
                type="number"
                min={1}
                value={resetEquity}
                className="mt-2 font-mono"
                disabled={disabled}
                onChange={(event) => onResetEquityChange(Number(event.target.value) || 0)}
              />
            </label>
          ) : (
            <p className="rounded-xl border border-border bg-card p-3 text-sm text-foreground/70">真实账户当前只读展示。接入真实交易 API 后，可在此扩展密钥权限、风险限额和自动化授权。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          {isTest && (
            <>
              <Button variant="outline" disabled={disabled || resetEquity <= 0} onClick={onReset}>
                <RotateCcw className="h-4 w-4" />
                重置
              </Button>
              <Button variant="destructive" disabled={disabled || entry.id === 'default' || Boolean(entry.automation?.enabled)} onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                删除
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CreateAccountDialog({
  open,
  onOpenChange,
  label,
  equity,
  disabled,
  onLabelChange,
  onEquityChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  equity: number
  disabled: boolean
  onLabelChange: (value: string) => void
  onEquityChange: (value: number) => void
  onCreate: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加测试账户</DialogTitle>
          <DialogDescription>测试账户只在本地计算盈亏和持仓，不会发送真实订单。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="block text-sm font-medium text-foreground/75">
            账户名称
            <Input value={label} maxLength={24} className="mt-2" disabled={disabled} onChange={(event) => onLabelChange(event.target.value)} />
          </label>
          <label className="block text-sm font-medium text-foreground/75">
            初始资金 USDT
            <Input type="number" min={1} value={equity} className="mt-2 font-mono" disabled={disabled} onChange={(event) => onEquityChange(Number(event.target.value) || 0)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={disabled || !label.trim() || equity <= 0} onClick={onCreate}>
            <Plus className="h-4 w-4" />
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompactMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold leading-4 text-foreground/58">{label}</p>
      <p className={cn('truncate font-mono text-sm font-semibold leading-5', tone)}>{value}</p>
    </div>
  )
}

function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition', active ? 'border-gain/40 bg-gain/15 text-gain' : 'border-border bg-background/60 text-foreground/75 hover:text-foreground')}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function SummaryPill({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-full border border-border bg-card px-3 py-1 text-xs shadow-[0_8px_18px_rgba(0,0,0,0.14)]">
      <span className="mr-2 text-foreground/65">{label}</span>
      <span className={cn('font-mono font-semibold', tone)}>{value}</span>
    </div>
  )
}

function MiniMetric({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground/70">{label}</p>
      <p className={cn('truncate font-mono font-semibold', tone)}>{value}</p>
    </div>
  )
}

function useValueFlash(value: number) {
  const previous = useRef(value)
  const [flash, setFlash] = useState<'gain' | 'loss' | 'none'>('none')

  useEffect(() => {
    if (!Number.isFinite(value)) return
    const diff = value - previous.current
    previous.current = value
    if (Math.abs(diff) < 0.000001) return
    setFlash(diff > 0 ? 'gain' : 'loss')
    const timer = window.setTimeout(() => setFlash('none'), 780)
    return () => window.clearTimeout(timer)
  }, [value])

  return flash
}

function isTradeOperation(record: AccountOperationRecord) {
  const action = String(record.action || '').toLowerCase()
  const operation = String(record.operation || '')
  const status = String(record.status || '').toLowerCase()
  return ['add', 'reduce', 'close', 'buy', 'sell'].includes(action)
    || status === 'applied-to-test-account'
    || /开仓|加仓|减仓|平仓|买入|卖出|清仓/.test(operation)
}

function SettingInput({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-foreground/75">
      {label}
      <Input type="number" value={Number.isFinite(value) ? value : 0} disabled={disabled} className="mt-2 font-mono" onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function SettingSelect({ label, value, disabled, options, onChange }: { label: string; value: string; disabled: boolean; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-foreground/75">
      {label}
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="mt-2 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function SettingSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/55 px-3 py-2 text-sm font-semibold text-foreground/75">
      <span>{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(Boolean(value))} />
    </label>
  )
}

function normalizeAiSettings(settings?: Partial<PlanSettings>, account?: AccountOverviewEntry['account']): PlanSettings {
  const merged = { ...defaultPlanSettings, ...(settings || {}) }
  const available = Number(account?.availableUsdt || 0)
  const requestedBudget = Number(merged.budgetUsdt)
  const autoBudget = merged.autoBudget !== false
  const budgetUsdt = autoBudget
    ? (available > 0 ? available : defaultPlanSettings.budgetUsdt)
    : requestedBudget > 0
      ? (available > 0 ? Math.min(requestedBudget, available) : requestedBudget)
      : (available > 0 ? available : defaultPlanSettings.budgetUsdt)
  const maxLeverage = snapUiLeverage(Number(merged.maxLeverage || defaultPlanSettings.maxLeverage || 5))
  const minLeverage = Math.min(snapUiLeverage(Math.max(Number(merged.minLeverage || 5), 5)), maxLeverage)
  const symbols = parseSymbolPool(String(merged.symbols || ''))
  const legacySymbolPool = isLegacyDefaultSymbolPool(symbols)
  const requestedProductPreference = ['both', 'spot', 'swap'].includes(String(merged.productPreference)) ? merged.productPreference : defaultPlanSettings.productPreference
  const productPreference = legacySymbolPool && requestedProductPreference === 'both' ? 'swap' : requestedProductPreference

  return {
    ...merged,
    autoBudget,
    budgetUsdt: clampNumber(budgetUsdt, 0, 10_000_000),
    lookbackDays: clampNumber(Number(merged.lookbackDays || 60), 30, 300),
    objective: ['defensive', 'balanced', 'growth'].includes(String(merged.objective)) ? merged.objective : defaultPlanSettings.objective,
    riskLevel: clampNumber(Number(merged.riskLevel || 5), 1, 10),
    maxAssetWeight: clampNumber(Number(merged.maxAssetWeight || 35), 1, 90),
    minOrderUsdt: clampNumber(Number(merged.minOrderUsdt || 10), 1, 1_000_000),
    targetReturn: clampNumber(Number(merged.targetReturn || 12), 0.1, 1000),
    maxDrawdown: clampNumber(Number(merged.maxDrawdown || 8), 0.1, 100),
    minConfidence: clampNumber(Number(merged.minConfidence ?? 60), 0, 100),
    productPreference,
    favoritePoolOnly: Boolean(merged.favoritePoolOnly),
    symbols: legacySymbolPool ? '' : symbols.join(','),
    minLeverage,
    maxLeverage,
    manageExistingPositions: merged.manageExistingPositions !== false,
    allowNewPositions: merged.allowNewPositions !== false,
    allowPositionIncrease: merged.allowPositionIncrease !== false,
    maxActionsPerCycle: clampNumber(Number(merged.maxActionsPerCycle || 6), 1, 12),
    decisionEngine: ['skills', 'tradingagents', 'hybrid'].includes(String(merged.decisionEngine)) ? merged.decisionEngine : 'hybrid',
    tradingAgentsWeight: clampNumber(Number(merged.tradingAgentsWeight ?? 50), 0, 100),
    forceTradingAgents: Boolean(merged.forceTradingAgents),
  }
}

function parseSymbolPool(value = '') {
  return [...new Set(
    String(value)
      .split(/[\s,，、]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((item) => /^[A-Z0-9]+-[A-Z0-9]+(?:-SWAP)?$/.test(item)),
  )].slice(0, 30)
}

function isLegacyDefaultSymbolPool(symbols: string[]) {
  if (symbols.length !== LEGACY_DEFAULT_SYMBOL_POOL.length) return false
  const legacy = new Set(LEGACY_DEFAULT_SYMBOL_POOL)
  return symbols.every((item) => legacy.has(item))
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function snapUiLeverage(value: number) {
  const capped = clampNumber(value, 1, 50)
  return OKX_LEVERAGE_OPTIONS.filter((tier) => tier <= capped).at(-1) || 1
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

function sourceClass(source: AccountOperationRecord['source']) {
  if (source === 'ai') return 'border-primary/60 bg-primary/10 text-primary'
  if (source === 'manual') return 'border-sky-400/50 bg-sky-400/10 text-sky-300'
  return 'border-foreground/30 bg-muted/30 text-foreground/70'
}

function statusClass(status: string) {
  if (status.includes('applied') || status === 'completed') return 'border-gain/60 text-gain'
  if (status.includes('dry') || status.includes('held') || status.includes('skipped')) return 'border-warning/60 text-warning'
  if (status.includes('fail')) return 'border-loss/60 text-loss'
  return 'border-foreground/30 text-foreground/70'
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
