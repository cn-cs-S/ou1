const STABLES = new Set(["USDT", "USDC", "DAI", "FDUSD", "TUSD", "USD"]);
const MEME_HINTS = /DOGE|SHIB|PEPE|BONK|FLOKI|WIF|MEME|TURBO|PENGU|TRUMP/i;

export function buildUniverse({ instruments = [], tickers = [], instType = "SPOT", quoteCcy = "USDT", minAgeDays = 30, excludeNew = true, limit = 80 }) {
  const tickerMap = new Map(tickers.map((ticker) => [ticker.instId, ticker]));
  const now = Date.now();
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;

  const rows = instruments
    .filter((item) => item.state === "live")
    .filter((item) => filterQuote(item, instType, quoteCcy))
    .map((item) => {
      const ticker = tickerMap.get(item.instId) || {};
      const listTime = Number(item.listTime || item.openTime || 0);
      const ageDays = listTime > 0 ? Math.max(0, (now - listTime) / 86_400_000) : null;
      const last = Number(ticker.last || 0);
      const open24h = Number(ticker.open24h || 0);
      const change24h = open24h > 0 ? last / open24h - 1 : 0;
      const volumeQuote24h = Number(ticker.volCcy24h || ticker.volCcyQuote24h || 0);
      const spread = spreadPct(ticker);
      const base = item.baseCcy || item.instId.split("-")[0];
      const isNew = ageDays !== null && ageDays < minAgeDays;

      return {
        instId: item.instId,
        instType,
        baseCcy: base,
        quoteCcy: item.quoteCcy || quoteCcy,
        listTime,
        ageDays,
        isNew,
        last,
        change24h,
        volumeQuote24h,
        spread,
        lotSz: item.lotSz || "",
        minSz: item.minSz || "",
        ctVal: Number(item.ctVal || 0),
        lever: Number(item.lever || 0),
        tags: buildTags(base, isNew)
      };
    })
    .filter((item) => item.last > 0)
    .filter((item) => !STABLES.has(item.baseCcy))
    .filter((item) => !excludeNew || !item.isNew);

  const scored = scoreUniverse(rows)
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, clamp(limit, 10, 500));

  return {
    generatedAt: new Date().toISOString(),
    filters: { instType, quoteCcy, minAgeDays, excludeNew, limit },
    total: rows.length,
    recommended: scored.slice(0, Math.min(12, scored.length)),
    candidates: scored
  };
}

function filterQuote(item, instType, quoteCcy) {
  if (instType === "SPOT") return item.quoteCcy === quoteCcy;
  if (instType === "SWAP") return item.instId.endsWith(`-${quoteCcy}-SWAP`);
  return item.instId.includes(`-${quoteCcy}`);
}

function scoreUniverse(rows) {
  const volumes = rows.map((item) => Math.log10(Math.max(item.volumeQuote24h, 1)));
  const volumeMin = Math.min(...volumes);
  const volumeMax = Math.max(...volumes);

  return rows.map((item, index) => {
    const volumeNorm = normalize(Math.log10(Math.max(item.volumeQuote24h, 1)), volumeMin, volumeMax);
    const momentum = clamp((item.change24h + 0.08) / 0.18, 0, 1);
    const spreadScore = clamp(1 - item.spread * 300, 0, 1);
    const ageScore = item.ageDays === null ? 0.75 : clamp(item.ageDays / 180, 0.2, 1);
    const memePenalty = MEME_HINTS.test(item.baseCcy) ? 0.08 : 0;
    const rankPenalty = index > 120 ? 0.03 : 0;
    const aiScore = clamp(
      volumeNorm * 42 + momentum * 24 + spreadScore * 20 + ageScore * 14 - memePenalty * 100 - rankPenalty * 100,
      0,
      100
    );

    return {
      ...item,
      aiScore: Math.round(aiScore),
      reason: reasonFor(item, volumeNorm, momentum, spreadScore, ageScore, memePenalty)
    };
  });
}

function reasonFor(item, volumeNorm, momentum, spreadScore, ageScore, memePenalty) {
  const parts = [];
  if (volumeNorm > 0.72) parts.push("流动性高");
  if (momentum > 0.62) parts.push("24H 动量较强");
  if (spreadScore > 0.82) parts.push("点差较低");
  if (ageScore > 0.8) parts.push("上市时间较久");
  if (memePenalty) parts.push("叙事币波动较高");
  return parts.length ? parts.join(" · ") : "综合条件一般";
}

function buildTags(base, isNew) {
  const tags = [];
  if (isNew) tags.push("新币");
  if (MEME_HINTS.test(base)) tags.push("高波动");
  if (/BTC|ETH|SOL|OKB|BNB|XRP|ADA|DOGE|AVAX|LINK|DOT|TON/i.test(base)) tags.push("主流");
  return tags;
}

function spreadPct(ticker) {
  const bid = Number(ticker.bidPx || 0);
  const ask = Number(ticker.askPx || 0);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(ticker.last || 0);
  return mid > 0 && ask >= bid ? (ask - bid) / mid : 0.01;
}

function normalize(value, min, max) {
  if (!Number.isFinite(value) || max <= min) return 0.5;
  return clamp((value - min) / (max - min), 0, 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
