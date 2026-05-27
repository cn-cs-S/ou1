# OKX AI Trade Lab (ou1)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

本地运行的 **OKX AI 交易研究台**：行情来自真实公共市场，默认使用可编辑的本地测试账户计算盈亏、强平参考与风险建议，**不向交易所发送真实订单**。

仓库地址：[https://github.com/cn-cs-S/ou1](https://github.com/cn-cs-S/ou1)

---

## 功能概览

| 模块 | 说明 |
|------|------|
| **主服务** (`server.js`) | Node.js HTTP 服务，提供行情、组合优化、合约风险、本地测试账户与自动化 API |
| **交易界面** (`public/`) | OKX 风格 K 线、指标、自选、组合计划与本地仓位管理 |
| **Next.js 面板** (`ai/`) | React / Next.js 交易决策与账户总览 UI（可选） |
| **Agent Skills** (`.claude/skills/`) | K 线分析、仓位计算、交易计划、定投、复盘等 9 个 OKX Marketplace Skills |
| **文档** (`docs/`) | 自动化与盘口流向等使用说明 |

### 安全默认值

- 默认 `OKX_ACCOUNT_SOURCE=test`，不调用模拟盘或真实下单接口。
- 本地测试仓位以操作当刻的公开报价为基准，盈亏由本地持续重算。
- `live-readonly` 模式仅读取账户信息，界面不提供真实下单出口。
- 自动化须在界面显式开启，且只能修改当前选中的本地测试账户。
- **切勿**将 `.env`、API 密钥或 `data/` 目录提交到 Git。

---

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Python** 3.12（部分 Skills 依赖 `ccxt`、`Flask`、`chainbase-cli`）

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/cn-cs-S/ou1.git
cd ou1

# 可选：复制环境变量模板后按需修改
# cp .env.example .env

# 启动主服务
npm start
# 或
node server.js
```

浏览器打开终端输出的地址，通常为：

```text
http://localhost:8787
```

若端口被占用，服务会自动尝试 `8788`、`8789` 等。

### 环境变量

在项目根目录创建 `.env`（已被 `.gitignore` 忽略）：

```env
OKX_ACCOUNT_SOURCE=test
TEST_ACCOUNT_INITIAL_USDT=100000
PORT=8787
```

接入只读真实账户查看余额与持仓时：

```env
OKX_ACCOUNT_SOURCE=live-readonly
OKX_API_KEY=你的Key
OKX_SECRET_KEY=你的Secret
OKX_PASSPHRASE=你的Passphrase
```

也支持官方别名：`OKX_SECRET_KEY`、`OKX_PASSPHRASE`、`OKX_API_BASE_URL`、`OKX_SITE`。

---

## 项目结构

```text
ou1/
├── server.js              # 主 HTTP 服务入口
├── package.json
├── public/                # 静态交易研究台前端
├── src/                   # OKX 客户端、优化器、风控、测试账户等
├── ai/                    # Next.js 交易面板（可选）
├── docs/                  # 使用文档
├── marketplace-skills/    # Skills 资源
├── skills/                # 技能相关脚本
├── config/                # 配置
├── auto_trading_refactor/ # Python 纸面交易 API（实验性）
└── auto_coin_view_front/  # Vite 前端（实验性）
```

---

## 策略与指标

策略对币种池拉取 OKX 日线与 ticker，计算：

- 年化收益估计、7 日 / 30 日动量、EMA 趋势
- 年化波动、最大回撤、RSI
- 点差与 24 小时流动性

按**防守 / 均衡 / 进攻**目标生成目标权重、现金仓位与订单计划。评分结果为给定目标函数下的最优解，**不构成收益承诺**。

---

## 已接入 Skills

| Skill | 用途 |
|-------|------|
| `kline-indicator` | K 线、订单流与多指标信号 |
| `position-sizer` | 仓位、杠杆、止损与强平风险 |
| `trading-plan-generator` | 三档风险交易计划 |
| `okx-strategy-oracle` | 策略生成与参数优化 |
| `okx-execution-vortex` | 执行层（GUI 默认不连真实下单） |
| `recurring-dca` | 周期 / 条件定投 |
| `okx-maker-entry` | Post-Only 分层挂单 |
| `okx-review` | 本地 SQLite + Flask 复盘 |
| `market-intel` | 社交叙事与市场情绪 |

更多说明见 [`docs/AUTOMATION_GUIDE.md`](docs/AUTOMATION_GUIDE.md)、[`docs/MARKET_FLOW_GUIDE.md`](docs/MARKET_FLOW_GUIDE.md)。

---

## 常用命令

```bash
# 语法检查
npm run check

# Next.js 面板（在 ai/ 目录）
cd ai
npm install
npm run dev
```

---

## 免责声明

本项目仅供学习与研究，不构成任何投资建议。加密货币交易风险极高，请自行承担全部责任。使用真实 API 时请仅授予必要权限，并妥善保管密钥。

---

## 许可证

MIT License — 详见仓库中的 LICENSE 文件（如未包含，以作者后续补充为准）。
