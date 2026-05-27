import fs from "node:fs";
import path from "node:path";

export const SKILL_REGISTRY = [
  {
    name: "kline-indicator",
    category: "指标分析",
    automationLevel: "只读分析",
    writeAccess: false,
    dependencies: ["Python"],
    indicators: ["RSI", "MACD", "EMA", "布林带", "KDJ", "ATR", "Supertrend", "订单流/CVD"],
    logic: "读取 OKX K 线、盘口与衍生品数据，用趋势、动量、波动和订单流做三支柱信号评分。",
    trigger: "分析 BTC、画 K 线、扫描热门币、判断多空信号"
  },
  {
    name: "position-sizer",
    category: "仓位管理",
    automationLevel: "半自动",
    writeAccess: false,
    dependencies: ["Python"],
    indicators: ["固定比例风险", "Kelly", "ATR 止损", "杠杆对比", "预估强平价"],
    logic: "把入场价、止损价、账户规模、风险比例转换为现货数量或合约张数，先限制亏损再谈收益。",
    trigger: "开多少张、该买多少、单笔风险、止损距离"
  },
  {
    name: "trading-plan-generator",
    category: "交易计划",
    automationLevel: "半自动",
    writeAccess: false,
    dependencies: ["OKX Trade Kit"],
    indicators: ["价格趋势", "成交量", "资金费率", "持仓量", "盘口", "多空信号权重"],
    logic: "组合行情、衍生品和技术指标，生成保守/均衡/激进三档入场、止盈、止损计划。",
    trigger: "交易计划、做多方案、做空方案、风险管理框架"
  },
  {
    name: "okx-strategy-oracle",
    category: "策略生成",
    automationLevel: "半自动",
    writeAccess: false,
    dependencies: ["OKX Trade Kit"],
    indicators: ["趋势评分", "RSI 优化", "区间策略", "套利参数", "风控分层"],
    logic: "用实时行情和多维指标生成策略参数，可把结果交给执行层，但本身不直接下单。",
    trigger: "生成策略、参数优化、三档风险方案、bot 配置"
  },
  {
    name: "okx-execution-vortex",
    category: "执行",
    automationLevel: "可全自动",
    writeAccess: true,
    dependencies: ["OKX Trade Kit"],
    indicators: ["限价/市价", "OCO", "网格", "DCA", "仓位检查", "二次确认"],
    logic: "接收 AI 风险计划后，可在每个本地测试账户自动执行买入、卖出、做多、做空、加减仓和平仓并保留审计日志；真实账户未授权前不发送订单。",
    trigger: "执行订单、OCO、网格、DCA、仓位管理"
  },
  {
    name: "recurring-dca",
    category: "定投",
    automationLevel: "可全自动",
    writeAccess: true,
    dependencies: ["Python", "OKX Trade Kit"],
    indicators: ["定时周期", "多币权重", "RSI 条件", "MACD 条件", "布林带条件", "资金费率过滤"],
    logic: "创建周期性买入策略，可叠加技术条件，适合长期配置而不是高频择时。",
    trigger: "定投、每周买 BTC、条件触发买入、创建 DCA"
  },
  {
    name: "okx-maker-entry",
    category: "低费率入场",
    automationLevel: "可全自动",
    writeAccess: true,
    dependencies: ["Python", "ccxt"],
    indicators: ["盘口 1-40 档", "Post-Only", "分层挂单", "撤单重挂", "成交监控"],
    logic: "在盘口内分散挂 maker 限价单，未成交时自动调整，目标是降低 taker 成本。",
    trigger: "maker 开仓、被动挂单、省手续费开仓"
  },
  {
    name: "okx-review",
    category: "复盘",
    automationLevel: "本地仪表盘",
    writeAccess: false,
    dependencies: ["Python", "Flask", "SQLite"],
    indicators: ["盈亏曲线", "胜率", "手续费", "月度表现", "交易标签", "复盘笔记"],
    logic: "把 OKX 历史交易写入本地 SQLite，并启动 Flask dashboard 查看交易表现。",
    trigger: "OKX 复盘、盈亏报告、胜率统计、交易表现"
  },
  {
    name: "market-intel",
    category: "市场情绪",
    automationLevel: "只读分析",
    writeAccess: false,
    dependencies: ["chainbase-cli"],
    indicators: ["社交热度", "叙事迁移", "Tops 排名", "OKX 交易对映射", "价格验证"],
    logic: "抓取社交与叙事异动，再映射到 OKX 可交易标的，作为非价格风控过滤器。",
    trigger: "市场简报、有什么异动、社交面怎么样、监控市场"
  }
];

export function buildSkillsStatus(rootDir) {
  const agentDir = path.join(rootDir, ".agents", "skills");
  const projectDir = path.join(rootDir, "skills");
  const toolingStatus = loadToolingStatus(rootDir);
  const appData = process.env.APPDATA || "";
  const pythonPath = process.env.OKX_SKILL_PYTHON
    || "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";

  return SKILL_REGISTRY.map((skill) => {
    const installPath = firstExistingPath([
      path.join(agentDir, skill.name, "SKILL.md"),
      path.join(projectDir, skill.name, "SKILL.md")
    ]);

    return {
      ...skill,
      installed: Boolean(installPath),
      localPath: installPath ? path.dirname(installPath) : "",
      dependencyStatus: skill.dependencies.map((dependency) => ({
        name: dependency,
        ready: dependencyReady(dependency, { rootDir, appData, pythonPath, toolingStatus }),
        detail: toolingStatus.dependencies?.[dependency] || {}
      }))
    };
  });
}

function loadToolingStatus(rootDir) {
  const filePath = path.join(rootDir, "config", "tooling-status.json");
  if (!fs.existsSync(filePath)) return { dependencies: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { dependencies: {} };
  }
}

function firstExistingPath(paths) {
  return paths.find((item) => fs.existsSync(item)) || "";
}

function dependencyReady(dependency, context) {
  const recorded = context.toolingStatus.dependencies?.[dependency];
  if (recorded?.ready) return true;
  if (dependency === "Python") return fs.existsSync(context.pythonPath);
  if (dependency === "ccxt") {
    return fs.existsSync(path.join(path.dirname(context.pythonPath), "Lib", "site-packages", "ccxt"));
  }
  if (dependency === "Flask") {
    return fs.existsSync(path.join(path.dirname(context.pythonPath), "Lib", "site-packages", "flask"));
  }
  if (dependency === "SQLite") return true;
  if (dependency === "chainbase-cli") {
    return Boolean(context.appData) && fs.existsSync(path.join(context.appData, "npm", "chainbase.cmd"));
  }
  if (dependency === "OKX Trade Kit") return fs.existsSync(path.join(context.rootDir, "src", "okx.js"));
  return false;
}
