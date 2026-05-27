# OKX Skills Review

## Local Status

- OKX CLI/MCP installed: `@okx_ai/okx-trade-cli@1.3.5`, `@okx_ai/okx-trade-mcp@1.3.5`
- Active profile: `faker-okx`
- Mode: demo / simulated trading
- Private API auth: verified with read-only balance request
- Local installed marketplace skills: 9 project Skills installed with `npx skills`
- Python runtime: `C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe`
- Python dependencies: `ccxt`, `Flask`
- Market intelligence dependency: `chainbase-cli`

## Official Base Skills

These are the safest building blocks for this project because their scope is clear.

| Skill | Use | Auth | Recommendation |
| --- | --- | --- | --- |
| `okx-cex-market` | Prices, candles, order book, funding, open interest, indicators | No | Use immediately for richer signals |
| `okx-cex-portfolio` | Balances, positions, P&L, fees, transfers | Yes | Use for portfolio-aware sizing |
| `okx-cex-trade` | Spot/swap/futures/options orders, TP/SL, algo orders | Yes | Gate behind confirmation and demo mode |
| `okx-cex-bot` | Grid and DCA bot create/monitor/stop | Yes | Use only after manual review flow is solid |
| `okx-cex-smartmoney` | Leaderboard, trader positions, consensus signals | Yes | Add as secondary signal, not primary trigger |
| `okx-sentiment-tracker` | News, trending coins, sentiment | Yes | Add as risk filter |
| `okx-cex-earn` | Simple Earn, DCD, staking, AutoEarn | Yes | Separate from trading allocator |

## Marketplace Categories

Marketplace categories returned by `okx skill categories`:

- `news`: research, sentiment, macro, market intelligence
- `strategy`: signal generation and parameterization
- `execute`: order execution, DCA, maker entries, advanced execution
- `review`: P&L review, dashboards, trade journaling

## Installed Skills For This GUI Project

| Skill | Category | Automation | Key indicators / logic |
| --- | --- | --- | --- |
| `kline-indicator` | strategy | read-only | RSI, MACD, EMA, Bollinger Bands, KDJ, ATR, Supertrend, order flow |
| `position-sizer` | strategy | semi-auto | fixed-fractional sizing, Kelly, ATR stops, leverage and liquidation comparison |
| `trading-plan-generator` | strategy | semi-auto | market, derivatives, order book and signal-weight plan generation |
| `okx-strategy-oracle` | strategy | semi-auto | trend scoring, parameter optimization, three risk tiers, bot configs |
| `okx-execution-vortex` | execute | full-auto capable | guarded simulated spot/swap/futures/options execution, OCO, grid, DCA |
| `recurring-dca` | execute | full-auto capable | scheduled DCA, multi-coin allocation, RSI/MACD/Bollinger/funding filters |
| `okx-maker-entry` | execute | full-auto capable | post-only maker entry, 1-40 order-book levels, cancel/replace loop |
| `okx-review` | review | local dashboard | P&L curve, win rate, fees, monthly performance, tags and review notes |
| `market-intel` | news | read-only | social momentum, narrative shifts, Tops rankings, OKX pair mapping |

Note: `okx skill list` may still show no installed skills because the official Windows installer path failed on `C:\Program Files\nodejs\npx`. The working installation was completed through `npx skills add ... --all --copy`; `npx skills list --json` confirms the project installs under `.agents/skills`.

## Integration Order

1. Keep current GUI as the control surface.
2. Add read-only portfolio state: balances, current positions, P&L.
3. Add richer market indicators from `okx-cex-market` or equivalent CLI calls.
4. Add position sizing and order caps before any execution skill.
5. Keep execution in demo + dry-run + manual confirmation until review data looks sane.
6. Add review dashboard after simulated orders exist.

## Guardrails

- Do not install or run strategy/execution Skills blindly.
- Treat third-party marketplace Skills as untrusted until their commands are inspected.
- Never enable live mode from a Skill.
- Keep automatic execution locked behind demo mode, max-order limits, and audit logs.
