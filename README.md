# OKX AI Trade Lab

本项目是一个本地运行的 OKX 行情、AI 策略、模拟账户和自动化测试平台。它使用 OKX 真实公开行情，本地计算持仓、收益、手续费、资金费、强平参考和回测结果；默认只操作本地测试账户，不会向交易所提交真实订单。

> 风险提示：本项目仅用于学习、研究和策略测试，不构成投资建议。接入真实账户时请优先使用只读 API，并自行承担全部交易风险。

## 主要功能

- 首页：轻量 K 线入口和功能导航，避免一次性加载全部币种导致页面卡顿。
- 币种数据：OKX 风格行情页，自选、搜索、现货/合约区分、K 线、BOLL、MACD、成交量和资金异动提示。
- Skills 实时建议：展示本地 skills 运行状态、策略摘要和自动化依据。
- TradingAgents 页面：独立 LLM 对话和实时市场上下文分析，不直接耦合执行链路。
- AI 实验室：配置 Zhipu GLM 或 OpenRouter LLM，用于 Skills、TradingAgents 和混合权重对比。
- 账户管理：测试账户和真实只读账户总览、持仓、收益率、操作记录、AI 设置。
- 全仓参数长期测试：创建独立测试账户，覆盖 Skills、TradingAgents 和不同混合权重参数，长期统计小时/日收益率、胜率、回撤和总收益。
- 历史回测：可用历史 K 线回放模型，不允许模型提前看到未来 K 线。
- 自动化：仅对本地测试账户执行买入、卖出、做多、做空、加仓、减仓、平仓等本地模拟动作。

## 环境要求

- Node.js 18 或更高版本。
- npm。
- Python 仅在你要单独运行 `tradingagents/` 原生项目时需要；当前 Web 页面里的 TradingAgents 复核主要通过后端 LLM API 调用。

## 克隆和安装

```bash
git clone https://github.com/cn-cs-S/ou1.git
cd ou1
```

安装前端依赖：

```bash
cd ai
npm install
cd ..
```

根目录后端目前只依赖 Node.js 内置模块，不需要额外安装。

## 环境变量

复制模板：

```bash
copy .env.example .env
```

Linux/macOS 使用：

```bash
cp .env.example .env
```

默认测试账户模式：

```env
OKX_API_BASE=https://www.okx.com
OKX_ACCOUNT_SOURCE=test
TEST_ACCOUNT_INITIAL_USDT=100000
PORT=8787
```

真实账户只读模式：

```env
OKX_ACCOUNT_SOURCE=live-readonly
OKX_API_KEY=your_read_only_api_key
OKX_API_SECRET=your_read_only_secret_key
OKX_API_PASSPHRASE=your_read_only_passphrase
```

不要提交 `.env`、API key、passphrase、`data/`、`logs/` 或任何真实账户数据。

## TradingAgents / LLM 配置

LLM 可通过两种方式配置。

方式一：在页面填写。

1. 启动后访问 `http://127.0.0.1:3000/ai-lab`。
2. 选择 `Zhipu GLM` 或 `OpenRouter`。
3. 填入 API key、模型名、Base URL。
4. 打开启用开关并点击连接测试。
5. 配置会保存到 `data/llm-config.json`，该文件已被 `.gitignore` 忽略。

方式二：在 `.env` 填写。环境变量优先级高于页面保存的 key。

Zhipu GLM 示例：

```env
LLM_PROVIDER=zhipu
ZHIPU_API_KEY=your_zhipu_api_key
ZHIPU_MODEL=glm-4.7-flash
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_FALLBACK_MODELS=glm-4.5-flash
ZHIPU_THINKING_TYPE=disabled
```

OpenRouter 示例：

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=openrouter/free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

原生 `tradingagents/` 项目也保留在仓库中。如果你要单独运行它，可参考 `tradingagents/README.md` 和 `tradingagents/.env.example`。本项目额外支持 GLM thinking 参数：

```env
ZHIPU_THINKING_TYPE=disabled
```

## 启动

后端 API：

```bash
npm start
```

前端：

```bash
cd ai
npm run dev
```

常用地址：

- 首页：`http://127.0.0.1:3000`
- 币种数据：`http://127.0.0.1:3000/market-data`
- Skills 实时建议：`http://127.0.0.1:3000/skills-live`
- TradingAgents：`http://127.0.0.1:3000/tradingagents`
- AI 实验室：`http://127.0.0.1:3000/ai-lab`
- 账户管理：`http://127.0.0.1:3000/accounts`
- 全仓参数长期测试：`http://127.0.0.1:3000/full-position-test`
- 历史回测：`http://127.0.0.1:3000/historical-backtest`
- 后端健康检查：`http://127.0.0.1:8787/api/health`

## 全仓参数长期测试

入口：`/full-position-test`。

- `全引擎覆盖` 会创建唯一参数模型，覆盖 Skills、TradingAgents、Skills 65% + TA 35%、Skills 50% + TA 50%、Skills 35% + TA 65%。
- `Skills + TradingAgents` 只测试三种混合权重，不再生成重复的 `TA 复核 2`。
- 测试账户独立于普通测试账户，不会出现在账户管理的普通测试账户列表中。
- 每个模型会记录总收益、收益率、小时/日收益率、胜率、最大回撤、开仓/加仓/平仓记录和 AI 判断日志。

## 历史回测和本地数据

入口：`/historical-backtest`。

- 支持选择时间范围、K 线周期、模型数量和币种范围。
- 回测会按时间顺序喂给模型，不允许模型提前看到未来 K 线。
- 低周期长时间回测会消耗大量磁盘和时间，建议先用少量币种/短时间段验证。
- 历史 K 线、模型日志和测试账户数据保存在 `data/`，默认不会提交到 Git。

## 验证命令

后端语法检查：

```bash
npm run check
```

前端生产构建：

```bash
cd ai
npm run build
```

## 性能建议

- 首轮全市场加载慢通常是 OKX 网络延迟，不一定是本机性能问题。
- 长期挂机建议部署到香港、新加坡、日本或其他访问 OKX 更稳定的 VPS。
- 如果要跑全市场 1m 历史数据回测，优先减少账户数量或先缓存少量标的。
- `data/` 会持续增长，长期测试时注意磁盘空间。

## 安全说明

- `.env` 已被忽略，不要把真实 API key 写入 README、代码或 issue。
- 真实账户当前按只读设计；自动化执行只修改本地测试账户。
- 后续如接入真实下单，请额外加入订单预览、二次确认、单笔限额、总风险限额和紧急停止机制。
