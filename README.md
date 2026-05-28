# OKX AI Trade Lab

一个本地运行的 OKX AI 交易研究与测试平台。项目使用 OKX 真实公开行情进行 K 线、指标、资金异动、AI 组合计划、合约风险和本地测试账户盈亏计算；默认只操作本地测试账户，不会向交易所提交真实订单。

> 风险提示：本项目仅用于学习、研究和策略测试，不构成投资建议。接入真实账户时请优先使用只读权限，并自行承担全部交易风险。

## 功能

- OKX 风格交易终端：自选币种、K 线、MA/BOLL/MACD/RSI 等指标、资金异动提示。
- AI 组合计划：可按现货、合约或两者混合生成组合建议，并基于可用资金分配预算。
- 双向合约建议：同时给出做多和做空参考，包含入场、止盈、止损、杠杆、保证金和资金费估算。
- 本地测试账户：用真实市场数据在本地计算开仓价、标记价、强平参考、盈亏平衡价、浮动盈亏和手续费。
- 账户管理页：左侧账户列表，中间账户设置和详细持仓，右侧操作记录，并标记 AI 操作、手动操作和系统操作。
- 自动化测试：可对每个本地测试账户单独开启自动化，支持加仓、减仓、平仓和组合再平衡。
- 性能保护：OKX 请求队列、短缓存、并发去重、后台标签页暂停轮询，降低 429 和卡顿概率。

## 项目结构

```text
.
├── server.js                 # 本地 API 服务入口
├── src/                      # OKX 客户端、优化器、风险、估值、自动化、测试账户逻辑
├── ai/                       # Next.js + shadcn 风格交易界面
├── public/                   # 静态资源
├── docs/                     # 自动化与资金异动说明
├── marketplace-skills/       # 本地 skills 资源
├── config/                   # 非敏感配置
└── .env.example              # 环境变量模板
```

## 快速开始

### 1. 安装依赖

根目录服务本身只依赖 Node.js 内置模块；Next.js 前端需要安装依赖：

```bash
cd ai
npm install
```

### 2. 配置环境变量

复制模板并按需修改：

```bash
cp .env.example .env
```

默认配置使用本地测试账户：

```env
OKX_ACCOUNT_SOURCE=test
TEST_ACCOUNT_INITIAL_USDT=100000
PORT=8787
```

如需只读查看真实账户余额和持仓，可在 `.env` 中添加只读 API 信息：

```env
OKX_ACCOUNT_SOURCE=live-readonly
OKX_API_KEY=your_read_only_api_key
OKX_API_SECRET=your_read_only_secret_key
OKX_API_PASSPHRASE=your_read_only_passphrase
```

不要提交 `.env`、API key、passphrase、`data/` 或 `logs/`。

### 3. 启动服务

后端 API：

```bash
npm start
```

Next.js 前端：

```bash
cd ai
npm run dev
```

常用访问地址：

- 后端健康检查：`http://127.0.0.1:8787/api/health`
- 交易终端：`http://127.0.0.1:3000`
- 账户管理：`http://127.0.0.1:3000/accounts`

## 常用命令

```bash
# 后端语法检查
npm run check

# 前端类型检查
cd ai
npx tsc --noEmit

# 前端生产构建
npm run build -- --webpack
```

当前 `npm run lint` 需要本地安装 `eslint` 后才能运行。

## 数据与安全

- `data/` 保存本地测试账户和审计日志，默认被 `.gitignore` 忽略。
- `logs/` 保存本地运行日志，默认被 `.gitignore` 忽略。
- `.env` 保存私密配置，默认被 `.gitignore` 忽略。
- 真实账户目前按只读模式设计；自动化操作只会修改本地测试账户。
- 后续如接入真实交易 API，应单独加入权限确认、订单预览、风控限额和撤单机制。

## 性能说明

项目已对 OKX 公共接口做本地缓存和限速保护：

- 请求队列降低 429 风险。
- 行情、币种池、账户详情有短缓存。
- 账户详情接口会复用并发请求结果。
- 浏览器标签页不可见时暂停轮询。

如果首轮加载仍慢，通常是 OKX 外部网络延迟。相比升级本机硬件，更推荐部署到香港、新加坡或东京等网络延迟较低的 VPS。

## 免责声明

加密资产价格波动剧烈，任何策略、指标、AI 建议或自动化结果都可能产生亏损。请勿将本项目输出视为确定性收益承诺。
