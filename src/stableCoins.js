export const STABLE_BASES = new Set([
  "USDT",
  "USDC",
  "USDG",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDD",
  "PYUSD",
  "GUSD",
  "USDP",
  "BUSD",
  "USD",
  "USD1",
  "EURT",
  "EURS",
  "AEUR",
  "EURI"
]);

export function baseFromInstrument(instId = "") {
  return String(instId || "").trim().toUpperCase().split("-")[0] || "";
}

export function isStableBase(base = "") {
  const normalized = String(base || "").trim().toUpperCase();
  return STABLE_BASES.has(normalized) || /^(?:[A-Z0-9]{0,4}USD|USD[A-Z0-9]{0,4})$/.test(normalized);
}

export function isStableInstrument(instId = "") {
  return isStableBase(baseFromInstrument(instId));
}
